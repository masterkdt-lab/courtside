// api/soft-launch.js — POST /api/soft-launch (soft launch, KC 2026-11-23; the one-screen request form; no cookie)
//   body { kind: "Join a week" | "Whole week", name, email, timing?, notes?, consent: true, source?, website: "" }
//   200 { ok:true }
//   400 { ok:false, errors:{ field: message } }
//   429 { ok:false, reason:"rate_limited" }
//   500 { ok:false, reason:"server_error" }
// Writes one row to the "Soft Launch" tab only (lib/store.columns.js SOFT_LAUNCH_HEADERS; Status left blank for Katie),
// then the team alert to NOTIFY_EMAILS (Reply-To the guest) and the guest's confirmation, both best effort. The old
// POST /api/inquiry flow and its tabs are untouched and stay in place, unlinked from the site.
// Order, as in /api/application: rate limit (bucket "soft-launch", 5 per 10 minutes per IP hash, the default) →
// honeypot (a filled `website` looks like success and writes nothing) → validation → double submit (same email
// within 60 seconds returns the first response again and writes nothing).

import * as store from '../lib/store.js';
import { emailMode, notifySoftLaunch, sendEmail } from '../lib/email.js';
import { confirmSoftLaunch } from '../lib/email-confirm.js';
import { getSecret } from '../lib/env.js';
import { json, readJson } from '../lib/http.js';
import { clientIp, ipHash } from '../lib/ids.js';
import { check } from '../lib/ratelimit.js';
import { isHoneypotFilled, validateSoftLaunch } from '../lib/validate.js';
import { withSheetScope } from '../lib/request-scope.js';

export const DOUBLE_SUBMIT_TTL_MS = 60 * 1000;
export const RATE_LIMIT_BUCKET = 'soft-launch';
const LOG_MODE_NOTIFY_FALLBACK = 'notify@example.com';

const recent = new Map(); // email -> { at, result: Promise<{ status, body }> }

export function _resetDoubleSubmit() {
  recent.clear();
}

function pruneRecent(now) {
  for (const [key, entry] of recent) if (now - entry.at >= DOUBLE_SUBMIT_TTL_MS) recent.delete(key);
}

// "2026-11-24 12:03 PM" in Pacific time.
export function pacificTimestamp(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(now).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} ${parts.dayPeriod}`;
}

export function buildRow(value, now = new Date()) {
  return {
    timestampPt: pacificTimestamp(now),
    name: value.name,
    email: value.email,
    kind: value.kind,
    timing: value.timing || '',
    notes: value.notes || '',
    consent: 'Yes',
    source: value.source,
    status: '',
  };
}

async function save({ value }) {
  const row = buildRow(value);
  await store.appendSoftLaunch(row);

  const env = process.env;
  const notifyTo = String(env.NOTIFY_EMAILS ?? '').trim() || (emailMode(env) === 'log' ? LOG_MODE_NOTIFY_FALLBACK : '');
  if (notifyTo) {
    const sent = await sendEmail({ to: notifyTo, ...notifySoftLaunch(row, { sheetUrl: String(env.SHEET_URL ?? '').trim() }) });
    if (!sent.ok) console.error(`[api/soft-launch] team email failed: ${sent.error}`);
  }
  const confirm = await sendEmail({ to: row.email, replyTo: String(env.NOTIFY_EMAILS ?? '').split(',')[0].trim(), ...confirmSoftLaunch(row) });
  if (!confirm.ok) console.error(`[api/soft-launch] guest confirmation failed: ${confirm.error}`);

  return { status: 200, body: { ok: true } };
}

async function handlePost(request) {
  const hash = await ipHash(clientIp(request), getSecret());
  if (!check(RATE_LIMIT_BUCKET, hash).allowed) return json(429, { ok: false, reason: 'rate_limited' });

  const body = await readJson(request);
  if (body === undefined) return json(400, { ok: false, errors: { body: 'Send the request as JSON.' } });

  // Honeypot: looks like success, writes nothing, sends nothing.
  if (isHoneypotFilled(body)) return json(200, { ok: true });

  const result = validateSoftLaunch(body);
  if (!result.ok) return json(400, { ok: false, errors: result.errors });
  const { value } = result;

  try {
    const now = Date.now();
    pruneRecent(now);
    const key = value.email.toLowerCase();
    let entry = recent.get(key);
    if (!entry) {
      entry = { at: now, result: save({ value }) };
      recent.set(key, entry);
      entry.result.catch(() => recent.delete(key));
    }
    const outcome = await entry.result;
    return json(outcome.status, outcome.body);
  } catch (err) {
    console.error('[api/soft-launch]', err);
    return json(500, { ok: false, reason: 'server_error' });
  }
}

export const POST = withSheetScope(handlePost);
