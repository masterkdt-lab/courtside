// lib/http.js
// Small helpers shared by the api/ routes: JSON responses, tolerant JSON body parsing and the
// "should the cookie be Secure" check. No node: imports.

export function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}

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
