// api/concierge.js — GET and POST /api/concierge (CONCEPT02_WAVE2_PLAN.md section 6; cs_member cookie)
//   GET  200 { ok:true, requests:[…] }: the member's own ConciergeRequests rows (organizers: the whole
//        group's), camelCase, `history` split into lines, `cost` a number (0 when blank).
//   POST { action, … }
//     create { category, subject, details, timing } → one row: status Received, assignedTo "", history
//        "Request received. Courtside will review the details. · <ISO>". A Proposal question also sets
//        the member's proposalStatus to Review requested. 200 { ok:true, request }. Log concierge_create.
//     cancel { conciergeId } (own request, not Confirmed, not already Canceled) → Canceled + a history
//        line. Log concierge_cancel.
//     approve / decline { conciergeId } (own request, status Approval needed) → Approved / Declined + a
//        history line. Log concierge_approve / concierge_decline.
//   Courtside's columns (status to Checking options / Approval needed / Unavailable / Confirmed, offer,
//   cost, assignedTo, extra history) are edited in the Sheet only; the guest sees them on reload.
//   401 unauthorized · 403 forbidden (someone else's request, the organizer included) · 404 not_found
//   (unknown, or another group's) · 409 { reason, message } for the wrong status · 400 { errors } ·
//   429 rate_limited (bucket "group") · 500 server_error.

import * as store from '../lib/store.js';
import { isResponse, requireMember } from '../lib/access.js';
import { getSecret } from '../lib/env.js';
import { MEMBER_PROPOSAL_STATUS, appendHistory, conciergeView, historyLine } from '../lib/groups.js';
import { NOT_JSON, badRequest, conflict, forbidden, json, notFound, rateLimited, readJson, serverError } from '../lib/http.js';
import { clientIp, conciergeId as newConciergeId, ipHash } from '../lib/ids.js';
import { logEvent } from '../lib/log.js';
import { check } from '../lib/ratelimit.js';
import { validateConcierge } from '../lib/validate.js';

export const RATE_LIMIT_BUCKET = 'group';
export const LOG_PREFIX = 'concierge_';
export const RECEIVED_LINE = 'Request received. Courtside will review the details.';
export const PROPOSAL_QUESTION = 'Proposal question';
export const APPROVAL_NEEDED = 'Approval needed';
export const CONFLICTS = Object.freeze({
  confirmed: Object.freeze({ reason: 'confirmed', message: 'This request is already confirmed. Ask Courtside to change it.' }),
  canceled: Object.freeze({ reason: 'already_canceled', message: 'This request was already canceled.' }),
  notAwaitingApproval: Object.freeze({ reason: 'not_awaiting_approval', message: 'This request is not waiting for your approval.' }),
});

const mine = (rows, ctx) => (ctx.isOrganizer ? rows : rows.filter((r) => r.memberId === ctx.memberId));

export async function GET(request) {
  try {
    const ctx = await requireMember(request);
    if (isResponse(ctx)) return ctx;
    const rows = await store.listConcierge(ctx.groupId);
    return json(200, { ok: true, requests: mine(rows, ctx).map(conciergeView) });
  } catch (err) {
    console.error('[api/concierge]', err);
    return serverError();
  }
}

export async function POST(request) {
  const secret = getSecret();
  const hash = await ipHash(clientIp(request), secret);
  if (!check(RATE_LIMIT_BUCKET, hash).allowed) return rateLimited();

  const body = await readJson(request);
  if (body === undefined) return badRequest(NOT_JSON);

  const result = validateConcierge(body);
  if (!result.ok) return badRequest(result.errors);
  const { value } = result;
  const now = new Date().toISOString();

  try {
    const ctx = await requireMember(request, secret);
    if (isResponse(ctx)) return ctx;
    const log = (id) => logEvent(LOG_PREFIX + value.action, id, hash, 'api/concierge');

    if (value.action === 'create') {
      const row = await store.appendConcierge({
        conciergeId: newConciergeId(),
        groupId: ctx.groupId,
        memberId: ctx.memberId,
        requesterName: ctx.member.name,
        category: value.category,
        subject: value.subject,
        details: value.details,
        preferredTiming: value.timing,
        status: 'Received',
        offer: '',
        cost: '',
        assignedTo: '',
        history: historyLine(RECEIVED_LINE, now),
        createdAt: now,
        updatedAt: now,
      });
      if (value.category === PROPOSAL_QUESTION) await store.updateMember(ctx.memberId, { proposalStatus: MEMBER_PROPOSAL_STATUS.reviewRequested });
      await log(row.conciergeId);
      return json(200, { ok: true, request: conciergeView(row) });
    }

    const existing = await store.getConcierge(value.conciergeId);
    if (!existing || existing.groupId !== ctx.groupId) return notFound();
    if (existing.memberId !== ctx.memberId) return forbidden();

    let patch;
    if (value.action === 'cancel') {
      if (existing.status === 'Confirmed') return conflict(CONFLICTS.confirmed.reason, CONFLICTS.confirmed.message);
      if (existing.status === 'Canceled') return conflict(CONFLICTS.canceled.reason, CONFLICTS.canceled.message);
      patch = { status: 'Canceled', history: appendHistory(existing.history, historyLine(`Request canceled by ${ctx.member.name}.`, now)) };
    } else {
      if (existing.status !== APPROVAL_NEEDED) return conflict(CONFLICTS.notAwaitingApproval.reason, CONFLICTS.notAwaitingApproval.message);
      const approved = value.action === 'approve';
      patch = {
        status: approved ? 'Approved' : 'Declined',
        history: appendHistory(existing.history, historyLine(`Offer ${approved ? 'approved' : 'declined'} by ${ctx.member.name}.`, now)),
      };
    }
    const row = await store.updateConcierge(existing.conciergeId, patch);
    await log(row.conciergeId);
    return json(200, { ok: true, request: conciergeView(row) });
  } catch (err) {
    console.error('[api/concierge]', err);
    return serverError();
  }
}
