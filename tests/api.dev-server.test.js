// tests/api.dev-server.test.js
// scripts/dev-server.js on port 0 (CONCEPT02_PLAN.md, Routing): the SPA at /, the public pages at their
// real paths (/trips, /trips/spanish-offseason, /hosts/katie, /about, /apply, /invite), /privacy, the static
// allow-list (files, assets/, fonts/, js/), the legacy redirects shared with middleware.js, the
// dynamic /api/<name> dispatch (lineup, inquiry, application, waitlist, code, …), cookies, and the
// 404 page. The frontend agent owns public/, so checks on individual files follow the file's
// presence; the allow-list itself is asserted through resolveStatic.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIRS, FILES, PAGES, REDIRECT_PATHS, createServer, resolveApi, resolveStatic } from '../scripts/dev-server.js';
import { _resetDoubleSubmit as resetInquiry } from '../api/inquiry.js';
import { _resetDoubleSubmit as resetApplication } from '../api/application.js';
import { _resetDoubleSubmit as resetWaitlist } from '../api/waitlist.js';
import { _resetLineupCache } from '../api/lineup.js';
import { _resetSentLog, sentLog } from '../lib/email.js';
import { _reset as resetRateLimit } from '../lib/ratelimit.js';
import { freshMockPath, readMock, tempDir, useMockEnv } from './api.helpers.js';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const exists = (file) => fs.existsSync(path.join(PUBLIC, file));
const ID = /^CS-[0-9A-HJKMNP-TV-Z]{8}$/;

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
beforeEach(() => { resetRateLimit(); resetInquiry(); resetApplication(); resetWaitlist(); _resetLineupCache(); _resetSentLog(); });

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
const expectRedirect = async (from, to) => {
  const res = await get(from);
  assert.equal(res.status, 302, from);
  assert.equal(res.headers.get('location'), to, from);
  assert.equal(res.headers.get('cache-control'), 'no-store', from);
};

test('the allow-list: eight pages, eleven files, three directories, four redirect paths', () => {
  assert.deepEqual(PAGES, {
    '/': 'index.html',
    '/trips': 'trips.html',
    '/trips/spanish-offseason': 'trips/spanish-offseason.html',
    '/hosts/katie': 'hosts/katie.html',
    '/about': 'about.html',
    '/apply': 'apply.html',
    '/invite': 'invite.html',
    '/privacy': 'privacy.html',
  });
  assert.deepEqual([...FILES], ['/styles.css', '/v2.css', '/analytics.js', '/gate.js', '/pages.js', '/app.js', '/style.css', '/marketing.css', '/robots.txt', '/sitemap.xml', '/favicon.svg']);
  assert.deepEqual(DIRS, { '/assets/': 'assets', '/fonts/': 'fonts', '/js/': 'js' });
  assert.deepEqual([...REDIRECT_PATHS], ['/', '/invite', '/site', '/site.html']);
  const under = (...parts) => path.join('public', ...parts);
  assert.ok(resolveStatic('/').endsWith(under('index.html')));
  assert.ok(resolveStatic('/privacy').endsWith(under('privacy.html')));
  assert.ok(resolveStatic('/trips').endsWith(under('trips.html')));
  assert.ok(resolveStatic('/trips/spanish-offseason').endsWith(under('trips', 'spanish-offseason.html')));
  assert.ok(resolveStatic('/hosts/katie').endsWith(under('hosts', 'katie.html')));
  assert.ok(resolveStatic('/invite').endsWith(under('invite.html')));
  for (const file of FILES) assert.ok(resolveStatic(file).endsWith(under(file.slice(1))), file);
  assert.ok(resolveStatic('/assets/hero.webp').endsWith(under('assets', 'hero.webp')));
  assert.ok(resolveStatic('/assets/og/home.jpg').endsWith(under('assets', 'og', 'home.jpg')), 'nested asset folders');
  assert.ok(resolveStatic('/assets/icons/apple-touch-icon.png').endsWith(under('assets', 'icons', 'apple-touch-icon.png')));
  assert.ok(resolveStatic('/fonts/f0.woff2').endsWith(under('fonts', 'f0.woff2')));
  assert.ok(resolveStatic('/fonts/fonts.css').endsWith(under('fonts', 'fonts.css')));
  assert.ok(resolveStatic('/js/trips.js').endsWith(under('js', 'trips.js')));
  // No longer pages or files.
  for (const p of ['/pros', '/site', '/site.html', '/index.html', '/privacy.html', '/404.html', '/invite.html', '/trips.html', '/trips/spanish-offseason.html', '/hosts', '/hosts/katie.html', '/trips/mallorca', '/pros.html', '/images/hero/hero.jpg', '/fonts.css']) {
    assert.equal(resolveStatic(p), null, p);
  }
});

