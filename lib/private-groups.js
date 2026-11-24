// lib/private-groups.js — POST /api/private-groups (KC, 2026-11-24; the /private-groups form; no cookie).
// Served by api/lineup.js through a rewrite in vercel.json (and the same alias in scripts/dev-server.js): the Vercel
// Hobby plan allows 12 functions, and a 12th api/ file plus the routing middleware made 13. The address stays
// /api/private-groups; /api/inquiry and /api/soft-launch are separate and untouched.
//   body { step: 1|2|3, requestId?, name, email, where?, when?, players?, days?, level?, focus?: [..], accommodations?,
//          notes?, source?, website: "" } → 200 { ok:true, requestId }. Step 1 creates the row; 2 and 3 update it.
//   200 { ok:true } · 400 { ok:false, errors } · 429 { ok:false, reason:"rate_limited" } · 500 { ok:false, reason:"server_error" }
// Writes one row to the "Private Groups" tab only (lib/store.columns.js PRIVATE_GROUPS_HEADERS), then the team alert to
// NOTIFY_EMAILS with Reply-To the guest (best effort). /api/inquiry and /api/soft-launch are separate and untouched.
// Order, as in /api/soft-launch: rate limit → honeypot (looks like success, writes nothing) → validation → double
// submit (same email within 60 seconds returns the first response again and writes nothing).

import * as store from './store.js';
import { emailMode, notifyPrivateGroup, sendEmail } from './email.js';
import { getSecret } from './env.js';
import { json, readJson } from './http.js';
import { clientIp, ipHash, makeId } from './ids.js';
import { PRIVATE_GROUP_STAGES } from './store.columns.js';
import { TEAM_ALERT_TO, privateGroupAnswers, sheetTabUrl, teamAlert } from './email-team-alert.js';
import { check } from './ratelimit.js';
import { isHoneypotFilled, validatePrivateGroup } from './validate.js';
import { withSheetScope } from './request-scope.js';
import { pacificTimestamp } from '../api/soft-launch.js';

export const DOUBLE_SUBMIT_TTL_MS = 60 * 1000;
export const RATE_LIMIT_BUCKET = 'private-groups';
const LOG_MODE_NOTIFY_FALLBACK = 'notify@example.com';

const recent = new Map(); // email -> { at, result: Promise<{ status, body }> }

export function _resetDoubleSubmit() {
  recent.clear();
}

function pruneRecent(now) {
  for (const [key, entry] of recent) if (now - entry.at >= DOUBLE_SUBMIT_TTL_MS) recent.delete(key);
}

export function buildRow(value, now = new Date()) {
  const at = pacificTimestamp(now);
  return {
    timestampPt: at,
    requestId: value.requestId,
    stage: PRIVATE_GROUP_STAGES[value.step],
    name: value.name,
    email: value.email,
    where: value.where || '',
    when: value.when || '',
    players: value.players || '',
    days: value.days || '',
    level: value.level || '',
    focus: value.focus || '',
    accommodations: value.accommodations || '',
    notes: value.notes || '',
    source: value.source,
    updatedPt: at,
  };
}

// Each step writes the whole row so far (the browser sends every answer it has), so a missed step never loses data.
// The team email goes out once, when the guest finishes (step 3); partial rows are visible in the Sheet by Stage.
async function save({ value }) {
  if (!value.requestId) value.requestId = makeId('PG-');
  const row = buildRow(value);
  await store.upsertPrivateGroup(row);
  if (value.step === 3) {
    const env = process.env;
    const notifyTo = String(env.NOTIFY_EMAILS ?? '').trim() || (emailMode(env) === 'log' ? LOG_MODE_NOTIFY_FALLBACK : '');
    if (notifyTo) {
      const sent = await sendEmail({ to: notifyTo, ...notifyPrivateGroup(row, { sheetUrl: String(env.SHEET_URL ?? '').trim() }) });
      if (!sent.ok) console.error(`[api/private-groups] team email failed: ${sent.error}`);
    }
    // Team alert to Jeff and Katie (lib/email-team-alert.js), Reply-To the guest.
    const alert = teamAlert({ type: 'privateGroup', contact: { name: row.name, email: row.email }, answers: privateGroupAnswers(row), submitted: row.updatedPt, sheetUrl: await sheetTabUrl('Private Groups') });
    const alerted = await sendEmail({ to: TEAM_ALERT_TO, ...alert });
    if (!alerted.ok) console.error(`[api/private-groups] team alert failed: ${alerted.error}`);
  }
  return { status: 200, body: { ok: true, requestId: value.requestId } };
}

async function handlePost(request) {
  const hash = await ipHash(clientIp(request), getSecret());
  if (!check(RATE_LIMIT_BUCKET, hash).allowed) return json(429, { ok: false, reason: 'rate_limited' });

  const body = await readJson(request);
  if (body === undefined) return json(400, { ok: false, errors: { body: 'Send the request as JSON.' } });
  if (isHoneypotFilled(body)) return json(200, { ok: true });

  const result = validatePrivateGroup(body);
  if (!result.ok) return json(400, { ok: false, errors: result.errors });
  const { value } = result;

  try {
    const now = Date.now();
    pruneRecent(now);
    const key = `${value.email.toLowerCase()}|${value.requestId}|${value.step}`;
    let entry = recent.get(key);
    if (!entry) {
      entry = { at: now, result: save({ value }) };
      recent.set(key, entry);
      entry.result.catch(() => recent.delete(key));
    }
    const outcome = await entry.result;
    return json(outcome.status, outcome.body);
  } catch (err) {
    console.error('[api/private-groups]', err);
    return json(500, { ok: false, reason: 'server_error' });
  }
}

