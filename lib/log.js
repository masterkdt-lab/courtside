// lib/log.js
// The best-effort Log row every Wave 2 write appends (CONCEPT02_WAVE2_PLAN.md section 6):
// { code: <event>, result: <id>, ipHash }. A failed Log write is reported to the console and never
// changes the response, exactly as api/code.js and api/inquiry.js treat theirs.

import * as store from './store.js';

export async function logEvent(code, result, ipHash, tag = 'api') {
  try {
    await store.logAttempt({ code, result, ipHash });
  } catch (err) {
    console.error(`[${tag}] logAttempt failed`, err);
  }
}
