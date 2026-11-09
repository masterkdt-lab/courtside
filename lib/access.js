// lib/access.js
// The member cookie (CONCEPT02_WAVE2_PLAN.md section 6 "Identity and access"): cs_member, a second
// signed HttpOnly cookie built with lib/cookie.js's sign/verify and the same COOKIE_SECRET, payload
// { scope:"member", groupId, memberId, exp }, 90 days, SameSite=Lax, Secure off localhost. It is
// set by the group path of POST /api/inquiry (the organizer's own row), POST /api/member `open` (a
// personal link) and `join` (the shared group link). The invite cookie cs_session plays no part in
// group access.
//
//   memberSession(request)  -> { scope, groupId, memberId, exp } or null
//   requireMember(request)  -> { groupId, memberId, member, group, isOrganizer } or a 401 Response:
//                              the cookie must verify, the member row must exist, not be removed and
//                              belong to the cookie's group, and the group row must exist.
//   memberCookie(request, { groupId, memberId }) -> { 'Set-Cookie': ... } for a route's response

import * as store from './store.js';
import { readCookie, sign, verify } from './cookie.js';
import { getSecret } from './env.js';
import { isSecureRequest, unauthorized } from './http.js';

export const MEMBER_COOKIE_NAME = 'cs_member';
export const MEMBER_COOKIE_MAX_AGE = 90 * 24 * 60 * 60; // seconds: 90 days = 7776000
export const MEMBER_SCOPE = 'member';
export const ORGANIZER_PREFIX = 'Organizer';

export const isOrganizerRole = (role) => String(role ?? '').trim().startsWith(ORGANIZER_PREFIX);

export async function signMember({ groupId, memberId }, secret = getSecret(), now = Date.now()) {
  return sign({ scope: MEMBER_SCOPE, groupId, memberId, exp: now + MEMBER_COOKIE_MAX_AGE * 1000 }, secret);
}

export function buildMemberCookie(token, { secure = false } = {}) {
  const parts = [`${MEMBER_COOKIE_NAME}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${MEMBER_COOKIE_MAX_AGE}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

// The Set-Cookie header a route adds to its 200 for a member.
export async function memberCookie(request, { groupId, memberId }, secret = getSecret()) {
  const token = await signMember({ groupId, memberId }, secret);
  return { 'Set-Cookie': buildMemberCookie(token, { secure: isSecureRequest(request) }) };
}

// -> the cookie payload when cs_member is present, correctly signed, not expired and shaped like a
// member payload; otherwise null.
export async function memberSession(request, secret = getSecret()) {
  const token = readCookie(request, MEMBER_COOKIE_NAME);
  if (!token) return null;
  const payload = await verify(token, secret);
  if (!payload || payload.scope !== MEMBER_SCOPE) return null;
  if (typeof payload.groupId !== 'string' || !payload.groupId.trim()) return null;
  if (typeof payload.memberId !== 'string' || !payload.memberId.trim()) return null;
  return payload;
}

// -> { groupId, memberId, member, group, isOrganizer }, or a 401 Response the route returns as is.
export async function requireMember(request, secret = getSecret()) {
  const session = await memberSession(request, secret);
  if (!session) return unauthorized();
  const member = await store.getMember(session.memberId);
  if (!member || member.removed || member.groupId !== session.groupId) return unauthorized();
  const group = await store.getGroup(session.groupId);
  if (!group) return unauthorized();
  return { groupId: group.groupId, memberId: member.memberId, member, group, isOrganizer: isOrganizerRole(member.role) };
}

export const isResponse = (value) => value instanceof Response;
