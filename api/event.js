// api/event.js — POST /api/event { name, detail } (polish brief section 3; no cookie required)
//   204 (no body)                                 accepted; the Log write is best effort
//   400 { ok:false, errors:{ field: message } }   not JSON, over 1 KB, unknown name, bad detail
//   429 { ok:false, reason:"rate_limited" }       bucket "event", 60 per 10 minutes per IP hash
// First-party event logging for the public pages, sent with navigator.sendBeacon (or fetch with
// keepalive), so the body may arrive as text/plain or application/json; both are parsed as JSON.
// Names (lib/validate.js EVENT_NAMES): no_code_click, trip_card_open (detail = a trip id from
// public/js/trips.js). Each event is one Log row { time, code:<name>, result:<detail>, ip_hash }.
// waitlist_submit is written by /api/waitlist and code attempts by /api/code, never by the client.
// A store failure is reported to the console and still answers 204, so logging can never break a page.

import * as store from '../lib/store.js';
import { getSecret } from '../lib/env.js';
import { json } from '../lib/http.js';
import { clientIp, ipHash } from '../lib/ids.js';
import { check } from '../lib/ratelimit.js';
import { validateEvent } from '../lib/validate.js';

export const MAX_BODY_BYTES = 1024;

function noContent() {
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

// The raw body as text, whatever its Content-Type; '' when there is none or it cannot be read.
async function readText(request) {
  try {
    return await request.text();
  } catch {
    return '';
  }
}

export async function POST(request) {
  const hash = await ipHash(clientIp(request), getSecret());
  if (!check('event', hash).allowed) return json(429, { ok: false, reason: 'rate_limited' });

  const text = await readText(request);
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return json(400, { ok: false, errors: { body: 'The event is too large.' } });
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  if (body === undefined) return json(400, { ok: false, errors: { body: 'Send the event as JSON.' } });

  const result = validateEvent(body);
  if (!result.ok) return json(400, { ok: false, errors: result.errors });
  const { name, detail } = result.value;

  try {
    await store.logAttempt({ code: name, result: detail, ipHash: hash });
  } catch (err) {
    console.error('[api/event] logAttempt failed', err);
  }
  return noContent();
}
