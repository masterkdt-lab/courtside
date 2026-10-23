// tests/api.dev-server.test.js
// scripts/dev-server.js on port 0: pages (/ homepage, /invite gate, /pros, /privacy), the legacy
// /?invite=CODE redirect, the /site guard, the static allow-list (assets/derived/ included), API
// routing (including /api/waitlist and /api/event), cookies, and the 404 page.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, resolveStatic } from '../scripts/dev-server.js';
import { _resetSentLog, sentLog } from '../lib/email.js';
import { _reset as resetRateLimit } from '../lib/ratelimit.js';
import { freshMockPath, privateBody, readMock, tempDir, useMockEnv } from './api.helpers.js';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const exists = (file) => fs.existsSync(path.join(PUBLIC, file));

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
// fetch() normalises ".." away before sending; node:http sends the request target as given, so
// the server's own traversal guard is what answers. -> { status }
const rawGet = (target) => new Promise((resolve, reject) => {
  const { address, port } = server.address();
  http.get({ host: address, port, path: target }, (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode })); }).on('error', reject);
});
async function login(code = 'GUEST1') {
  const res = await postJson('/api/code', { code });
  assert.equal(res.status, 200, await res.clone().text());
  const setCookie = res.headers.get('set-cookie');
  assert.ok(setCookie, 'Set-Cookie reaches the client');
  return { res, cookie: setCookie.split(';')[0], setCookie };
}

test('/ serves the homepage as HTML', async () => {
  const res = await get('/');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.match(await res.text(), /<html/i);
});

test('/invite serves the gate as HTML', async () => {
  const res = await get('/invite');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
  const html = await res.text();
  assert.ok(html.includes('id="inviteForm"'), 'the gate form lives on /invite');
  assert.ok(html.includes('/js/gate.js'));
});

test('a legacy personal link on / redirects (302) to /invite with the query string kept verbatim', async () => {
  const expectRedirect = async (from, to) => {
    const res = await get(from);
    assert.equal(res.status, 302, from);
    assert.equal(res.headers.get('location'), to, from);
    assert.equal(res.headers.get('cache-control'), 'no-store', from);
  };
  await expectRedirect('/?invite=GUEST1', '/invite?invite=GUEST1');
  await expectRedirect('/?code=guest1', '/invite?code=guest1');
  await expectRedirect('/?invite=GUEST1&guest=Mallory', '/invite?invite=GUEST1&guest=Mallory');
  await expectRedirect('/?guest=x&code=GUEST1', '/invite?guest=x&code=GUEST1');
  // Only / redirects, and only for those two parameter names.
  assert.equal((await get('/?guest=Mallory')).status, 200);
  assert.equal((await get('/?utm_source=x')).status, 200);
  assert.equal((await get('/invite?invite=GUEST1')).status, 200);
  assert.equal((await get('/privacy?invite=GUEST1')).status, 200);
});

test('/pros is a page once public/pros.html exists (Wave 2 adds it) and a 404 before', async () => {
  // The route is mapped now so Wave 2 only has to add the file; until then the server must answer
  // 404, not crash. Flip the expectation by the file's presence rather than hard-coding either.
  const res = await get('/pros');
  if (exists('pros.html')) {
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
  } else {
    assert.equal(res.status, 404);
  }
  assert.equal((await get('/pros.html')).status, 404, 'clean URLs only, whether or not the file exists');
});

test('an unknown path is a 404: public/404.html as text/html when it exists, the plain text otherwise', async () => {
  // The frontend agent adds public/404.html on this branch; the expectation follows the file's presence
  // so the suite is green before and after it lands.
  for (const p of ['/nope', '/trips/mallorca', '/invite.html', '/assets/missing.jpg', '/404', '/404.html']) {
    const res = await get(p);
    assert.equal(res.status, 404, p);
    const body = await res.text();
    if (exists('404.html')) {
      assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8', p);
      assert.equal(body, fs.readFileSync(path.join(PUBLIC, '404.html'), 'utf8'), `${p} serves public/404.html verbatim`);
      assert.equal(Number(res.headers.get('content-length')), Buffer.byteLength(body), p);
    } else {
      assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8', p);
      assert.equal(body, 'Not found', p);
    }
  }
  const head = await fetch(`${base}/nope`, { method: 'HEAD', redirect: 'manual' });
  assert.equal(head.status, 404);
  assert.equal(await head.text(), '', 'HEAD carries no body');
  // API misses stay JSON so a script never receives an HTML page.
  const api = await get('/api/nope');
  assert.equal(api.status, 404);
  assert.equal(api.headers.get('content-type'), 'application/json');
  assert.deepEqual(await api.json(), { ok: false, reason: 'not_found' });
  assert.equal((await fetch(`${base}/api/nope`, { method: 'POST' })).status, 404);
});

test('POST /api/waitlist end to end: no cookie, JSON in, JSON out, one Waitlist row and one Log row', async () => {
  const body = { email: 'Ana.Guest@Example.com', name: 'Ana Guest', tripId: 'mallorca', source: 'card', consent: true, website: '' };
  const res = await postJson('/api/waitlist', body, { 'x-forwarded-for': '198.51.100.40' });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(res.headers.get('content-type'), 'application/json');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), { ok: true });
  const mock = readMock();
  const row = mock.waitlist.at(-1);
  assert.deepEqual({ ...row, timestamp: 'ISO' }, { timestamp: 'ISO', email: 'ana.guest@example.com', name: 'Ana Guest', trip: 'Mallorca', source: 'card' });
  assert.match(row.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  const log = mock.log.at(-1);
  assert.equal(log.code, 'waitlist_submit');
  assert.equal(log.result, 'mallorca');
  assert.match(log.ip_hash, /^[0-9a-f]{16}$/);

  const bad = await postJson('/api/waitlist', { ...body, email: 'nope', consent: false }, { 'x-forwarded-for': '198.51.100.40' });
  assert.equal(bad.status, 400);
  assert.deepEqual(await bad.json(), { ok: false, errors: { email: 'Enter a valid email address.', consent: 'Please tick the box so we can keep your email.' } });
  const wrong = await get('/api/waitlist');
  assert.equal(wrong.status, 405);
  assert.equal(wrong.headers.get('allow'), 'POST');
});

