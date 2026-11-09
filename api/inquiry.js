// api/inquiry.js — POST /api/inquiry (CONCEPT02_PLAN.md; the #/request final step; no cookie required)
//   body { path: "group"|"match", weeks: [weekId, ...] | ["flexible"], players, partners, party, level,
//          tennis, name, email, notes, consent: true, website: "" }
//   200 { ok:true, requestId }                          (match path)
//   200 { ok:true, requestId, groupId, memberId } + Set-Cookie cs_member   (group path, CONCEPT02_WAVE2_PLAN.md:
//       the Groups row and the organizer's GroupMembers row are created after the Requests row; Log
//       group_create and member_add)
//   400 { ok:false, errors:{ field: message } }
//   409 { ok:false, reason:"trip_closed", message } | { ok:false, reason:"week_closed", weeks:[weekId,...], message }
//   429 { ok:false, reason:"rate_limited" }
//   500 { ok:false, reason:"server_error" }
// Order: rate limit (bucket "request", shared with /api/request: 5 per 10 minutes per IP hash) →
// honeypot (a filled `website` looks like success with a fake requestId and writes nothing) →
// validation (lib/validate.js validateInquiry) → the trip and the chosen weeks read fresh from the
// store (never the /api/lineup cache): trip not open → trip_closed; a chosen week unknown → 400;
// a chosen week not open → week_closed → double submit (same email + weeks within 60 seconds
// returns the first response again) → one Requests row, one Log row { code:"inquiry_submit",
// result:<requestId> } (best effort) and Katie's notification (lib/email.js notifyInquiry; log
// mode prints it). The trip page is public, so the cs_session cookie is optional: when a valid
// one is present, invite_code and invited_by are filled from it, otherwise they are "".

import * as store from '../lib/store.js';
import { memberCookie } from '../lib/access.js';
import { emailMode, notifyInquiry, sendEmail } from '../lib/email.js';
import { getSecret } from '../lib/env.js';
import { FLEXIBLE, ROLES, newGroupRow, newMemberRow } from '../lib/groups.js';
import { sessionFromRequest } from '../lib/guard.js';
import { json, readJson } from '../lib/http.js';
import { clientIp, groupId as newGroupId, ipHash, memberId as newMemberId, requestId } from '../lib/ids.js';
import { logEvent } from '../lib/log.js';
import { check } from '../lib/ratelimit.js';
import { isHoneypotFilled, validateInquiry } from '../lib/validate.js';
import { LINEUP_TRIP_ID, readLineup } from './lineup.js';

export const DOUBLE_SUBMIT_TTL_MS = 60 * 1000;
export const LOG_CODE = 'inquiry_submit';
export const LOG_GROUP_CREATE = 'group_create';
export const LOG_MEMBER_ADD = 'member_add';
export const RATE_LIMIT_BUCKET = 'request';
// Concept 02 path -> the existing request_type dropdown value, and the label in the brief.
export const REQUEST_TYPE_BY_PATH = Object.freeze({ group: 'private', match: 'vetted' });
export const PATH_LABEL = Object.freeze({ group: 'Private group', match: 'Group match' });
export const FLEXIBLE_WEEKS = 'Flexible';
export const TRIP_LINE = 'The Spanish Offseason (Spain with Katie + Eva)';
export const SHOWN_PRICE = 'From $2,995 / player (concept pricing)';
export const SUBMITTED_FROM = '#/request (Concept 02)';
export const NOT_SURE = 'Not sure yet';
export const TRIP_CLOSED_MESSAGE = 'Requests for The Spanish Offseason are closed.';
const LOG_MODE_NOTIFY_FALLBACK = 'notify@example.com';

const recent = new Map(); // "email|w1,w2" -> { at, result: Promise<{ status, body }> }

export function _resetDoubleSubmit() {
  recent.clear();
}

function pruneRecent(now) {
  for (const [key, entry] of recent) if (now - entry.at >= DOUBLE_SUBMIT_TTL_MS) recent.delete(key);
}

// "Jan 17–23, Jan 24–30" from the lineup labels, or "Flexible".
export function formatWeeks(value, weeksById) {
  if (value.flexible) return FLEXIBLE_WEEKS;
  return value.weeks.map((weekId) => weeksById.get(weekId)?.label || weekId).join(', ');
}

