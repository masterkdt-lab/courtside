// lib/ids.js
// Request IDs, the Wave 2 ids and the per-IP hash (plan 4.0; CONCEPT02_WAVE2_PLAN.md section 6).
// Web Crypto only.

export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const ID_LENGTH = 8;

// Prefixes: CS- requests, CSG- groups, CSM- members, CSR- concierge, CSP- proposals, CSY- payments.
export const ID_PREFIXES = Object.freeze({
  request: 'CS-', group: 'CSG-', member: 'CSM-', concierge: 'CSR-', proposal: 'CSP-', payment: 'CSY-',
});

// Matches any id this file makes: a prefix from ID_PREFIXES and 8 Crockford characters.
export const ID_SHAPE = /^CS[GMRPY]?-[0-9A-HJKMNP-TV-Z]{8}$/;

// <prefix> + 8 random Crockford base32 characters, e.g. CS-7Q3M9KX2 or CSG-7Q3M9KX2.
export function makeId(prefix) {
  const bytes = new Uint8Array(ID_LENGTH);
  globalThis.crypto.getRandomValues(bytes);
  let id = prefix;
  for (const byte of bytes) id += CROCKFORD[byte & 31];
  return id;
}

export const requestId = () => makeId(ID_PREFIXES.request);
export const groupId = () => makeId(ID_PREFIXES.group);
export const memberId = () => makeId(ID_PREFIXES.member);
export const conciergeId = () => makeId(ID_PREFIXES.concierge);
export const proposalId = () => makeId(ID_PREFIXES.proposal);
export const paymentId = () => makeId(ID_PREFIXES.payment);

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
