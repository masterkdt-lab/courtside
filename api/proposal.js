// api/proposal.js — GET and POST /api/proposal (CONCEPT02_WAVE2_PLAN.md section 6; cs_member cookie)
//   GET  200 { ok:true, proposal, settings:{ depositDueDays } }: the member's Proposals row, created in
//        `draft` on the first read with the pricing rules in lib/groups.js priceProposal(): role and room
//        from the member, week = the group's chosen week label, players/partners from the group, the
//        fixed inclusions, addons = the member's Approved concierge subjects, basePrice 2995 (player) or
//        1995 (partner), extrasTotal = the Approved costs, packageTotal = base + extras, currency and the
//        deposit from the Settings tab (deposit_per_group on the organizer's proposal when the group pays
//        as one, 0 for the others), balanceDueDate = week start minus balance_due_days_before ('' when
//        flexible), status draft, version 1. While still draft, a later read refreshes the derived
//        columns (extras first of all) and bumps `version` when something changed; basePrice is left as
//        stored so a figure Courtside typed survives. Once sent/accepted the row is returned as stored.
//   POST { action:"accept", proposalId } (own proposal, status draft or sent)
//        → status accepted, acceptedAt; member proposalStatus Payment pending, paymentStatus Deposit
//        pending; when depositAmount > 0 one Payments row { type deposit, amount, currency, status
//        pending, dueDate = today + deposit_due_days, payer from the member }; when the organizer accepts
//        and the group is still Inquiry/Planning, stage → Proposal sent. 200 { ok:true, proposal, payment }
//        (payment null when no deposit is due). Log proposal_accept, payment_create.
//   401 unauthorized · 404 not_found (not the member's proposal) · 409 { reason, message } when already
//   accepted or declined · 400 { errors } · 429 rate_limited (bucket "group") · 500 server_error.

import * as store from '../lib/store.js';
import { isResponse, requireMember } from '../lib/access.js';
import { getSecret } from '../lib/env.js';
import {
  MEMBER_PAYMENT_STATUS, MEMBER_PROPOSAL_STATUS, STAGES, TRIP_ID, addDays, approvedExtras, draftChanges, priceProposal, todayYmd, weeksById,
} from '../lib/groups.js';
import { NOT_JSON, badRequest, conflict, json, notFound, rateLimited, readJson, serverError } from '../lib/http.js';
import { clientIp, ipHash, paymentId as newPaymentId, proposalId as newProposalId } from '../lib/ids.js';
import { logEvent } from '../lib/log.js';
import { check } from '../lib/ratelimit.js';
import { getSettings } from '../lib/settings.js';
import { validateProposal } from '../lib/validate.js';

export const RATE_LIMIT_BUCKET = 'group';
export const LOG_ACCEPT = 'proposal_accept';
export const LOG_PAYMENT = 'payment_create';
export const ACCEPTABLE = Object.freeze(['draft', 'sent']);
export const CONFLICTS = Object.freeze({
  accepted: Object.freeze({ reason: 'already_accepted', message: 'This proposal has already been accepted.' }),
  declined: Object.freeze({ reason: 'declined', message: 'This proposal was declined. Ask Courtside for a new one.' }),
});
const STAGE_PROPOSAL_SENT = STAGES[2];
const EARLY_STAGES = Object.freeze([STAGES[0], STAGES[1]]);

// The member's proposal, created or refreshed as the rules say. Shared by GET and (for the current
// figures) POST.
async function loadProposal(ctx, now) {
  const [settings, existing, requests, weeks] = await Promise.all([
    getSettings(), store.getProposalForMember(ctx.memberId), store.listConcierge(ctx.groupId), store.listWeeks(),
  ]);
  const extras = approvedExtras(requests, ctx.memberId);
  const priced = priceProposal({ member: ctx.member, group: ctx.group, extras, settings, byId: weeksById(weeks), isOrganizer: ctx.isOrganizer });

  if (!existing) {
    const proposal = await store.appendProposal({
      proposalId: newProposalId(),
      groupId: ctx.groupId,
      memberId: ctx.memberId,
      requestId: ctx.group.requestId,
      tripId: TRIP_ID,
      ...priced,
      status: 'draft',
      version: 1,
      createdAt: now,
      sentAt: '',
      acceptedAt: '',
    });
    return { proposal, settings, created: true };
  }
  if (existing.status === 'draft') {
    const patch = draftChanges(existing, priced);
    if (Object.keys(patch).length) {
      const proposal = await store.updateProposal(existing.proposalId, { ...patch, version: existing.version + 1 });
      return { proposal, settings, created: false };
    }
  }
  return { proposal: existing, settings, created: false };
}

export async function GET(request) {
  try {
    const ctx = await requireMember(request);
    if (isResponse(ctx)) return ctx;
    const { proposal, settings } = await loadProposal(ctx, new Date().toISOString());
    return json(200, { ok: true, proposal, settings: { depositDueDays: settings.depositDueDays } });
  } catch (err) {
    console.error('[api/proposal]', err);
    return serverError();
  }
}

export async function POST(request) {
  const secret = getSecret();
  const hash = await ipHash(clientIp(request), secret);
  if (!check(RATE_LIMIT_BUCKET, hash).allowed) return rateLimited();

  const body = await readJson(request);
  if (body === undefined) return badRequest(NOT_JSON);

  const result = validateProposal(body);
  if (!result.ok) return badRequest(result.errors);
  const { value } = result;

  try {
    const ctx = await requireMember(request, secret);
    if (isResponse(ctx)) return ctx;

    const now = new Date();
    const iso = now.toISOString();
    const existing = await store.getProposalForMember(ctx.memberId);
    if (!existing || existing.proposalId !== value.proposalId) return notFound();
    if (existing.status === 'accepted') return conflict(CONFLICTS.accepted.reason, CONFLICTS.accepted.message);
    if (!ACCEPTABLE.includes(existing.status)) return conflict(CONFLICTS.declined.reason, CONFLICTS.declined.message);

    // A draft is brought up to date before it is accepted, so the figures match what the page showed.
    const { proposal: current, settings } = await loadProposal(ctx, iso);
    const proposal = await store.updateProposal(current.proposalId, { status: 'accepted', acceptedAt: iso });
    await store.updateMember(ctx.memberId, { proposalStatus: MEMBER_PROPOSAL_STATUS.paymentPending, paymentStatus: MEMBER_PAYMENT_STATUS.depositPending });

    let payment = null;
    if (proposal.depositAmount > 0) {
      payment = await store.appendPayment({
        paymentId: newPaymentId(),
        proposalId: proposal.proposalId,
        groupId: ctx.groupId,
        memberId: ctx.memberId,
        payerName: ctx.member.name,
        payerEmail: ctx.member.email,
        type: 'deposit',
        amount: proposal.depositAmount,
        currency: proposal.currency || settings.currency,
        method: '',
        providerRef: '',
        status: 'pending',
        dueDate: addDays(todayYmd(now), settings.depositDueDays),
        paidAt: '',
        notes: '',
        createdAt: iso,
      });
    }
    if (ctx.isOrganizer && EARLY_STAGES.includes(ctx.group.stage)) await store.updateGroup(ctx.groupId, { stage: STAGE_PROPOSAL_SENT });

    await logEvent(LOG_ACCEPT, proposal.proposalId, hash, 'api/proposal');
    if (payment) await logEvent(LOG_PAYMENT, payment.paymentId, hash, 'api/proposal');
    return json(200, { ok: true, proposal, payment });
  } catch (err) {
    console.error('[api/proposal]', err);
    return serverError();
  }
}
