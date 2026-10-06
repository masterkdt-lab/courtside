// api/session.js — GET /api/session (plan 4.4)
//   200 { ok:true, code, invitedBy, issuedTo } | 401 { ok:false }

import { getSecret } from '../lib/env.js';
import { sessionFromRequest } from '../lib/guard.js';
import { json } from '../lib/http.js';

export async function GET(request) {
  const session = await sessionFromRequest(request, getSecret());
  if (!session) return json(401, { ok: false });
  return json(200, {
    ok: true,
    code: session.code,
    invitedBy: typeof session.invitedBy === 'string' ? session.invitedBy : '',
    issuedTo: typeof session.issuedTo === 'string' ? session.issuedTo : '',
  });
}
