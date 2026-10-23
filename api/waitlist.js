// api/waitlist.js — POST /api/waitlist (polish brief section 3; no cookie required)
//   body { email, name?, tripId, source: "card" | "footer", consent: true, website: "" }
//   200 { ok:true }
//   400 { ok:false, errors:{ field: message } }
//   429 { ok:false, reason:"rate_limited" }
//   500 { ok:false, reason:"server_error" }
// Order, as in /api/request: rate limit (bucket "waitlist", 5 per 10 minutes per IP hash), then the
// honeypot (a filled `website` looks like success and writes nothing), then validation
// (lib/validate.js validateWaitlist). tripId is an id from public/js/trips.js or "general"
// (lib/lineup.js). A valid submission appends one Waitlist row { timestamp, email, name, trip (the
// trip's display name, or "General"), source } and one Log row { time, code:"waitlist_submit",
// result:<tripId>, ip_hash }; the Log write is best effort, the Waitlist write is not. The same
// email + tripId within 60 seconds returns 200 again and writes nothing (double submit, plan 4.0).

import * as store from '../lib/store.js';
import { getSecret } from '../lib/env.js';
import { json, readJson } from '../lib/http.js';
import { clientIp, ipHash } from '../lib/ids.js';
import { tripName } from '../lib/lineup.js';
import { check } from '../lib/ratelimit.js';
import { isHoneypotFilled, validateWaitlist } from '../lib/validate.js';

export const DOUBLE_SUBMIT_TTL_MS = 60 * 1000;
export const LOG_CODE = 'waitlist_submit';

const recent = new Map(); // "email|tripId" -> { at, result: Promise<{ status, body }> }

export function _resetDoubleSubmit() {
  recent.clear();
}

function pruneRecent(now) {
  for (const [key, entry] of recent) if (now - entry.at >= DOUBLE_SUBMIT_TTL_MS) recent.delete(key);
}

// The Waitlist row (camelCase keys for the store): the trip column holds the display name.
export function buildRow(value, now = new Date()) {
  return {
    timestamp: now.toISOString(),
    email: value.email,
    name: value.name,
    trip: tripName(value.tripId),
    source: value.source,
  };
}

async function save({ value, hash }) {
  await store.appendWaitlist(buildRow(value));
  try {
    await store.logAttempt({ code: LOG_CODE, result: value.tripId, ipHash: hash });
  } catch (err) {
    console.error('[api/waitlist] logAttempt failed', err);
  }
  return { status: 200, body: { ok: true } };
}

export async function POST(request) {
  const hash = await ipHash(clientIp(request), getSecret());
  if (!check('waitlist', hash).allowed) return json(429, { ok: false, reason: 'rate_limited' });

  const body = await readJson(request);
  if (body === undefined) return json(400, { ok: false, errors: { body: 'Send the request as JSON.' } });

  // Honeypot: looks like success, writes nothing.
  if (isHoneypotFilled(body)) return json(200, { ok: true });

  const result = validateWaitlist(body);
  if (!result.ok) return json(400, { ok: false, errors: result.errors });
  const { value } = result;

  try {
    const now = Date.now();
    pruneRecent(now);
    const key = `${value.email}|${value.tripId}`;
    let entry = recent.get(key);
    if (!entry) {
      entry = { at: now, result: save({ value, hash }) };
      recent.set(key, entry);
      entry.result.catch(() => recent.delete(key));
    }
    const outcome = await entry.result;
    return json(outcome.status, outcome.body);
  } catch (err) {
    console.error('[api/waitlist]', err);
    return json(500, { ok: false, reason: 'server_error' });
  }
}
