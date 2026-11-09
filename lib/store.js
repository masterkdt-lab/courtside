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
// All eight return promises in both backends.

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
