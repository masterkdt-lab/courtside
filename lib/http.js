// lib/http.js
// Small helpers shared by the api/ routes: JSON responses, tolerant JSON body parsing and the
// "should the cookie be Secure" check. No node: imports.

export function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}

// The error shapes every Wave 2 route shares (CONCEPT02_WAVE2_PLAN.md section 6).
export const unauthorized = () => json(401, { ok: false, reason: 'unauthorized' });
export const forbidden = () => json(403, { ok: false, reason: 'forbidden' });
export const notFound = () => json(404, { ok: false, reason: 'not_found' });
export const conflict = (reason, message) => json(409, { ok: false, reason, message });
export const rateLimited = () => json(429, { ok: false, reason: 'rate_limited' });
export const serverError = () => json(500, { ok: false, reason: 'server_error' });
export const badRequest = (errors) => json(400, { ok: false, errors });
export const NOT_JSON = Object.freeze({ body: 'Send the request as JSON.' });

// -> parsed body, or undefined when there is no body or it is not valid JSON.
export async function readJson(request) {
  try {
    const text = await request.text();
    if (!text.trim()) return undefined;
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// Secure cookies when the request is https or we are on Vercel; never on http://localhost.
export function isSecureRequest(request, env = process.env) {
  try {
    if (new URL(request.url).protocol === 'https:') return true;
  } catch {
    // fall through
  }
  return Boolean(env.VERCEL);
}
