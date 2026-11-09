// api/member.js — POST /api/member (CONCEPT02_WAVE2_PLAN.md section 6). One route, `action` picks:
//   open (no cookie) { memberId }: the personal link. Sets cs_member.
//        200 { ok:true, group:{ groupId, name, organizerName, chosenWeek, weekLabel, tennis, stage }, member, isOrganizer }
//   join (no cookie) { groupId, name, email, role }: the shared group link. A non-removed member of the
//        group with that email is reused (and marked Responded / Interested), else a row is appended.
//        Sets cs_member. 200 { ok:true, memberId, member, group:{…}, isOrganizer }
//   add (organizer) { name, email, role } → 200 { ok:true, member, link:"/#/join/CSM-…" }; a duplicate
//        email in the group is 400 { email: "That email is already in your group." }
//   invite (organizer) { memberId, email? } → Link shared, invitedAt → 200 { ok:true, member, link }
//   cancel (organizer) { memberId } → Invitation canceled, participation "" → 200 { ok:true, member }
//   remove (organizer) { memberId } → removed TRUE (never the organizer: 400) → 200 { ok:true, member }
//   respond (self) { participation } → participation, Responded, joinedAt if blank → 200 { ok:true, member }
//   preferences (self) { participation, role, level, tennis, room, roommate, interests, care, complete }
//        → the preference columns and planningComplete → 200 { ok:true, member }
//   arrival (self) { airport, date, flight, time } → the four arrival columns → 200 { ok:true, member }
// `member` is the affected row (the caller's own for open/join/respond/preferences/arrival, the
// target's for the organizer actions), every column, camelCase. Organizer actions need the
// organizer's cookie (else 403); a target outside the group, removed or unknown is 404. Every action
// counts against the "group" rate limit (30 per 10 minutes per IP hash) and appends a Log row
// { member_<action>, memberId }. 401 without a valid cookie on the cookie actions; 400 { errors };
// 429 rate_limited; 500 server_error.

import * as store from '../lib/store.js';
import { isOrganizerRole, isResponse, memberCookie, requireMember } from '../lib/access.js';
import { getSecret } from '../lib/env.js';
import {
  FLAG, ROLES, flag, memberLink, newMemberRow, publicGroup, roleFor, weeksById,
} from '../lib/groups.js';
import { NOT_JSON, badRequest, forbidden, json, notFound, rateLimited, readJson, serverError } from '../lib/http.js';
import { clientIp, ipHash, memberId as newMemberId } from '../lib/ids.js';
import { logEvent } from '../lib/log.js';
import { check } from '../lib/ratelimit.js';
import { MEMBER_ORGANIZER_ACTIONS, MEMBER_PUBLIC_ACTIONS, validateMember } from '../lib/validate.js';

export const RATE_LIMIT_BUCKET = 'group';
export const LOG_PREFIX = 'member_';
export const DUPLICATE_EMAIL = 'That email is already in your group.';
export const REMOVE_SELF = 'You can’t remove yourself from your own group.';
export const CANCEL_SELF = 'You can’t cancel your own invitation.';

const sameEmail = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
const emailTaken = (members, email, exceptId = null) => members.some((m) => !m.removed && m.memberId !== exceptId && sameEmail(m.email, email));

