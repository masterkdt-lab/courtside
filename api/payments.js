// api/payments.js — GET /api/payments (CONCEPT02_WAVE2_PLAN.md section 6; cs_member cookie; read-only)
//   200 { ok:true, payments:[…] }: the member's own Payments rows (organizers: the whole group's),
//   camelCase, `amount` a number. The site only ever appends here (the pending deposit on
//   acceptance, api/proposal.js); Courtside marks `status` paid and `paidAt` in the Sheet, which is
//   what unlocks Trip home. 401 unauthorized · 500 server_error.

import * as store from '../lib/store.js';
import { isResponse, requireMember } from '../lib/access.js';
import { json, serverError } from '../lib/http.js';
import { withSheetScope } from '../lib/request-scope.js';

async function handleGet(request) {
  try {
    const ctx = await requireMember(request);
    if (isResponse(ctx)) return ctx;
    const rows = await store.listPayments(ctx.groupId);
    return json(200, { ok: true, payments: ctx.isOrganizer ? rows : rows.filter((r) => r.memberId === ctx.memberId) });
  } catch (err) {
    console.error('[api/payments]', err);
    return serverError();
  }
}

// One request scope per call: every store read in the request shares one Sheets snapshot
// (lib/request-scope.js, lib/store.sheets.js).
export const GET = withSheetScope(handleGet);
