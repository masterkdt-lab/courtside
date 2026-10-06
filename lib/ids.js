// lib/ids.js
// Request IDs and the per-IP hash (plan 4.0). Web Crypto only.

export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// "CS-" + 8 random Crockford base32 characters, e.g. CS-7Q3M9KX2.
export function requestId() {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  let id = 'CS-';
  for (const byte of bytes) id += CROCKFORD[byte & 31];
  return id;
}

// First 16 hex characters of SHA-256(ip + secret).
export async function ipHash(ip, secret) {
  const data = new TextEncoder().encode(`${ip}${secret}`);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', data));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

// First x-forwarded-for value, else x-real-ip, else "local".
export function clientIp(request) {
  const header = (name) => request?.headers?.get?.(name) ?? '';
  const forwarded = header('x-forwarded-for').split(',')[0].trim();
  if (forwarded) return forwarded;
  const real = header('x-real-ip').trim();
  if (real) return real;
  return 'local';
}
