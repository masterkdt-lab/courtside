// lib/cookie.js
// The signed session cookie (plan 4.0): cs_session = base64url(json) + "." + base64url(HMAC-SHA256).
// Web Crypto only and no node: imports, so this exact file runs in Vercel's edge middleware, in
// Vercel functions and in the local dev server. Payload: { code, invitedBy, issuedTo, exp },
// exp in epoch milliseconds. Signatures are compared in constant time.

export const COOKIE_NAME = 'cs_session';
// KC, 2026-11-09: cookies stay until the visitor clears them. 400 days is the longest any browser
// keeps a cookie (Chrome caps Max-Age there), so this is "until cleared" in practice.
export const COOKIE_MAX_AGE = 400 * 24 * 60 * 60; // seconds: 400 days = 34560000

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const BASE64URL = /^[A-Za-z0-9_-]+$/;

function bytesToBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(text) {
  if (!BASE64URL.test(text)) throw new Error('not base64url');
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmac(secret, message) {
  const key = await globalThis.crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

// Same work regardless of where (or whether) the strings differ.
export function constantTimeEqual(a, b) {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i += 1) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export async function sign(payload, secret) {
  const body = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const mac = bytesToBase64Url(await hmac(secret, body));
  return `${body}.${mac}`;
}

// -> payload, or null for a malformed token, a bad signature or an exp that has passed.
export async function verify(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || typeof secret !== 'string' || !secret) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1 || token.indexOf('.', dot + 1) !== -1) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (!BASE64URL.test(body) || !BASE64URL.test(mac)) return null;
  const expected = bytesToBase64Url(await hmac(secret, body));
  if (!constantTimeEqual(expected, mac)) return null;
  let payload;
  try {
    payload = JSON.parse(decoder.decode(base64UrlToBytes(body)));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp <= now) return null;
  return payload;
}

export function buildSetCookie(token, { secure = false } = {}) {
  const parts = [`${COOKIE_NAME}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${COOKIE_MAX_AGE}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

// Value of `name` from the request's Cookie header, or null.
export function readCookie(request, name = COOKIE_NAME) {
  const header = request?.headers?.get?.('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    let value = part.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}
