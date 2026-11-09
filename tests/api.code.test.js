// tests/api.code.test.js
// POST /api/code and the cs_session invite cookie against the mock store, one mock file per test.

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { POST } from '../api/code.js';
import { getSecret } from '../lib/env.js';
import { sessionFromRequest } from '../lib/guard.js';
import { json } from '../lib/http.js';

// The invite cookie check that /api/inquiry relies on (the standalone /api/session route was
// retired with the old pages); same shape as that route so the assertions below still read cleanly.
async function session(request) {
  const s = await sessionFromRequest(request, getSecret());
  if (!s) return json(401, { ok: false });
  return json(200, { ok: true, code: s.code, invitedBy: s.invitedBy || '', issuedTo: s.issuedTo || '' });
}
import { COOKIE_MAX_AGE, sign, verify } from '../lib/cookie.js';
import { DEV_COOKIE_SECRET } from '../lib/guard.js';
import { _reset as resetRateLimit } from '../lib/ratelimit.js';
import { editMock, freshMockPath, getRequest, jsonRequest, loginCookie, readMock, tempDir, useMockEnv } from './api.helpers.js';

let dir;
before(() => { dir = tempDir(); useMockEnv(); });
after(() => fs.rmSync(dir, { recursive: true, force: true }));
beforeEach(() => { freshMockPath(dir); resetRateLimit(); useMockEnv(); });

const post = (body, headers = {}, base) => POST(jsonRequest('/api/code', body, { headers, base }));
const expectJson = async (res, status, body) => {
  assert.equal(res.status, status, await res.clone().text());
  assert.equal(res.headers.get('content-type'), 'application/json');
  const json = await res.json();
  if (body) assert.deepEqual(json, body);
  return json;
};

