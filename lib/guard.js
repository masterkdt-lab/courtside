// lib/guard.js
// The one place that decides "is this request allowed into /site" (plan 4.0). Imported by
// middleware.js (Vercel edge), scripts/dev-server.js and the API routes, so nothing in this
// file's import graph may use node: modules.

import { COOKIE_NAME, readCookie, verify } from './cookie.js';

// Used when COOKIE_SECRET is unset so mock mode runs with no .env (plan 4.6). lib/env.js
// warns once when this is in play; the README says COOKIE_SECRET must be set in Vercel.
export const DEV_COOKIE_SECRET = 'courtside-dev-cookie-secret-change-me';

export function secretFromEnv(env = globalThis.process?.env ?? {}) {
  const value = typeof env.COOKIE_SECRET === 'string' ? env.COOKIE_SECRET.trim() : '';
  return value || DEV_COOKIE_SECRET;
}

// -> { code, invitedBy, issuedTo, exp } when the cs_session cookie is present, correctly
// signed and not expired; otherwise null.
export async function sessionFromRequest(request, secret) {
  const token = readCookie(request, COOKIE_NAME);
  if (!token) return null;
  const payload = await verify(token, secret);
  if (!payload || typeof payload.code !== 'string' || !payload.code.trim()) return null;
  return payload;
}

export async function isAllowed(request, secret) {
  return (await sessionFromRequest(request, secret)) !== null;
}
