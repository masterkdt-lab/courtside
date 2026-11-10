// api/application.js — POST /api/application (CONCEPT02_PLAN.md; the #/application host form; no cookie)
//   body { name, email, club, referral, background, community, destination, consent: true, website: "" }
//   200 { ok:true }
//   400 { ok:false, errors:{ field: message } }
//   429 { ok:false, reason:"rate_limited" }
//   500 { ok:false, reason:"server_error" }
// Order, as in /api/waitlist: rate limit (bucket "application", 3 per 10 minutes per IP hash), then
// the honeypot (a filled `website` looks like success and writes nothing), then validation
// (lib/validate.js validateApplication). A valid submission appends one HostApplications row
// { timestamp, name, email, club, referral, background, community, destination } and one Log row
// { time, code:"application_submit", result:"ok", ip_hash }; the Log write is best effort, the
// HostApplications write is not. The same email within 60 seconds returns 200 again and writes
// nothing (double submit), so a double click never files two applications.

import * as store from '../lib/store.js';
import { notifyApplication, sendEmail } from '../lib/email.js';
import { getSecret } from '../lib/env.js';
import { json, readJson } from '../lib/http.js';
import { clientIp, ipHash } from '../lib/ids.js';
import { check } from '../lib/ratelimit.js';
import { isHoneypotFilled, validateApplication } from '../lib/validate.js';
import { withSheetScope } from '../lib/request-scope.js';

export const DOUBLE_SUBMIT_TTL_MS = 60 * 1000;
export const LOG_CODE = 'application_submit';
export const RATE_LIMIT_BUCKET = 'application';

const recent = new Map(); // email -> { at, result: Promise<{ status, body }> }

export function _resetDoubleSubmit() {
  recent.clear();
}

function pruneRecent(now) {
  for (const [key, entry] of recent) if (now - entry.at >= DOUBLE_SUBMIT_TTL_MS) recent.delete(key);
}

// The HostApplications row (camelCase keys for the store, header order in lib/store.columns.js).
export function buildRow(value, now = new Date()) {
  return {
    timestamp: now.toISOString(),
    name: value.name,
    email: value.email,
    club: value.club,
    referral: value.referral,
    background: value.background,
    community: value.community,
    destination: value.destination,
  };
}

async function save({ value, hash }) {
  const row = buildRow(value);
  await store.appendHostApplication(row);
  // Team notification, best effort: a failed email never fails the sign-up (the row is saved).
  const notifyTo = String(process.env.NOTIFY_EMAILS ?? '').trim();
  if (notifyTo) {
    const sent = await sendEmail({ to: notifyTo, ...notifyApplication(row, { sheetUrl: String(process.env.SHEET_URL ?? '').trim() }) });
    if (!sent.ok) console.error(`[api/application] notification email failed: ${sent.error}`);
  }
  try {
    await store.logAttempt({ code: LOG_CODE, result: 'ok', ipHash: hash });
  } catch (err) {
    console.error('[api/application] logAttempt failed', err);
  }
  return { status: 200, body: { ok: true } };
}

async function handlePost(request) {
  const hash = await ipHash(clientIp(request), getSecret());
  if (!check(RATE_LIMIT_BUCKET, hash).allowed) return json(429, { ok: false, reason: 'rate_limited' });

  const body = await readJson(request);
  if (body === undefined) return json(400, { ok: false, errors: { body: 'Send the request as JSON.' } });

  // Honeypot: looks like success, writes nothing.
  if (isHoneypotFilled(body)) return json(200, { ok: true });

  const result = validateApplication(body);
  if (!result.ok) return json(400, { ok: false, errors: result.errors });
  const { value } = result;

  try {
    const now = Date.now();
    pruneRecent(now);
    const key = value.email;
    let entry = recent.get(key);
    if (!entry) {
      entry = { at: now, result: save({ value, hash }) };
      recent.set(key, entry);
      entry.result.catch(() => recent.delete(key));
    }
    const outcome = await entry.result;
    return json(outcome.status, outcome.body);
  } catch (err) {
    console.error('[api/application]', err);
    return json(500, { ok: false, reason: 'server_error' });
  }
}

// One request scope per call: every store read in the request shares one Sheets snapshot
// (lib/request-scope.js, lib/store.sheets.js).
export const POST = withSheetScope(handlePost);