// The plain-text summary stored in `brief` (CONCEPT02_PLAN.md format). Lines that do not apply to
// the path show "—"; a blank answer the guest could have given shows "Not sure yet".
export function buildBrief(value, weeksText) {
  const group = value.path === 'group';
  const orNotSure = (v) => (v === '' || v === undefined || v === null ? NOT_SURE : String(v));
  return [
    `CONCEPT 02 REQUEST · ${PATH_LABEL[value.path]}`,
    `Trip: ${TRIP_LINE}`,
    `Weeks: ${weeksText}`,
    `Players: ${group ? orNotSure(value.players) : '—'}`,
    `Partners: ${group ? orNotSure(value.partners) : '—'}`,
    `Party: ${group ? '—' : value.party || '—'}`,
    `Tennis level: ${group ? '—' : orNotSure(value.level)}`,
    `Tennis rhythm: ${value.tennis}`,
    `Name: ${value.name}`,
    `Email: ${value.email}`,
    `Notes: ${value.notes || '—'}`,
    `Shown price: ${SHOWN_PRICE}`,
    `Submitted from: ${SUBMITTED_FROM}`,
  ].join('\n');
}

// The Requests row (camelCase keys of the 29 columns, CONCEPT02_PLAN.md mapping). Columns the
// Concept 02 form does not ask for are "" explicitly, so the row always has every key.
export function buildRow({ id, value, weeksById, session = null, now = new Date() }) {
  const weeksText = formatWeeks(value, weeksById);
  return {
    requestId: id,
    submittedAt: now.toISOString(),
    tripId: LINEUP_TRIP_ID,
    requestType: REQUEST_TYPE_BY_PATH[value.path],
    weeks: weeksText,
    guestName: value.name,
    guestEmail: value.email,
    guestMobile: '',
    players: value.players,
    partners: value.partners,
    room: '',
    singleRooms: '',
    tennis: value.tennis,
    addons: '',
    partyType: value.party,
    level: value.level,
    tennisStyle: '',
    travelStyle: '',
    priorities: '',
    note: value.notes,
    playerEstimate: '',
    partnerEstimate: '',
    groupEstimate: '',
    brief: buildBrief(value, weeksText),
    inviteCode: session ? String(session.code ?? '') : '',
    invitedBy: session && typeof session.invitedBy === 'string' ? session.invitedBy : '',
    status: 'New',
    owner: '',
    internalNotes: '',
  };
}

// "Jan 17–23", "Jan 17–23 and Jan 24–30", "Jan 17–23, Jan 24–30 and Jan 31–Feb 6".
function listLabels(labels) {
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}

// One closed week speaks for itself (its closed_message, or a default naming it); several are listed.
export function weekClosedMessage(closedWeeks) {
  if (closedWeeks.length === 1) {
    const [week] = closedWeeks;
    return week.closedMessage || `Requests for ${week.label || week.weekId} are closed.`;
  }
  return `Requests for ${listLabels(closedWeeks.map((w) => w.label || w.weekId))} are closed.`;
}

// The Wave 2 group path (CONCEPT02_WAVE2_PLAN.md section 6): after the Requests row, the Groups row
// and the organizer's GroupMembers row, linked by request_id. Returns the two rows and the Set-Cookie
// header for cs_member. Best effort around the request itself: when this fails the request is still
// filed and the response carries no group (the console says why), rather than a 500 that would make
// the guest resubmit and file the request twice.
export function buildGroupRows({ id, row, value, now = new Date() }) {
  const iso = now.toISOString();
  const group = newGroupRow({
    groupId: newGroupId(),
    requestId: id,
    organizerName: value.name,
    organizerEmail: value.email,
    weeks: row.weeks,
    chosenWeek: value.flexible ? FLEXIBLE : value.weeks[0],
    players: value.players,
    partners: value.partners,
    tennis: value.tennis,
    notes: value.notes,
    now: iso,
  });
  const member = newMemberRow({
    memberId: newMemberId(),
    groupId: group.groupId,
    name: value.name,
    email: value.email,
    role: ROLES.organizerPlayer,
    inviteStatus: 'Responded',
    participation: 'Interested',
    tennis: value.tennis,
    joinedAt: iso,
    now: iso,
  });
  return { group, member };
}