test('/ serves the SPA (public/index.html) as HTML, with or without a cookie', async () => {
  const res = await get('/');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
  const html = await res.text();
  assert.match(html, /<html/i);
  assert.equal(html, fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8'), 'verbatim');
  assert.equal((await get('/?utm_source=x')).status, 200);
  assert.equal((await get('/?guest=Mallory')).status, 200, 'only invite and code redirect');
  assert.equal((await get('/', { headers: { cookie: 'cs_session=abc.def' } })).status, 200);
  const head = await fetch(`${base}/`, { method: 'HEAD', redirect: 'manual' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});

test('/privacy serves public/privacy.html as HTML; /privacy?invite=X is not redirected', async () => {
  const res = await get('/privacy');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal((await get('/privacy?invite=GUEST1')).status, 200);
  assert.equal((await get('/privacy.html')).status, 404, 'clean URLs only');
});

test('the public pages are served at their real paths as HTML, each the generated file verbatim', async () => {
  for (const [p, file] of Object.entries(PAGES)) {
    const res = await get(p);
    assert.equal(res.status, 200, p);
    assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8', p);
    assert.equal(await res.text(), fs.readFileSync(path.join(PUBLIC, file), 'utf8'), p);
  }
  assert.equal((await get('/invite?utm_source=x')).status, 200, 'a bare /invite is the page, not a redirect');
  assert.equal((await get('/trips/spanish-offseason/')).status, 308);
  assert.equal((await get('/trips/spanish-offseason/')).headers.get('location'), '/trips/spanish-offseason');
  const sitemap = await get('/sitemap.xml');
  assert.equal(sitemap.status, 200);
  assert.equal(sitemap.headers.get('content-type'), 'application/xml; charset=utf-8');
});

test('legacy personal links and the old page URLs redirect (302), exactly like middleware.js', async () => {
  await expectRedirect('/?invite=GUEST1', '/#/invite?code=GUEST1');
  await expectRedirect('/?code=guest1', '/#/invite?code=guest1');
  await expectRedirect('/?invite=GUEST1&guest=Mallory', '/#/invite?code=GUEST1');
  await expectRedirect('/?guest=x&code=GUEST1', '/#/invite?code=GUEST1');
  await expectRedirect('/?invite=a%26b', '/#/invite?code=a%26b');
  await expectRedirect('/invite?invite=GUEST1', '/#/invite?code=GUEST1');
  await expectRedirect('/invite?code=GUEST1', '/#/invite?code=GUEST1');
  await expectRedirect('/site', '/trips/spanish-offseason');
  await expectRedirect('/site.html', '/trips/spanish-offseason');
  await expectRedirect('/site?x=1', '/trips/spanish-offseason');
  const { cookie } = await login('GUEST1');
  const withCookie = await get('/site', { headers: { cookie } });
  assert.equal(withCookie.status, 302, 'the cookie no longer opens /site; the SPA trip page is public');
  assert.equal(withCookie.headers.get('location'), '/trips/spanish-offseason');
  // /pros is neither a page nor a redirect any more.
  assert.equal((await get('/pros')).status, 404);
});

test('an unknown path is a 404: public/404.html as text/html when it exists, the plain text otherwise', async () => {
  for (const p of ['/nope', '/trips/mallorca', '/invite.html', '/assets/missing.jpg', '/404', '/404.html', '/pros', '/images/hero/hero.jpg', '/host-desk']) {
    const res = await get(p);
    assert.equal(res.status, 404, p);
    const body = await res.text();
    if (exists('404.html')) {
      assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8', p);
      assert.equal(body, fs.readFileSync(path.join(PUBLIC, '404.html'), 'utf8'), `${p} serves public/404.html verbatim, whatever it holds`);
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

test('static files are served with the right type when present; resolveStatic never leaves public/', async () => {
  const checks = [
    ['/robots.txt', 'text/plain; charset=utf-8'], ['/favicon.svg', 'image/svg+xml'],
    ['/styles.css', 'text/css; charset=utf-8'], ['/v2.css', 'text/css; charset=utf-8'],
    ['/pages.js', 'text/javascript; charset=utf-8'], ['/app.js', 'text/javascript; charset=utf-8'],
    ['/analytics.js', 'text/javascript; charset=utf-8'],
    ['/style.css', 'text/css; charset=utf-8'], ['/marketing.css', 'text/css; charset=utf-8'],
    ['/js/trips.js', 'text/javascript; charset=utf-8'],
    ['/fonts/fonts.css', 'text/css; charset=utf-8'], ['/fonts/f0.woff2', 'font/woff2'],
    ['/assets/hero.webp', 'image/webp'], ['/assets/spain.jpg', 'image/jpeg'],
    ['/assets/og/home.jpg', 'image/jpeg'], ['/assets/icons/apple-touch-icon.png', 'image/png'],
  ];
  let served = 0;
  for (const [p, type] of checks) {
    const res = await get(p);
    if (exists(p.slice(1))) {
      assert.equal(res.status, 200, p);
      assert.equal(res.headers.get('content-type'), type, p);
      assert.equal(Number(res.headers.get('content-length')), fs.statSync(path.join(PUBLIC, p.slice(1))).size, p);
      served += 1;
    } else {
      assert.equal(res.status, 404, `${p} is allow-listed but absent, so a plain 404`);
    }
  }
  assert.ok(served >= 3, 'robots.txt, favicon.svg and js/trips.js at least are always there');
  assert.equal((await get('/assets')).status, 404, 'a directory is not a file');
  assert.equal((await get('/assets/og')).status, 404);
  assert.equal((await get('/assets/')).status, 308, 'trailing slash redirects like any other path');
});

test('nothing else is served: lib/, api/, scripts/, tests/, dotfiles, package files, the plans, *.html by name, traversal', async () => {
  for (const p of [
    '/lib/store.js', '/lib/cookie.js', '/api/code.js', '/api/inquiry.js', '/scripts/dev-server.js', '/tests/fixtures/seed.json',
    '/.env', '/.env.example', '/.gitignore', '/.git/HEAD', '/.data/mock.json', '/.vercel/project.json',
    '/package.json', '/package-lock.json', '/vercel.json', '/middleware.js',
    '/CONCEPT02_PLAN.md', '/COURTSIDE_PHASE1_PLAN.md', '/README.md', '/node_modules/google-auth-library/package.json',
    '/concept02/CLAUDE_SHEETS_PROMPT.md', '/concept02/site/app.js',
    '/assets/../package.json', '/assets/%2e%2e/package.json', '/js/../lib/store.js', '/js/..%2f..%2fpackage.json',
    '/assets/og/../../package.json', '/assets/og/%2e%2e/%2e%2e/package.json', '/assets/og/..%2f..%2fpackage.json',
    '/assets/og//home.jpg', '/assets/og/.hidden', '/fonts/../index.html',
    '/assets/.hidden', '/index.html', '/invite.html', '/pros.html', '/privacy.html', '/site.html.bak', '/nope',
  ]) {
    const res = await get(p);
    assert.equal(res.status, 404, p);
  }
  // Literal ".." on the wire (fetch would normalise it away) and the resolver itself.
  assert.equal((await rawGet('/assets/og/../../package.json')).status, 404);
  assert.equal((await rawGet('/assets/../package.json')).status, 404);
  assert.equal((await rawGet('/assets/../../.env')).status, 404);
  assert.equal((await rawGet('/fonts/../privacy.html')).status, 404);
  assert.equal(resolveStatic('/assets/og/../../package.json'), null);
  assert.equal(resolveStatic('/assets/og/../hero.webp'), null, 'no climbing even inside assets/');
  assert.equal(resolveStatic('/assets/og/.hidden'), null);
  assert.equal(resolveStatic('/assets/./og/home.jpg'), null, 'a "." segment is a dotfile name, refused');
  assert.equal(resolveStatic('/assets/og/'), null);
  assert.equal(resolveStatic('/assets/'), null);
  assert.equal(resolveStatic('/privacy.html'), null);
});

test('trailing slashes redirect to the clean path, like trailingSlash:false on Vercel', async () => {
  const privacy = await get('/privacy/?x=1');
  assert.equal(privacy.status, 308);
  assert.equal(privacy.headers.get('location'), '/privacy?x=1');
  assert.equal((await get('/styles.css/')).headers.get('location'), '/styles.css');
  assert.equal((await get('/js/')).status, 308);
  assert.equal((await get('/assets/')).status, 308);
  assert.equal((await get('/api/')).status, 308);
  assert.equal((await get('/')).status, 200);
});

test('/api/<name> dispatches to any api/<name>.js that exists; nothing else', () => {
  for (const name of ['code', 'waitlist', 'lineup', 'inquiry', 'application', 'group', 'member', 'concierge', 'proposal', 'payments']) {
    assert.ok(resolveApi(name)?.endsWith(path.join('api', `${name}.js`)), name);
  }
  for (const name of ['session', 'trips', 'request', 'event', 'nope', 'Code', 'code.js', '../lib/store', '..', '', 'code/x', 'store.columns']) assert.equal(resolveApi(name), null, name);
});

test('GET /api/lineup end to end: public JSON { trip, weeks }', async () => {
  const res = await get('/api/lineup');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/json');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assert.deepEqual(Object.keys(body), ['trip', 'weeks']);
  assert.equal(body.trip.tripId, 'spain');
  assert.equal(body.weeks.length, 7);
  assert.deepEqual(Object.keys(body.weeks[0]), ['weekId', 'label', 'start', 'end', 'status', 'closedMessage']);
  const wrong = await fetch(`${base}/api/lineup`, { method: 'POST' });
  assert.equal(wrong.status, 405);
  assert.equal(wrong.headers.get('allow'), 'GET');
});

test('POST /api/inquiry end to end: no cookie, JSON in, JSON out, one Requests row, one Log row, one email; the cookie fills invite columns', async () => {
  const body = {
    path: 'group', weeks: ['w3'], players: '6', partners: '2', tennis: 'Daily tennis', name: 'Ana Guest', email: 'Ana.Guest@Example.com',
    notes: 'Over HTTP.', consent: true, website: '',
  };
  const res = await postJson('/api/inquiry', body, { 'x-forwarded-for': '198.51.100.40' });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(res.headers.get('content-type'), 'application/json');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const json = await res.json();
  assert.match(json.requestId, ID);
  assert.deepEqual(json, { ok: true, requestId: json.requestId, groupId: json.groupId, memberId: json.memberId });
  assert.match(json.groupId, /^CSG-/);
  assert.match(res.headers.get('set-cookie'), /^cs_member=/);
  const row = readMock().requests.find((r) => r.request_id === json.requestId);
  assert.equal(row.request_type, 'private');
  assert.equal(row.weeks, 'Jan 24–30');
  assert.equal(row.guest_email, 'ana.guest@example.com');
  assert.equal(row.invite_code, '');
  const log = readMock().log.find((r) => r.result === json.requestId);
  assert.equal(log.code, 'inquiry_submit');
  assert.equal(sentLog.length, 2, 'team notification + guest confirmation');

  const { cookie } = await login('GUEST1');
  const withCookie = await postJson('/api/inquiry', { ...body, email: 'two@example.com' }, { cookie, 'x-forwarded-for': '198.51.100.40' });
  assert.equal(withCookie.status, 200);
  const second = readMock().requests.find((r) => r.guest_email === 'two@example.com');
  assert.deepEqual([second.invite_code, second.invited_by], ['GUEST1', 'Katie']);

  const bad = await postJson('/api/inquiry', { ...body, email: 'nope', consent: false }, { 'x-forwarded-for': '198.51.100.40' });
  assert.equal(bad.status, 400);
  assert.deepEqual(await bad.json(), {
    ok: false, errors: { email: 'Enter a valid email address.', consent: 'Please tick the box so Courtside can keep these details to prepare a proposal.' },
  });
  assert.equal((await get('/api/inquiry')).status, 405);
});

test('POST /api/application end to end: one HostApplications row and one Log row', async () => {
  const body = {
    name: 'Sam Pro', email: 'Sam.Pro@Example.com', club: 'Club de Tenis, Alicante', referral: '', background: 'Coaching for twenty years.',
    community: 'A club of 200.', destination: 'Mallorca', consent: true, website: '',
  };
  const res = await postJson('/api/application', body, { 'x-forwarded-for': '198.51.100.42' });
  assert.equal(res.status, 200, await res.clone().text());
  assert.deepEqual(await res.json(), { ok: true });
  const row = readMock().host_applications.at(-1);
  assert.deepEqual({ ...row, timestamp: 'ISO' }, {
    timestamp: 'ISO', name: 'Sam Pro', email: 'sam.pro@example.com', club: 'Club de Tenis, Alicante', referral: '', background: 'Coaching for twenty years.',
    community: 'A club of 200.', destination: 'Mallorca',
  });
  assert.equal(readMock().log.at(-1).code, 'application_submit');
  const bad = await postJson('/api/application', { ...body, club: '' }, { 'x-forwarded-for': '198.51.100.42' });
  assert.equal(bad.status, 400);
  assert.deepEqual(await bad.json(), { ok: false, errors: { club: 'Tell us where you coach.' } });
  assert.equal((await get('/api/application')).status, 405);
});

test('POST /api/waitlist end to end for both the old and the Concept 02 bodies', async () => {
  const old = { email: 'Ana.Guest@Example.com', name: 'Ana Guest', tripId: 'mallorca', source: 'card', consent: true, website: '' };
  const res = await postJson('/api/waitlist', old, { 'x-forwarded-for': '198.51.100.43' });
  assert.equal(res.status, 200, await res.clone().text());
  assert.deepEqual(await res.json(), { ok: true });
  assert.deepEqual({ ...readMock().waitlist.at(-1), timestamp: 'ISO' }, { timestamp: 'ISO', email: 'ana.guest@example.com', name: 'Ana Guest', trip: 'Mallorca', source: 'card' });

  const concept = { email: 'sam@example.com', name: '', interest: 'Katie’s future trips', source: 'concept02-waitlist', consent: true, website: '' };
  const res2 = await postJson('/api/waitlist', concept, { 'x-forwarded-for': '198.51.100.43' });
  assert.equal(res2.status, 200, await res2.clone().text());
  assert.deepEqual({ ...readMock().waitlist.at(-1), timestamp: 'ISO' }, { timestamp: 'ISO', email: 'sam@example.com', name: '', trip: 'Katie’s future trips', source: 'concept02-waitlist' });
  assert.equal(readMock().log.at(-1).result, 'Katie’s future trips');

  const home = { email: 'kim@example.com', interest: 'Future Courtside experiences', source: 'concept02-home', consent: true, website: '' };
  assert.equal((await postJson('/api/waitlist', home, { 'x-forwarded-for': '198.51.100.43' })).status, 200);
  assert.equal(readMock().waitlist.at(-1).trip, 'Future Courtside experiences');
  assert.equal((await get('/api/waitlist')).status, 405);
});

test('POST /api/code end to end: JSON body in, JSON + Set-Cookie out; the retired routes are gone', async () => {
  const { res, setCookie, cookie } = await login('GUEST1');
  assert.equal(res.headers.get('content-type'), 'application/json');
  assert.deepEqual(await res.json(), { ok: true, invitedBy: 'Katie', issuedTo: 'Ana Guest' });
  assert.match(setCookie, /^cs_session=[A-Za-z0-9_.-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=34560000$/);
  const bad = await postJson('/api/code', { code: 'NOPE' });
  assert.equal(bad.status, 401);
  assert.deepEqual(await bad.json(), { ok: false, reason: 'invalid' });
  assert.equal((await fetch(`${base}/api/code`, { method: 'POST' })).status, 400);
  assert.deepEqual(readMock().log.slice(-3).map((r) => r.result), ['ok', 'invalid', 'missing_code']);

  assert.ok(cookie);
  for (const gone of ['/api/session', '/api/trips', '/api/request', '/api/event']) assert.equal((await get(gone)).status, 404, gone);
});

test('wrong methods and unknown API names', async () => {
  const wrong = await get('/api/code');
  assert.equal(wrong.status, 405);
  assert.equal(wrong.headers.get('allow'), 'POST');
  assert.deepEqual(await wrong.json(), { ok: false, reason: 'method_not_allowed' });
  assert.equal((await fetch(`${base}/api/lineup`, { method: 'POST' })).status, 405);
  assert.equal((await get('/api/nope')).status, 404);
  assert.equal((await get('/api/')).status, 308);
  assert.equal((await get('/api/../lib/store.js')).status, 404);
  assert.equal((await rawGet('/api/../lib/store.js')).status, 404);
  assert.equal((await fetch(`${base}/`, { method: 'PUT' })).status, 405);
  assert.equal((await fetch(`${base}/`, { method: 'HEAD' })).status, 200);
});