export async function POST(request) {
  const secret = getSecret();
  const hash = await ipHash(clientIp(request), secret);
  if (!check(RATE_LIMIT_BUCKET, hash).allowed) return rateLimited();

  const body = await readJson(request);
  if (body === undefined) return badRequest(NOT_JSON);

  const result = validateMember(body);
  if (!result.ok) return badRequest(result.errors);
  const { value } = result;
  const now = new Date().toISOString();
  const log = (memberId) => logEvent(LOG_PREFIX + value.action, memberId, hash, 'api/member');

  try {
    if (MEMBER_PUBLIC_ACTIONS.includes(value.action)) {
      if (value.action === 'open') {
        const member = await store.getMember(value.memberId);
        if (!member || member.removed) return notFound();
        const group = await store.getGroup(member.groupId);
        if (!group) return notFound();
        const byId = weeksById(await store.listWeeks());
        const headers = await memberCookie(request, { groupId: group.groupId, memberId: member.memberId }, secret);
        await log(member.memberId);
        return json(200, { ok: true, group: publicGroup(group, byId), member, isOrganizer: isOrganizerRole(member.role) }, headers);
      }

      // join
      const group = await store.getGroup(value.groupId);
      if (!group) return notFound();
      const members = await store.listMembers(group.groupId);
      const existing = members.find((m) => !m.removed && sameEmail(m.email, value.email));
      let member;
      if (existing) {
        member = await store.updateMember(existing.memberId, {
          inviteStatus: 'Responded', participation: 'Interested', joinedAt: existing.joinedAt || now,
        });
      } else {
        member = await store.appendMember(newMemberRow({
          memberId: newMemberId(), groupId: group.groupId, name: value.name, email: value.email, role: value.role,
          inviteStatus: 'Responded', participation: 'Interested', joinedAt: now, now,
        }));
      }
      const byId = weeksById(await store.listWeeks());
      const headers = await memberCookie(request, { groupId: group.groupId, memberId: member.memberId }, secret);
      await log(member.memberId);
      return json(200, { ok: true, memberId: member.memberId, member, group: publicGroup(group, byId), isOrganizer: isOrganizerRole(member.role) }, headers);
    }

    const ctx = await requireMember(request, secret);
    if (isResponse(ctx)) return ctx;

    if (MEMBER_ORGANIZER_ACTIONS.includes(value.action)) {
      if (!ctx.isOrganizer) return forbidden();
      const members = await store.listMembers(ctx.groupId);

      if (value.action === 'add') {
        if (emailTaken(members, value.email)) return badRequest({ email: DUPLICATE_EMAIL });
        const member = await store.appendMember(newMemberRow({
          memberId: newMemberId(), groupId: ctx.groupId, name: value.name, email: value.email, role: value.role, inviteStatus: 'Not invited', now,
        }));
        await log(member.memberId);
        return json(200, { ok: true, member, link: memberLink(member.memberId) });
      }

      const target = members.find((m) => m.memberId === value.memberId);
      if (!target || target.removed) return notFound();

      if (value.action === 'invite') {
        if (value.email && emailTaken(members, value.email, target.memberId)) return badRequest({ email: DUPLICATE_EMAIL });
        const patch = { inviteStatus: 'Link shared', invitedAt: now };
        if (value.email) patch.email = value.email;
        const member = await store.updateMember(target.memberId, patch);
        await log(member.memberId);
        return json(200, { ok: true, member, link: memberLink(member.memberId) });
      }
      if (value.action === 'cancel') {
        if (target.memberId === ctx.memberId) return badRequest({ memberId: CANCEL_SELF });
        const member = await store.updateMember(target.memberId, { inviteStatus: 'Invitation canceled', participation: '' });
        await log(member.memberId);
        return json(200, { ok: true, member });
      }
      // remove
      if (target.memberId === ctx.memberId) return badRequest({ memberId: REMOVE_SELF });
      const member = await store.updateMember(target.memberId, { removed: FLAG.yes });
      await log(member.memberId);
      return json(200, { ok: true, member });
    }

    // Self actions.
    let patch;
    if (value.action === 'respond') {
      patch = { participation: value.participation, inviteStatus: 'Responded', joinedAt: ctx.member.joinedAt || now };
    } else if (value.action === 'preferences') {
      patch = {
        participation: value.participation,
        role: roleFor(value.role, { isOrganizer: ctx.isOrganizer }),
        level: value.level,
        tennis: value.tennis,
        room: value.room,
        roommate: value.roommate,
        interests: value.interests,
        careNotes: value.care,
        planningComplete: flag(value.complete),
      };
    } else {
      patch = { arrivalAirport: value.airport, arrivalDate: value.date, arrivalFlight: value.flight, arrivalTime: value.time };
    }
    const member = await store.updateMember(ctx.memberId, patch);
    await log(member.memberId);
    return json(200, { ok: true, member });
  } catch (err) {
    console.error('[api/member]', err);
    return serverError();
  }
}

export { ROLES };
