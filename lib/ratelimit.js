// lib/ratelimit.js
// Best-effort in-memory rate limit per IP hash (plan 4.0; polish brief section 3): 10 code
// attempts, 5 request posts, 5 waitlist sign-ups and 60 events per 10 minutes, fixed windows.
// State lives in this module, so it resets on every cold start; the honeypot and the Log tab are
// the backstop.

const MINUTE = 60 * 1000;

export const LIMITS = Object.freeze({
  code: Object.freeze({ limit: 10, windowMs: 10 * MINUTE }),
  request: Object.freeze({ limit: 5, windowMs: 10 * MINUTE }),
  waitlist: Object.freeze({ limit: 5, windowMs: 10 * MINUTE }),
  event: Object.freeze({ limit: 60, windowMs: 10 * MINUTE }),
});

const buckets = new Map(); // "bucket:ipHash" -> { count, resetAt }

function prune(now) {
  for (const [key, entry] of buckets) if (now >= entry.resetAt) buckets.delete(key);
}

// -> { allowed, remaining, resetAt }. Counts the call when allowed.
export function check(bucket, ipHash, options = LIMITS[bucket], now = Date.now()) {
  const { limit, windowMs } = options || {};
  if (!Number.isFinite(limit) || !Number.isFinite(windowMs)) {
    throw new Error(`ratelimit: no limits for bucket "${bucket}"`);
  }
  if (buckets.size > 10000) prune(now);
  const key = `${bucket}:${ipHash}`;
  let entry = buckets.get(key);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    buckets.set(key, entry);
  }
  if (entry.count >= limit) return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  entry.count += 1;
  return { allowed: true, remaining: limit - entry.count, resetAt: entry.resetAt };
}

export function _reset() {
  buckets.clear();
}
