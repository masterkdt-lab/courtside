// lib/private-groups.js — POST /api/private-groups (KC, 2026-11-24; the /private-groups form; no cookie).
// Served by api/lineup.js through a rewrite in vercel.json (and the same alias in scripts/dev-server.js): the Vercel
// Hobby plan allows 12 functions, and a 12th api/ file plus the routing middleware made 13. The address stays
// /api/private-groups; /api/inquiry and /api/soft-launch are separate and untouched.
//   body { name, email, destination, notes?, source?, website: "" }
//   200 { ok:true } · 400 { ok:false, errors } · 429 { ok:false, reason:"rate_limited" } · 500 { ok:false, reason:"server_error" }
// Writes one row to the "Private Groups" tab only (lib/store.columns.js PRIVATE_GROUPS_HEADERS), then the team alert to
// NOTIFY_EMAILS with Reply-To the guest (best effort). /api/inquiry and /api/soft-launch are separate and untouched.
// Order, as in /api/soft-launch: rate limit → honeypot (looks like success, writes nothing) → validation → double
// submit (same email within 60 seconds returns the first response again and writes nothing).

import * as store from './store.js';
import { emailMode, notifyPrivateGroup, sendEmail } from './email.js';
import { getSecret } from './env.js';
import { json, readJson } from './http.js';
import { clientIp, ipHash } from './ids.js';
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
  return {
    timestampPt: pacificTimestamp(now),
    name: value.name,
    email: value.email,
    destination: value.destination,
    notes: value.notes || '',
    source: value.source,
  };
}

async function save({ value }) {
  const row = buildRow(value);
  await store.appendPrivateGroup(row);
  const env = process.env;
  const notifyTo = String(env.NOTIFY_EMAILS ?? '').trim() || (emailMode(env) === 'log' ? LOG_MODE_NOTIFY_FALLBACK : '');
  if (notifyTo) {
    const sent = await sendEmail({ to: notifyTo, ...notifyPrivateGroup(row, { sheetUrl: String(env.SHEET_URL ?? '').trim() }) });
    if (!sent.ok) console.error(`[api/private-groups] team email failed: ${sent.error}`);
  }
  return { status: 200, body: { ok: true } };
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
    console.error('[api/private-groups]', err);
    return json(500, { ok: false, reason: 'server_error' });
  }
}

export const POST = withSheetScope(handlePost);