test('POST /api/event end to end: a text/plain beacon body, 204 with no body, one Log row', async () => {
  const before = readMock().log.length;
  const res = await fetch(`${base}/api/event`, {
    method: 'POST', redirect: 'manual', headers: { 'content-type': 'text/plain;charset=UTF-8', 'x-forwarded-for': '198.51.100.41' },
    body: JSON.stringify({ name: 'trip_card_open', detail: 'geneva' }),
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('content-length') ?? '0', '0');
  assert.equal(await res.text(), '');
  const log = readMock().log;
  assert.equal(log.length, before + 1);
  assert.deepEqual({ code: log.at(-1).code, result: log.at(-1).result }, { code: 'trip_card_open', result: 'geneva' });
  const unknown = await postJson('/api/event', { name: 'page_view', detail: '' }, { 'x-forwarded-for': '198.51.100.41' });
  assert.equal(unknown.status, 400);
  assert.equal((await unknown.json()).ok, false);
  assert.equal((await get('/api/event')).status, 405);
});

test('/site redirects to /invite without a cookie and serves site.html with one', async () => {
  const anon = await get('/site');
  assert.equal(anon.status, 302);
  assert.equal(anon.headers.get('location'), '/invite');
  assert.equal(anon.headers.get('cache-control'), 'no-store');
  const html = await get('/site.html');
  assert.equal(html.status, 302);
  assert.equal(html.headers.get('location'), '/invite');
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
  await expect('/marketing.css', 'text/css; charset=utf-8');
  await expect('/js/site.js', 'text/javascript; charset=utf-8');
  await expect('/js/gate.js', 'text/javascript; charset=utf-8');
  await expect('/js/images.js', 'text/javascript; charset=utf-8');
  const png = await expect('/assets/courtside-lockup.png', 'image/png');
  assert.equal(Number(png.headers.get('content-length')) > 1000, true);
  await expect('/assets/katie-eva-coast.jpg', 'image/jpeg');
  // assets/derived/ (npm run images) is one level down and served recursively.
  const manifest = await expect('/assets/derived/manifest.json', 'application/json');
  assert.ok(Object.keys(await manifest.json()).length > 0);
  await expect('/assets/derived/katie-eva-coast-480.webp', 'image/webp');
  await expect('/assets/derived/katie-eva-coast-480.jpg', 'image/jpeg');
  assert.equal((await get('/assets/derived')).status, 404, 'a directory is not a file');
  assert.equal((await get('/assets/derived/')).status, 308, 'trailing slash redirects like any other path');
});

test('nothing else is served: lib/, api/, scripts/, tests/, dotfiles, package files, the plan, *.html by name, traversal', async () => {
  for (const path of [
    '/lib/store.js', '/lib/cookie.js', '/api/code.js', '/scripts/dev-server.js', '/tests/fixtures/seed.json',
    '/.env', '/.env.example', '/.gitignore', '/.git/HEAD', '/.data/mock.json',
    '/package.json', '/package-lock.json', '/vercel.json', '/middleware.js',
    '/COURTSIDE_PHASE1_PLAN.md', '/COURTSIDE_PHASE2_PLAN.md', '/README.md', '/node_modules/google-auth-library/package.json',
    '/assets/../package.json', '/assets/%2e%2e/package.json', '/js/../lib/store.js', '/js/..%2f..%2fpackage.json',
    '/assets/derived/../../package.json', '/assets/derived/%2e%2e/%2e%2e/package.json', '/assets/derived/..%2f..%2fpackage.json',
    '/assets/derived//manifest.json', '/assets/derived/.hidden',
    '/assets/.hidden', '/index.html', '/invite.html', '/pros.html', '/privacy.html', '/site.html.bak', '/nope',
  ]) {
    const res = await get(path);
    assert.equal(res.status, 404, path);
  }
  // Literal ".." on the wire (fetch would normalise it away) and the resolver itself.
  assert.equal((await rawGet('/assets/derived/../../package.json')).status, 404);
  assert.equal((await rawGet('/assets/../package.json')).status, 404);
  assert.equal((await rawGet('/assets/../../.env')).status, 404);
  assert.equal(resolveStatic('/assets/derived/../../package.json'), null);
  assert.equal(resolveStatic('/assets/derived/../katie-eva-coast.jpg'), null, 'no climbing even inside assets/');
  assert.equal(resolveStatic('/assets/derived/.hidden'), null);
  assert.equal(resolveStatic('/assets/./derived/manifest.json'), null, 'a "." segment is a dotfile name, refused');
  assert.equal(resolveStatic('/assets/derived/'), null);
  assert.equal(resolveStatic('/invite.html'), null);
  assert.ok(resolveStatic('/assets/derived/manifest.json').endsWith(path.join('public', 'assets', 'derived', 'manifest.json')));
  assert.ok(resolveStatic('/invite').endsWith(path.join('public', 'invite.html')));
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
