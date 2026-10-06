// api/code.js — POST /api/code { code } (plan 4.4)
//   200 { ok:true, invitedBy, issuedTo } + Set-Cookie cs_session
//   400 { ok:false, reason:"missing_code" }
//   401 { ok:false, reason:"invalid"|"paused"|"used_up" }
//   429 { ok:false, reason:"rate_limited" }
// Every outcome is written to the Log tab via store.logAttempt.

import * as store from '../lib/store.js';
import { COOKIE_MAX_AGE, buildSetCookie, sign } from '../lib/cookie.js';
import { getSecret } from '../lib/env.js';
import { clientIp, ipHash } from '../lib/ids.js';
import { check } from '../lib/ratelimit.js';
import { isSecureRequest, json, readJson } from '../lib/http.js';

export async function POST(request) {
  const secret = getSecret();
  const hash = await ipHash(clientIp(request), secret);
  const body = await readJson(request);
  const code = body && typeof body === 'object' && typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';

  const fail = async (status, reason) => {
    await store.logAttempt({ code, result: reason, ipHash: hash });
    return json(status, { ok: false, reason });
  };

  try {
    if (!code) return await fail(400, 'missing_code');
    if (!check('code', hash).allowed) return await fail(429, 'rate_limited');

    const invite = await store.findInvite(code);
    if (!invite || (invite.status !== 'active' && invite.status !== 'paused')) return await fail(401, 'invalid');
    if (invite.status === 'paused') return await fail(401, 'paused');
    if (invite.maxUses !== null && invite.uses >= invite.maxUses) return await fail(401, 'used_up');

    await store.recordInviteUse(invite.code);
    await store.logAttempt({ code: invite.code, result: 'ok', ipHash: hash });

    const exp = Date.now() + COOKIE_MAX_AGE * 1000;
    const token = await sign({ code: invite.code, invitedBy: invite.invitedBy, issuedTo: invite.issuedTo, exp }, secret);
    return json(
      200,
      { ok: true, invitedBy: invite.invitedBy, issuedTo: invite.issuedTo },
      { 'Set-Cookie': buildSetCookie(token, { secure: isSecureRequest(request) }) },
    );
  } catch (err) {
    console.error('[api/code]', err);
    return json(500, { ok: false, reason: 'server_error' });
  }
}
