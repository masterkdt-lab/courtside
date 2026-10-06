// IDENTITY: the guest's name, email and mobile come from the invite row (one code per guest,
// set by Katie in the Invites tab), not from form fields. Decision KC 2026-10-05.
// Alternative, if shared codes are wanted later: collect name/email/mobile (+ consent) in the
// request modal and validate them here; the Requests columns already exist for them.

// api/request.js — POST /api/request (plan 4.4; cookie required, else 401)
//   200 { ok:true, requestId, guestEmailSent }
//   400 { ok:false, errors:{ field: message } }
//   409 { ok:false, reason:"trip_closed" } | { ok:false, reason:"week_closed", weeks:[weekId,...] }
//   429 { ok:false, reason:"rate_limited" }
// Trip and week status are read fresh on every call (no cache). A filled honeypot returns a
// fake-looking request ID and writes nothing. An identical code + type + weeks within 60 seconds
// returns the first request's response unchanged (plan 4.0, double submit).

import * as store from '../lib/store.js';
import { TRIP_ID, addonById, roomName, tennisName } from '../lib/catalog.js';
import { confirmGuest, emailMode, notifyKatie, sendEmail } from '../lib/email.js';
import { getSecret } from '../lib/env.js';
import { sessionFromRequest } from '../lib/guard.js';
import { json, readJson } from '../lib/http.js';
import { clientIp, ipHash, requestId } from '../lib/ids.js';
import { check } from '../lib/ratelimit.js';
import { validateRequest } from '../lib/validate.js';

export const DOUBLE_SUBMIT_TTL_MS = 60 * 1000;
const LOG_MODE_NOTIFY_FALLBACK = 'notify@example.com';

const recent = new Map(); // "code|requestType|w1,w2" -> { at, result: Promise<body> }

export function _resetDoubleSubmit() {
  recent.clear();
}

function pruneRecent(now) {
  for (const [key, entry] of recent) if (now - entry.at >= DOUBLE_SUBMIT_TTL_MS) recent.delete(key);
}

// "Extra session with Eva ×6, Private 6-hour driver / excursion" (plan 4.2).
export function formatAddons(addons = []) {
  return addons
    .map(({ id, qty }) => {
      const addon = addonById(id);
      if (!addon) return '';
      return addon.type === 'player' || addon.type === 'guest' ? `${addon.name} ×${qty}` : addon.name;
    })
    .filter(Boolean)
    .join(', ');
}

// The Requests row (camelCase keys, plan 4.2): weeks as labels, room/tennis/add-ons as display
// names, columns that do not apply to the request type left blank by the store.
export function buildRow({ id, value, invite, weeksById, now = new Date() }) {
  const row = {
    requestId: id,
    submittedAt: now.toISOString(),
    tripId: TRIP_ID,
    requestType: value.requestType,
    weeks: value.weeks.map((weekId) => weeksById.get(weekId)?.label || weekId).join(', '),
    guestName: invite.issuedTo,
    guestEmail: invite.guestEmail,
    guestMobile: invite.guestMobile,
    note: value.note,
    brief: value.brief,
    inviteCode: invite.code,
    invitedBy: invite.invitedBy,
    status: 'New',
    owner: '',
    internalNotes: '',
  };
  if (value.requestType === 'private') {
    Object.assign(row, {
      players: value.players,
      partners: value.partners,
      room: roomName(value.room),
      singleRooms: value.singleRooms,
      tennis: tennisName(value.tennis),
      addons: formatAddons(value.addons),
      playerEstimate: value.playerEstimate,
      partnerEstimate: value.partnerEstimate,
      groupEstimate: value.groupEstimate,
    });
  } else {
    Object.assign(row, {
      partyType: value.partyType,
      level: value.level,
      tennisStyle: value.tennisStyle,
      travelStyle: value.travelStyle,
      priorities: value.priorities.join(', '),
    });
  }
  return row;
}

async function saveAndNotify({ session, value, weeksById }) {
  // Identity is read fresh from the invite row, never from the body (plan 4.7).
  const invite = await store.findInvite(session.code);
  if (!invite || invite.status === 'revoked') return { status: 401, body: { ok: false, reason: 'unauthorized' } };

  const id = requestId();
  const row = buildRow({ id, value, invite, weeksById });
  await store.appendRequest(row);

  const env = process.env;
  const notifyTo = String(env.NOTIFY_EMAILS ?? '').trim() || (emailMode(env) === 'log' ? LOG_MODE_NOTIFY_FALLBACK : '');
  const notify = await sendEmail({ to: notifyTo, ...notifyKatie(row, { sheetUrl: String(env.SHEET_URL ?? '').trim() }) });
  if (!notify.ok) console.error(`[api/request] notification email for ${id} failed: ${notify.error}`);

  let guestEmailSent = false;
  if (row.guestEmail) {
    const confirm = await sendEmail({ to: row.guestEmail, ...confirmGuest(row) });
    guestEmailSent = confirm.ok === true;
    if (!confirm.ok) console.error(`[api/request] guest confirmation for ${id} failed: ${confirm.error}`);
  }

  return { status: 200, body: { ok: true, requestId: id, guestEmailSent } };
}

export async function POST(request) {
  const secret = getSecret();
  const session = await sessionFromRequest(request, secret);
  if (!session) return json(401, { ok: false, reason: 'unauthorized' });

  const hash = await ipHash(clientIp(request), secret);
  if (!check('request', hash).allowed) return json(429, { ok: false, reason: 'rate_limited' });

  const body = await readJson(request);
  if (body === undefined) return json(400, { ok: false, errors: { body: 'Send the request as JSON.' } });
  const result = validateRequest(body);
  if (!result.ok) return json(400, { ok: false, errors: result.errors });
  const { value } = result;

  // Honeypot: looks like success, writes nothing, sends nothing.
  if (value.website) return json(200, { ok: true, requestId: requestId(), guestEmailSent: false });

  try {
    const [trips, weeks] = await Promise.all([store.listTrips(), store.listWeeks()]);
    const trip = trips.find((t) => t.tripId === TRIP_ID) || null;
    const tripWeeks = weeks.filter((w) => w.tripId === TRIP_ID);
    const anyOpen = tripWeeks.some((w) => w.status === 'open');
    if (!trip || trip.status !== 'open' || !anyOpen) return json(409, { ok: false, reason: 'trip_closed' });

    const weeksById = new Map(tripWeeks.map((w) => [w.weekId, w]));
    const closed = value.weeks.filter((weekId) => weeksById.get(weekId)?.status !== 'open');
    if (closed.length) return json(409, { ok: false, reason: 'week_closed', weeks: closed });

    const now = Date.now();
    pruneRecent(now);
    const key = `${session.code}|${value.requestType}|${value.weeks.join(',')}`;
    let entry = recent.get(key);
    if (!entry) {
      entry = { at: now, result: saveAndNotify({ session, value, weeksById }) };
      recent.set(key, entry);
      entry.result.catch(() => recent.delete(key));
    }
    const outcome = await entry.result;
    if (outcome.status !== 200) recent.delete(key);
    return json(outcome.status, outcome.body);
  } catch (err) {
    console.error('[api/request]', err);
    return json(500, { ok: false, reason: 'server_error' });
  }
}