async function createGroup({ id, row, value, hash, request }) {
  try {
    const { group, member } = buildGroupRows({ id, row, value });
    await store.appendGroup(group);
    await logEvent(LOG_GROUP_CREATE, group.groupId, hash, 'api/inquiry');
    await store.appendMember(member);
    await logEvent(LOG_MEMBER_ADD, member.memberId, hash, 'api/inquiry');
    const headers = await memberCookie(request, { groupId: group.groupId, memberId: member.memberId });
    return { groupId: group.groupId, memberId: member.memberId, headers };
  } catch (err) {
    console.error(`[api/inquiry] group rows for ${id} failed`, err);
    return null;
  }
}

async function save({ value, weeksById, session, hash, request }) {
  const id = requestId();
  const row = buildRow({ id, value, weeksById, session });
  await store.appendRequest(row);

  try {
    await store.logAttempt({ code: LOG_CODE, result: id, ipHash: hash });
  } catch (err) {
    console.error('[api/inquiry] logAttempt failed', err);
  }

  const body = { ok: true, requestId: id };
  let headers = {};
  if (value.path === 'group') {
    const created = await createGroup({ id, row, value, hash, request });
    if (created) {
      body.groupId = created.groupId;
      body.memberId = created.memberId;
      headers = created.headers;
    }
  }

  const env = process.env;
  const notifyTo = String(env.NOTIFY_EMAILS ?? '').trim() || (emailMode(env) === 'log' ? LOG_MODE_NOTIFY_FALLBACK : '');
  const notify = await sendEmail({ to: notifyTo, ...notifyInquiry(row, { sheetUrl: String(env.SHEET_URL ?? '').trim() }) });
  if (!notify.ok) console.error(`[api/inquiry] notification email for ${id} failed: ${notify.error}`);

  return { status: 200, body, headers };
}

export async function POST(request) {
  const secret = getSecret();
  const hash = await ipHash(clientIp(request), secret);
  if (!check(RATE_LIMIT_BUCKET, hash).allowed) return json(429, { ok: false, reason: 'rate_limited' });

  const body = await readJson(request);
  if (body === undefined) return json(400, { ok: false, errors: { body: 'Send the request as JSON.' } });

  // Honeypot: looks like success, writes nothing, sends nothing.
  if (isHoneypotFilled(body)) return json(200, { ok: true, requestId: requestId() });

  const result = validateInquiry(body);
  if (!result.ok) return json(400, { ok: false, errors: result.errors });
  const { value } = result;

  try {
    // Status is read fresh on every call; the /api/lineup cache is never consulted.
    const { trip, weeks } = await readLineup();
    if (!trip || trip.status !== 'open') {
      return json(409, { ok: false, reason: 'trip_closed', message: trip?.closedMessage || TRIP_CLOSED_MESSAGE });
    }
    const weeksById = new Map(weeks.map((w) => [w.weekId, w]));
    if (value.flexible) {
      // Nothing to be flexible about when every week is closed.
      if (!weeks.some((w) => w.status === 'open')) {
        return json(409, { ok: false, reason: 'trip_closed', message: trip.closedMessage || TRIP_CLOSED_MESSAGE });
      }
    } else {
      if (value.weeks.some((weekId) => !weeksById.has(weekId))) {
        return json(400, { ok: false, errors: { weeks: 'Choose a week from the list.' } });
      }
      const closed = value.weeks.map((weekId) => weeksById.get(weekId)).filter((w) => w.status !== 'open');
      if (closed.length) {
        return json(409, { ok: false, reason: 'week_closed', weeks: closed.map((w) => w.weekId), message: weekClosedMessage(closed) });
      }
    }

    const session = await sessionFromRequest(request, secret);

    const now = Date.now();
    pruneRecent(now);
    const key = `${value.email}|${value.weeks.join(',')}`;
    let entry = recent.get(key);
    if (!entry) {
      entry = { at: now, result: save({ value, weeksById, session, hash, request }) };
      recent.set(key, entry);
      entry.result.catch(() => recent.delete(key));
    }
    const outcome = await entry.result;
    return json(outcome.status, outcome.body, outcome.headers || {});
  } catch (err) {
    console.error('[api/inquiry]', err);
    return json(500, { ok: false, reason: 'server_error' });
  }
}