export const POST = withSheetScope(handlePost);

// ---- Reminders and resume (KC, 2026-11-24) ---------------------------------------------------------------------------
// GET /api/private-groups-reminders (Vercel Cron, daily; Authorization: Bearer CRON_SECRET): one email to each guest
// whose row is not Complete, last saved 12 hours to 14 days ago, with no Reminder sent yet; then stamps Reminder sent.
// GET /api/private-groups?r=PG-… : the saved answers for that request, so the reminder's link reopens the form filled
// in. Both run in api/lineup.js through rewrites (vercel.json), like POST /api/private-groups.
import { privateGroupReminder } from './email-pg-reminder.js';

export const REMIND_AFTER_MS = 12 * 60 * 60 * 1000;
export const REMIND_WITHIN_MS = 14 * 24 * 60 * 60 * 1000;

// "2026-11-24 2:48 PM" (Pacific, as pacificTimestamp writes it) -> Date, or null.
export function parsePacific(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{1,2}):(\d{2}) (AM|PM)$/.exec(String(text || '').trim());
  if (!m) return null;
  let h = Number(m[4]) % 12;
  if (m[6] === 'PM') h += 12;
  for (const offset of [8, 7]) { // PST, then PDT
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), h + offset, Number(m[5])));
    if (pacificTimestamp(d) === String(text).trim()) return d;
  }
  return null;
}

export function dueForReminder(row, now = new Date()) {
  if (row.Stage === 'Complete' || row['Reminder sent (PT)'] || !String(row.Email || '').includes('@')) return false;
  const at = parsePacific(row['Last updated (PT)']) || parsePacific(row['Timestamp (PT)']);
  if (!at) return false;
  const age = now.getTime() - at.getTime();
  return age >= REMIND_AFTER_MS && age <= REMIND_WITHIN_MS;
}

export async function runReminders({ now = new Date(), env = process.env } = {}) {
  const rows = await store.listPrivateGroups();
  const due = rows.filter((r) => dueForReminder(r, now));
  const replyTo = String(env.NOTIFY_EMAILS ?? '').split(',')[0].trim();
  let sent = 0;
  let sheetUrl;
  for (const row of due) {
    const mail = await sendEmail({ to: row.Email, replyTo, ...privateGroupReminder(row) });
    if (!mail.ok) { console.error(`[private-groups reminder] ${row['Request ID']} failed: ${mail.error}`); continue; }
    await store.markPrivateGroupReminded(row['Request ID'], pacificTimestamp(now));
    sent += 1;
    // The unfinished-request alert to Jeff and Katie rides on the same daily check and the same Reminder sent stamp:
    // one per unfinished request, none once the guest finishes (Complete rows are never due).
    sheetUrl ??= await sheetTabUrl('Private Groups', env);
    const alert = teamAlert({ type: 'unfinished', contact: { name: row['Your name'], email: row.Email }, answers: privateGroupAnswers(row), submitted: row['Last updated (PT)'], submittedLabel: 'Last saved', sheetUrl });
    const alerted = await sendEmail({ to: TEAM_ALERT_TO, ...alert });
    if (!alerted.ok) console.error(`[private-groups reminder] team alert for ${row['Request ID']} failed: ${alerted.error}`);
  }
  return { checked: rows.length, due: due.length, sent };
}

export async function remindersGet(request) {
  const secret = String(process.env.CRON_SECRET ?? '').trim();
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return json(401, { ok: false, reason: 'unauthorized' });
  try {
    return json(200, { ok: true, ...(await runReminders()) });
  } catch (err) {
    console.error('[private-groups reminder]', err);
    return json(500, { ok: false, reason: 'server_error' });
  }
}

// The saved answers for the reminder's "Finish my trip" link. The id is the only key (8 random characters).
export async function resumeGet(request) {
  const hash = await ipHash(clientIp(request), getSecret());
  if (!check(RATE_LIMIT_BUCKET, hash).allowed) return json(429, { ok: false, reason: 'rate_limited' });
  const id = new URL(request.url).searchParams.get('r') || '';
  if (!/^PG-[0-9A-HJKMNP-TV-Z]{8}$/.test(id)) return json(404, { ok: false, reason: 'not_found' });
  const row = (await store.listPrivateGroups()).find((r) => r['Request ID'] === id);
  if (!row) return json(404, { ok: false, reason: 'not_found' });
  const step = row.Stage === 'Trip details' ? 3 : row.Stage === 'Complete' ? 3 : 2;
  return json(200, {
    ok: true,
    requestId: id,
    step,
    complete: row.Stage === 'Complete',
    answers: {
      name: row['Your name'], email: row.Email, where: row['1. Where'], when: row['2. When'], players: row['3. Tennis players'],
      days: row['4. Days of tennis'], level: row['5. Group level'], focus: row['6. Focus'] ? row['6. Focus'].split(', ') : [],
      accommodations: row['7. Accommodations'], notes: row['8. Anything else'],
    },
  });
}
