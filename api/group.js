// api/group.js — GET and POST /api/group (CONCEPT02_WAVE2_PLAN.md section 6; cs_member cookie)
//   GET  200 { ok:true, group, me:{ memberId, role, isOrganizer }, members:[…], weekLabels:{ weekId: label } }
//        `group` is the Groups row in camelCase. Organizers get every non-removed member with every
//        column; other members get { memberId, name, role, participation, planningComplete } only.
//   POST (organizer only) { action:"update", name, chosenWeek, tennis, paymentMode }
//        200 { ok:true, group }: name, chosenWeek, tennis and paymentMode change, `weeks` becomes the
//        week's label (or Flexible), reviewNeeded TRUE, updatedAt now. Log { group_update, groupId }.
//   401 unauthorized (no valid cookie, or the member or group is gone) · 403 forbidden (not the
//   organizer) · 400 { errors } · 429 rate_limited (bucket "group", 30 writes per 10 minutes per IP
//   hash, shared by every Wave 2 write) · 500 server_error.

import * as store from '../lib/store.js';
import { isResponse, requireMember } from '../lib/access.js';
import { getSecret } from '../lib/env.js';
import { FLAG, FLEXIBLE, FLEXIBLE_LABEL, organizerViewOfMember, publicMember, spainWeeks, weekLabels, weeksById } from '../lib/groups.js';
import { NOT_JSON, badRequest, forbidden, json, rateLimited, readJson, serverError } from '../lib/http.js';
import { clientIp, ipHash } from '../lib/ids.js';
import { logEvent } from '../lib/log.js';
import { check } from '../lib/ratelimit.js';
import { validateGroupUpdate } from '../lib/validate.js';

export const RATE_LIMIT_BUCKET = 'group';
export const LOG_UPDATE = 'group_update';

export async function GET(request) {
  try {
    const ctx = await requireMember(request);
    if (isResponse(ctx)) return ctx;
    const [members, weeks] = await Promise.all([store.listMembers(ctx.groupId), store.listWeeks()]);
    const active = members.filter((m) => !m.removed);
    return json(200, {
      ok: true,
      // Only the organizer sees the organizer's email; every member gets their own full row as `me`.
      group: ctx.isOrganizer ? ctx.group : { ...ctx.group, organizerEmail: '' },
      me: { ...ctx.member, memberId: ctx.memberId, role: ctx.member.role, isOrganizer: ctx.isOrganizer },
      members: active.map((m) => (m.memberId === ctx.memberId ? m : ctx.isOrganizer ? organizerViewOfMember(m) : publicMember(m))),
      weekLabels: weekLabels(weeks),
    });
  } catch (err) {
    console.error('[api/group]', err);
    return serverError();
  }
}

export async function POST(request) {
  const secret = getSecret();
  const hash = await ipHash(clientIp(request), secret);
  if (!check(RATE_LIMIT_BUCKET, hash).allowed) return rateLimited();

  const body = await readJson(request);
  if (body === undefined) return badRequest(NOT_JSON);

  try {
    const ctx = await requireMember(request, secret);
    if (isResponse(ctx)) return ctx;
    if (!ctx.isOrganizer) return forbidden();

    const weeks = spainWeeks(await store.listWeeks());
    const result = validateGroupUpdate(body, weeks.map((w) => w.weekId));
    if (!result.ok) return badRequest(result.errors);
    const { value } = result;

    const byId = weeksById(weeks);
    const group = await store.updateGroup(ctx.groupId, {
      name: value.name,
      chosenWeek: value.chosenWeek,
      tennis: value.tennis,
      paymentMode: value.paymentMode,
      weeks: value.chosenWeek === FLEXIBLE ? FLEXIBLE_LABEL : byId.get(value.chosenWeek).label,
      reviewNeeded: FLAG.yes,
    });
    await logEvent(LOG_UPDATE, ctx.groupId, hash, 'api/group');
    return json(200, { ok: true, group });
  } catch (err) {
    console.error('[api/group]', err);
    return serverError();
  }
}
