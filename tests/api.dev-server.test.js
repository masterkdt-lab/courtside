// tests/api.dev-server.test.js
// scripts/dev-server.js on port 0: pages, guard, static allow-list, API routing, cookies.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from '../scripts/dev-server.js';
import { _resetSentLog, sentLog } from '../lib/email.js';
import { _reset as resetRateLimit } from '../lib/ratelimit.js';
import { freshMockPath, privateBody, readMock, tempDir, useMockEnv } from './api.helpers.js';

let dir;
let server;
let base;

before(async () => {
  dir = tempDir('courtside-dev-');
  useMockEnv();
  freshMockPath(dir);
  server = createServer({ quiet: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => { resetRateLimit(); _resetSentLog(); });

const get = (path, init = {}) => fetch(base + path, { redirect: 'manual', ...init });
const postJson = (path, body, headers = {}) => fetch(base + path, {
  method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});
async function login(code = 'GUEST1') {
  const res = await postJson('/api/code', { code });
  assert.equal(res.status, 200, await res.clone().text());
  const setCookie = res.headers.get('set-cookie');
  assert.ok(setCookie, 'Set-Cookie reaches the client');
  return { res, cookie: setCookie.split(';')[0], setCookie };
}

test('/ serves the gate as HTML', async () => {
  const res = await get('/');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
  const html = await res.text();
  assert.ok(html.includes('id="gate"'));
  assert.ok(html.includes('/js/gate.js'));
});

test('/site redirects to / without a cookie and serves site.html with one', async () => {
  const anon = await get('/site');
  assert.equal(anon.status, 302);
  assert.equal(anon.headers.get('location'), '/');
  assert.equal((await get('/site.html')).status, 302);
  assert.equal((await get('/site', { headers: { cookie: 'cs_session=abc.def' } })).status, 302);

  const { cookie } = await login('GUEST1');
  const site = await get('/site', { headers: { cookie } });
  assert.equal(site.status, 200);
  assert.equal(site.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.ok((await site.text()).includes('id="requestModal"'));
  assert.equal((await get('/site.html', { headers: { cookie } })).status, 200);
  assert.equal((await get('/site?x=1#build', { headers: { cookie } })).status, 200);
});

test('POST /api/code end to end: JSON body in, JSON + Set-Cookie out', async () => {
  const { res, setCookie } = await login('GUEST1');
  assert.equal(res.headers.get('content-type'), 'application/json');
  assert.deepEqual(await res.json(), { ok: true, invitedBy: 'Katie', issuedTo: 'Ana Guest' });
  assert.match(setCookie, /^cs_session=[A-Za-z0-9_.-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000$/);
  const bad = await postJson('/api/code', { code: 'NOPE' });
  assert.equal(bad.status, 401);
  assert.deepEqual(await bad.json(), { ok: false, reason: 'invalid' });
  const empty = await fetch(`${base}/api/code`, { method: 'POST' });
  assert.equal(empty.status, 400);
  assert.deepEqual(readMock().log.slice(-3).map((r) => r.result), ['ok', 'invalid', 'missing_code']);
});

test('/api/session is 401 without and 200 with the cookie; /api/trips the same', async () => {
  const anon = await get('/api/session');
  assert.equal(anon.status, 401);
  assert.equal(anon.headers.get('content-type'), 'application/json');
  assert.deepEqual(await anon.json(), { ok: false });
  const { cookie } = await login('COURTSIDE');
  const ok = await get('/api/session', { headers: { cookie } });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true, code: 'COURTSIDE', invitedBy: 'Katie', issuedTo: 'Shared test code' });
  assert.equal((await get('/api/trips')).status, 401);
  const trips = await get('/api/trips', { headers: { cookie } });
  assert.equal(trips.status, 200);
  assert.equal((await trips.json()).weeks.length, 7);
});

test('POST /api/request end to end writes a row and logs emails', async () => {
  const { cookie } = await login('GUEST1');
  const res = await postJson('/api/request', privateBody({ weeks: ['w3'] }), { cookie });
  assert.equal(res.status, 200, await res.clone().text());
  const body = await res.json();
  assert.match(body.requestId, /^CS-[0-9A-HJKMNP-TV-Z]{8}$/);
  assert.equal(body.guestEmailSent, true);
  const row = readMock().requests.find((r) => r.request_id === body.requestId);
  assert.ok(row);
  assert.equal(row.weeks, 'Jan 24–30');
  assert.equal(sentLog.length, 2);
  const unauth = await postJson('/api/request', privateBody(), {});
  assert.equal(unauth.status, 401);
});

test('wrong methods and unknown API names', async () => {
  const wrong = await get('/api/code');
  assert.equal(wrong.status, 405);
  assert.equal(wrong.headers.get('allow'), 'POST');
  assert.deepEqual(await wrong.json(), { ok: false, reason: 'method_not_allowed' });
  assert.equal((await fetch(`${base}/api/session`, { method: 'POST' })).status, 405);
  assert.equal((await get('/api/nope')).status, 404);
  assert.equal((await get('/api/')).status, 308);
  assert.equal((await get('/api/../lib/store.js')).status, 404);
  assert.equal((await fetch(`${base}/`, { method: 'PUT' })).status, 405);
  assert.equal((await fetch(`${base}/`, { method: 'HEAD' })).status, 200);
});

test('static allow-list: pages and assets with correct types', async () => {
  const expect = async (path, type) => {
    const res = await get(path);
    assert.equal(res.status, 200, path);
    assert.equal(res.headers.get('content-type'), type, path);
    return res;
  };
  await expect('/privacy', 'text/html; charset=utf-8');
  await expect('/robots.txt', 'text/plain; charset=utf-8');
  await expect('/style.css', 'text/css; charset=utf-8');
  await expect('/js/site.js', 'text/javascript; charset=utf-8');
  await expect('/js/gate.js', 'text/javascript; charset=utf-8');
  await expect('/js/images.js', 'text/javascript; charset=utf-8');
  const png = await expect('/assets/courtside-lockup.png', 'image/png');
  assert.equal(Number(png.headers.get('content-length')) > 1000, true);
  await expect('/assets/katie-eva-coast.jpg', 'image/jpeg');
});

test('nothing else is served: lib/, api/, scripts/, tests/, dotfiles, package files, the plan, traversal', async () => {
  for (const path of [
    '/lib/store.js', '/lib/cookie.js', '/api/code.js', '/scripts/dev-server.js', '/tests/fixtures/seed.json',
    '/.env', '/.env.example', '/.gitignore', '/.git/HEAD', '/.data/mock.json',
    '/package.json', '/package-lock.json', '/vercel.json', '/middleware.js',
    '/COURTSIDE_PHASE1_PLAN.md', '/README.md', '/node_modules/google-auth-library/package.json',
    '/assets/../package.json', '/assets/%2e%2e/package.json', '/js/../lib/store.js', '/js/..%2f..%2fpackage.json',
    '/assets/.hidden', '/index.html', '/privacy.html', '/nope',
  ]) {
    const res = await get(path);
    assert.equal(res.status, 404, path);
  }
});

test('trailing slashes redirect to the clean path, like trailingSlash:false on Vercel', async () => {
  const site = await get('/site/?x=1');
  assert.equal(site.status, 308);
  assert.equal(site.headers.get('location'), '/site?x=1');
  assert.equal((await get('/style.css/')).headers.get('location'), '/style.css');
  assert.equal((await get('/js/')).status, 308);
  assert.equal((await get('/assets/')).status, 308);
  assert.equal((await get('/')).status, 200);
});