describe('POST /api/code', () => {
  test('missing or malformed body → 400 missing_code, logged', async () => {
    await expectJson(await post(undefined), 400, { ok: false, reason: 'missing_code' });
    await expectJson(await post('{not json'), 400, { ok: false, reason: 'missing_code' });
    await expectJson(await post({}), 400, { ok: false, reason: 'missing_code' });
    await expectJson(await post({ code: '   ' }), 400, { ok: false, reason: 'missing_code' });
    await expectJson(await post({ code: 123 }), 400, { ok: false, reason: 'missing_code' });
    await expectJson(await post([]), 400, { ok: false, reason: 'missing_code' });
    const log = readMock().log;
    assert.equal(log.length, 6);
    assert.ok(log.every((row) => row.result === 'missing_code' && row.code === ''));
  });

  test('unknown and revoked codes → 401 invalid', async () => {
    await expectJson(await post({ code: 'NOPE' }), 401, { ok: false, reason: 'invalid' });
    await editMock((data) => { data.invites.find((i) => i.code === 'GUEST1').status = 'revoked'; });
    await expectJson(await post({ code: 'GUEST1' }), 401, { ok: false, reason: 'invalid' });
    await editMock((data) => { data.invites.find((i) => i.code === 'COURTSIDE').status = 'weird'; });
    await expectJson(await post({ code: 'COURTSIDE' }), 401, { ok: false, reason: 'invalid' });
    assert.deepEqual(readMock().log.map((r) => `${r.code}:${r.result}`), ['NOPE:invalid', 'GUEST1:invalid', 'COURTSIDE:invalid']);
    assert.equal(readMock().invites.find((i) => i.code === 'GUEST1').uses, 0);
  });

  test('PAUSED1 → 401 paused', async () => {
    await expectJson(await post({ code: 'PAUSED1' }), 401, { ok: false, reason: 'paused' });
    assert.deepEqual(readMock().log.map((r) => `${r.code}:${r.result}`), ['PAUSED1:paused']);
  });

  test('ONCE1 works once; the second try is used_up', async () => {
    const first = await expectJson(await post({ code: 'ONCE1' }), 200);
    assert.equal(first.ok, true);
    await expectJson(await post({ code: 'ONCE1' }), 401, { ok: false, reason: 'used_up' });
    const invite = readMock().invites.find((i) => i.code === 'ONCE1');
    assert.equal(invite.uses, 1);
    assert.match(invite.last_used_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(readMock().log.map((r) => `${r.code}:${r.result}`), ['ONCE1:ok', 'ONCE1:used_up']);
  });

  test('GUEST1 → 200 with issuedTo "Ana Guest" and a signed cs_session cookie', async () => {
    const res = await post({ code: 'GUEST1' });
    await expectJson(res, 200, { ok: true, invitedBy: 'Katie', issuedTo: 'Ana Guest' });
    const setCookie = res.headers.get('set-cookie');
    assert.match(setCookie, /^cs_session=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=34560000$/);
    assert.equal(setCookie.includes('Secure'), false, 'no Secure on http://localhost');
    const token = setCookie.split(';')[0].slice('cs_session='.length);
    const payload = await verify(token, DEV_COOKIE_SECRET);
    assert.equal(payload.code, 'GUEST1');
    assert.equal(payload.invitedBy, 'Katie');
    assert.equal(payload.issuedTo, 'Ana Guest');
    assert.ok(Math.abs(payload.exp - (Date.now() + COOKIE_MAX_AGE * 1000)) < 5000);
    const data = readMock();
    assert.equal(data.invites.find((i) => i.code === 'GUEST1').uses, 1);
    assert.deepEqual(data.log.map((r) => `${r.code}:${r.result}`), ['GUEST1:ok']);
    assert.match(data.log[0].ip_hash, /^[0-9a-f]{16}$/);
    assert.match(data.log[0].time, /^\d{4}-\d{2}-\d{2}T/);
  });

  test('codes match case-insensitively and trimmed; COURTSIDE has no guest email', async () => {
    await expectJson(await post({ code: '  guest1 ' }), 200, { ok: true, invitedBy: 'Katie', issuedTo: 'Ana Guest' });
    await expectJson(await post({ code: 'courtside' }), 200, { ok: true, invitedBy: 'Katie', issuedTo: 'Shared test code' });
    assert.deepEqual(readMock().log.map((r) => r.code), ['GUEST1', 'COURTSIDE']);
  });

  test('the cookie is Secure on https and on Vercel', async () => {
    const https = await post({ code: 'GUEST1' }, {}, 'https://courtside.example');
    assert.ok(https.headers.get('set-cookie').endsWith('; Secure'));
    process.env.VERCEL = '1';
    try {
      const onVercel = await post({ code: 'GUEST1' });
      assert.ok(onVercel.headers.get('set-cookie').endsWith('; Secure'));
    } finally {
      delete process.env.VERCEL;
    }
    const local = await post({ code: 'GUEST1' });
    assert.equal(local.headers.get('set-cookie').includes('Secure'), false);
  });

  test('11th attempt from one IP within the window → 429 rate_limited; other IPs unaffected', async () => {
    const ip = { 'x-forwarded-for': '203.0.113.9' };
    for (let i = 1; i <= 10; i += 1) await expectJson(await post({ code: 'NOPE' }, ip), 401, { ok: false, reason: 'invalid' });
    await expectJson(await post({ code: 'GUEST1' }, ip), 429, { ok: false, reason: 'rate_limited' });
    await expectJson(await post({ code: 'GUEST1' }, { 'x-forwarded-for': '198.51.100.2' }), 200);
    const log = readMock().log;
    assert.equal(log.length, 12);
    assert.equal(log[10].result, 'rate_limited');
    assert.equal(log[10].code, 'GUEST1');
    assert.equal(new Set(log.slice(0, 11).map((r) => r.ip_hash)).size, 1);
    assert.notEqual(log[11].ip_hash, log[0].ip_hash);
    assert.equal(readMock().invites.find((i) => i.code === 'GUEST1').uses, 1);
  });
});

describe('the cs_session invite cookie', () => {
  test('200 with the cookie payload', async () => {
    const cookie = await loginCookie('GUEST1');
    const res = await session(getRequest('/api/session', { cookie }));
    await expectJson(res, 200, { ok: true, code: 'GUEST1', invitedBy: 'Katie', issuedTo: 'Ana Guest' });
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });

  test('401 without, with a tampered, and with an expired cookie', async () => {
    await expectJson(await session(getRequest('/api/session')), 401, { ok: false });
    const cookie = await loginCookie('GUEST1');
    await expectJson(await session(getRequest('/api/session', { cookie: `${cookie}x` })), 401, { ok: false });
    await expectJson(await session(getRequest('/api/session', { cookie: 'cs_session=nope' })), 401, { ok: false });
    const expired = await sign({ code: 'GUEST1', invitedBy: 'Katie', issuedTo: 'Ana Guest', exp: Date.now() - 1000 }, DEV_COOKIE_SECRET);
    await expectJson(await session(getRequest('/api/session', { cookie: `cs_session=${expired}` })), 401, { ok: false });
    const wrongSecret = await sign({ code: 'GUEST1', invitedBy: 'Katie', issuedTo: 'Ana Guest', exp: Date.now() + 1000 }, 'other');
    await expectJson(await session(getRequest('/api/session', { cookie: `cs_session=${wrongSecret}` })), 401, { ok: false });
  });

  test('a cookie signed with COOKIE_SECRET is honoured only while that secret is set', async () => {
    process.env.COOKIE_SECRET = 'real-secret';
    const cookie = await loginCookie('GUEST1');
    await expectJson(await session(getRequest('/api/session', { cookie })), 200);
    delete process.env.COOKIE_SECRET;
    await expectJson(await session(getRequest('/api/session', { cookie })), 401, { ok: false });
  });
});

test('a failed Log write never changes the response (best-effort logging)', async () => {
  await expectJson(await post({ code: 'NOPE' }), 401, { ok: false, reason: 'invalid' });
  assert.equal(readMock().log.length, 1);
  const mockFile = process.env.MOCK_DATA_PATH;
  const mockDir = path.dirname(mockFile);
  fs.chmodSync(mockFile, 0o444);
  fs.chmodSync(mockDir, 0o555);
  try {
    await expectJson(await post({ code: 'NOPE' }), 401, { ok: false, reason: 'invalid' });
    await expectJson(await post({ code: '' }), 400, { ok: false, reason: 'missing_code' });
  } finally {
    fs.chmodSync(mockDir, 0o755);
    fs.chmodSync(mockFile, 0o644);
  }
  assert.equal(readMock().log.length, 1, 'the failed writes left the log unchanged');
});
