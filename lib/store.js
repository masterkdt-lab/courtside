// lib/store.js
// The data interface API routes call (plan 4.1). DATA_BACKEND=mock|sheets (default mock) picks
// the implementation. It is read on every call, so tests can switch it through process.env
// without re-importing.
//
//   findInvite(code)        -> { code, issuedTo, guestEmail, guestMobile, invitedBy, maxUses, uses, status, createdAt, lastUsedAt } | null
//   recordInviteUse(code)   -> updated invite | null          (uses += 1, last_used_at = now)
//   logAttempt({ code, result, ipHash })
//   listTrips()             -> [{ tripId, name, status, closedMessage }]
//   listWeeks()             -> [{ weekId, tripId, label, start, end, status, closedMessage }]
//   appendRequest(row)      -> { requestId }                  (row: camelCase Requests columns)
//   appendWaitlist(row)     -> { email, trip }                 (row: camelCase Waitlist columns; polish brief section 3)
//   appendHostApplication(row) -> { email }                    (row: camelCase HostApplications columns; CONCEPT02_PLAN.md)
//
// Wave 2 (CONCEPT02_WAVE2_PLAN.md section 6 "Store"; rows are camelCase objects of the section 2/5
// headers; a `patch` changes only its keys plus updatedAt where the tab has it; updates return the
// updated row or null when the id is unknown; nothing is ever deleted):
//   getGroup(groupId) / appendGroup(row) / updateGroup(groupId, patch)
//   listMembers(groupId) (removed ones included) / getMember(memberId) / appendMember(row) / updateMember(memberId, patch)
//   listConcierge(groupId) / getConcierge(conciergeId) / appendConcierge(row) / updateConcierge(conciergeId, patch)
//   getProposalForMember(memberId) / appendProposal(row) / updateProposal(proposalId, patch)
//   listPayments(groupId) / appendPayment(row)
//   listSettings() -> [{ key, value, note }]
//
// All return promises in both backends.

import * as mock from './store.mock.js';
import * as sheets from './store.sheets.js';
import { str } from './store.columns.js';

export const BACKENDS = Object.freeze({ mock, sheets });

export function backendName(env = process.env) {
  const name = str(env.DATA_BACKEND).trim().toLowerCase() || 'mock';
  if (!Object.hasOwn(BACKENDS, name)) {
    throw new Error(`Unknown DATA_BACKEND "${env.DATA_BACKEND}"; use "mock" or "sheets"`);
  }
  return name;
}

function impl() {
  return BACKENDS[backendName()];
}

export const findInvite = (code) => impl().findInvite(code);
export const recordInviteUse = (code) => impl().recordInviteUse(code);
export const logAttempt = (attempt) => impl().logAttempt(attempt);
export const listTrips = () => impl().listTrips();
export const listWeeks = () => impl().listWeeks();
export const appendRequest = (row) => impl().appendRequest(row);
export const appendWaitlist = (row) => impl().appendWaitlist(row);
export const appendHostApplication = (row) => impl().appendHostApplication(row);
export const getGroup = (groupId) => impl().getGroup(groupId);
export const appendGroup = (row) => impl().appendGroup(row);
export const updateGroup = (groupId, patch) => impl().updateGroup(groupId, patch);
export const listMembers = (groupId) => impl().listMembers(groupId);
export const getMember = (memberId) => impl().getMember(memberId);
export const getMemberAndGroup = (memberId, groupId) => impl().getMemberAndGroup(memberId, groupId);
export const appendMember = (row) => impl().appendMember(row);
export const updateMember = (memberId, patch) => impl().updateMember(memberId, patch);
export const listConcierge = (groupId) => impl().listConcierge(groupId);
export const getConcierge = (conciergeId) => impl().getConcierge(conciergeId);
export const appendConcierge = (row) => impl().appendConcierge(row);
export const updateConcierge = (conciergeId, patch) => impl().updateConcierge(conciergeId, patch);
export const getProposalForMember = (memberId) => impl().getProposalForMember(memberId);
export const appendProposal = (row) => impl().appendProposal(row);
export const updateProposal = (proposalId, patch) => impl().updateProposal(proposalId, patch);
export const listPayments = (groupId) => impl().listPayments(groupId);
export const appendPayment = (row) => impl().appendPayment(row);
export const listSettings = () => impl().listSettings();
