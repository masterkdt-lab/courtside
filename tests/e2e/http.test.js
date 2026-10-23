// tests/e2e/http.test.js
// Section 8 of COURTSIDE_PHASE1_PLAN.md at the HTTP level, against a real dev server started in
// this process on a free port (mock store in a temp file, log-mode email). Since Phase 2 the gate
// is at /invite and / is the public homepage; legacy /?invite=CODE links redirect. The
// browser-level checks are in browser.test.js. Nothing here touches .data/mock.json.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import {
  COLUMNS, GATE, NOINDEX, ROOT, SEED_CODES, WEEK_LABELS, freshIp, http, login, privateBody, readMock, resetMock, resetServerState,
  sentEmails, setAllWeeks, setTripStatus, setWeekStatus, startServer, tamper, useTempMock, vettedBody,
} from './helpers.js';

let srv;
const ip = () => ({ 'x-forwarded-for': freshIp() });
const post = (pathname, body, cookie, headers = ip()) => http(srv.base, pathname, { method: 'POST', body, cookie, headers });

before(async () => {
  useTempMock();
  srv = await startServer();
});
after(async () => {
  await resetMock();
  await srv.close();
});
beforeEach(resetMock);

describe('8.2 npm run dev serves the whole site with no accounts or keys', () => {
  test('/ , /invite, /privacy, /robots.txt, styles, scripts and assets are served in mock mode', async () => {
    // The suite runs in mock/log mode regardless of any local .env: helpers.js sets the env and the
    // in-process dev server never loads the file. Assert the mode, not the file.
    assert.notEqual(process.env.DATA_BACKEND, 'sheets', 'the suite must run against the mock store');
    assert.equal(process.env.EMAIL_MODE, 'log', 'the suite must never send email');
    assert.ok(process.env.MOCK_DATA_PATH && !process.env.MOCK_DATA_PATH.startsWith(ROOT), 'mock data must live outside the repo');
    for (const [p, type] of [['/', 'text/html'], [GATE, 'text/html'], ['/privacy', 'text/html'], ['/robots.txt', 'text/plain'],
      ['/style.css', 'text/css'], ['/marketing.css', 'text/css'],
      ['/js/gate.js', 'text/javascript'], ['/js/site.js', 'text/javascript'], ['/js/images.js', 'text/javascript'],
      ['/assets/courtside-lockup.png', 'image/png'], ['/assets/katie-eva-coast.jpg', 'image/jpeg'],
      ['/assets/derived/manifest.json', 'application/json'], ['/assets/derived/katie-eva-coast-480.webp', 'image/webp']]) {
      const r = await http(srv.base, p);
      assert.equal(r.status, 200, `${p} -> ${r.status}`);
      assert.match(r.headers.get('content-type') || '', new RegExp(`^${type}`), `${p} content-type`);
    }
    const robots = await http(srv.base, '/robots.txt');
    assert.match(robots.text, /User-agent: \*\s+Disallow: \/\s*$/);
  });

  test('/site/ redirects to /site (trailingSlash: false)', async () => {
    const r = await http(srv.base, '/site/?x=1');
    assert.equal(r.status, 308);
    assert.equal(r.headers.get('location'), '/site?x=1');
  });

  test('nothing outside public/ is reachable (lib, tests, config, docs, api source, traversal)', async () => {
    for (const p of ['/lib/store.js', '/lib/cookie.js', '/tests/fixtures/seed.json', '/package.json', '/package-lock.json', '/.env.example',
      '/COURTSIDE_PHASE1_PLAN.md', '/COURTSIDE_PHASE2_PLAN.md', '/README.md', '/QA_REPORT.md', '/middleware.js', '/vercel.json', '/scripts/dev-server.js',
      '/scripts/make-images.js', '/api/code.js', '/api/nope', '/.data/mock.json', '/.git/HEAD', '/js/../lib/store.js', '/js/%2e%2e/lib/store.js',
      '/assets/../../package.json', '/assets/derived/%2e%2e/%2e%2e/package.json', '/assets/derived/.hidden', '/js/.hidden',
      '/index.html', '/invite.html', '/pros.html', '/privacy.html', '/node_modules/playwright/package.json']) {
      const r = await http(srv.base, p);
      assert.equal(r.status, 404, `${p} -> ${r.status}`);
    }
    const method = await http(srv.base, '/api/code');
    assert.equal(method.status, 405);
    assert.deepEqual(method.json, { ok: false, reason: 'method_not_allowed' });
  });
});

describe('8.3 codes: valid opens /site; invalid, paused, used-up are distinct', () => {
  test('POST /api/code contract (4.4) for every outcome, trimmed and case-insensitive', async () => {
    const h = ip();
    const empty = await post('/api/code', { code: '   ' }, undefined, h);
    assert.equal(empty.status, 400);
    assert.deepEqual(empty.json, { ok: false, reason: 'missing_code' });
    const noBody = await http(srv.base, '/api/code', { method: 'POST', headers: h });
    assert.equal(noBody.status, 400);

    const invalid = await post('/api/code', { code: 'NOPE' }, undefined, h);
    assert.equal(invalid.status, 401);
    assert.deepEqual(invalid.json, { ok: false, reason: 'invalid' });
    assert.equal(invalid.setCookie.length, 0);

    const paused = await post('/api/code', { code: 'PAUSED1' }, undefined, h);
    assert.equal(paused.status, 401);
    assert.deepEqual(paused.json, { ok: false, reason: 'paused' });

    const once = await post('/api/code', { code: 'once1' }, undefined, h);
    assert.equal(once.status, 200);
    const again = await post('/api/code', { code: 'ONCE1' }, undefined, h);
    assert.equal(again.status, 401);
    assert.deepEqual(again.json, { ok: false, reason: 'used_up' });

    const guest = await post('/api/code', { code: '  guest1 ' }, undefined, h);
    assert.equal(guest.status, 200);
    assert.deepEqual(guest.json, { ok: true, invitedBy: 'Katie', issuedTo: 'Ana Guest' });
    const cookie = guest.setCookie[0];
    assert.match(cookie, /^cs_session=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000$/);
    assert.doesNotMatch(cookie, /Secure/, 'no Secure flag on http://localhost');

    const shared = await post('/api/code', { code: 'COURTSIDE' }, undefined, h);
    assert.deepEqual(shared.json, { ok: true, invitedBy: 'Katie', issuedTo: 'Shared test code' });

    // Four distinct reasons, so the gate can show four distinct messages.
    assert.equal(new Set([empty.json.reason, invalid.json.reason, paused.json.reason, again.json.reason]).size, 4);

    const mock = readMock();
    assert.equal(mock.invites.find((i) => i.code === 'ONCE1').uses, 1);
    assert.equal(mock.invites.find((i) => i.code === 'GUEST1').uses, 1);
    assert.match(mock.invites.find((i) => i.code === 'GUEST1').last_used_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(mock.log.map((l) => l.result), ['missing_code', 'missing_code', 'invalid', 'paused', 'ok', 'used_up', 'ok', 'ok']);
    assert.ok(mock.log.every((l) => /^[0-9a-f]{16}$/.test(l.ip_hash)), 'ip_hash is 16 hex chars');
  });

  test('GET /api/session reflects the cookie; valid cookie opens /site and /site.html', async () => {
    const { pair } = await login(srv.base);
    const session = await http(srv.base, '/api/session', { cookie: pair });
    assert.equal(session.status, 200);
    assert.deepEqual(session.json, { ok: true, code: 'GUEST1', invitedBy: 'Katie', issuedTo: 'Ana Guest' });
    for (const p of ['/site', '/site.html', '/site#build']) {
      const r = await http(srv.base, p, { cookie: pair });
      assert.equal(r.status, 200, p);
      assert.match(r.text, /<div id="site">/);
    }
  });

  test('10 code attempts per 10 minutes per IP, then 429 rate_limited', async () => {
    const h = ip();
    const statuses = [];
    for (let i = 0; i < 11; i += 1) statuses.push((await post('/api/code', { code: 'NOPE' }, undefined, h)).status);
    assert.deepEqual(statuses, [401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 429]);
    const last = await post('/api/code', { code: 'GUEST1' }, undefined, h);
    assert.deepEqual(last.json, { ok: false, reason: 'rate_limited' }, 'a valid code is also refused while limited');
    const other = await post('/api/code', { code: 'GUEST1' }, undefined, ip());
    assert.equal(other.status, 200, 'another IP is unaffected');
  });
});

describe('8.4 /site without a cookie redirects to /invite', () => {
  test('no cookie, garbage cookie, tampered signature and expired payload all redirect; APIs return 401', async () => {
    const { pair } = await login(srv.base);
    const { sign } = await import('../../lib/cookie.js');
    const { DEV_COOKIE_SECRET } = await import('../../lib/guard.js');
    const expired = `cs_session=${await sign({ code: 'GUEST1', invitedBy: 'Katie', issuedTo: 'Ana Guest', exp: Date.now() - 1000 }, DEV_COOKIE_SECRET)}`;
    const wrongSecret = `cs_session=${await sign({ code: 'GUEST1', invitedBy: 'Katie', issuedTo: 'Ana Guest', exp: Date.now() + 1e6 }, 'not-the-secret')}`;
    for (const [label, cookie] of [['none', undefined], ['garbage', 'cs_session=garbage'], ['tampered', tamper(pair)], ['expired', expired], ['wrong secret', wrongSecret], ['other cookie', 'other=1']]) {
      for (const p of ['/site', '/site.html']) {
        const r = await http(srv.base, p, { cookie });
        assert.equal(r.status, 302, `${label} ${p}`);
        assert.equal(r.headers.get('location'), GATE, `${label} ${p}`);
        assert.equal(r.headers.get('cache-control'), 'no-store');
      }
      const session = await http(srv.base, '/api/session', { cookie });
      assert.equal(session.status, 401, `${label} session`);
      assert.deepEqual(session.json, { ok: false });
      const trips = await http(srv.base, '/api/trips', { cookie });
      assert.equal(trips.status, 401, `${label} trips`);
      assert.deepEqual(trips.json, { ok: false, reason: 'unauthorized' });
      const request = await post('/api/request', privateBody(), cookie);
      assert.equal(request.status, 401, `${label} request`);
      assert.deepEqual(request.json, { ok: false, reason: 'unauthorized' });
    }
    // A revoked invite keeps its old cookie out of POST /api/request.
    const { editMock } = await import('./helpers.js');
    await editMock((d) => { d.invites.find((i) => i.code === 'GUEST1').status = 'revoked'; });
    const revoked = await post('/api/request', privateBody(), pair);
    assert.equal(revoked.status, 401);
  });
});

describe('8.5 no invite code appears in shipped JS or HTML', () => {
  test('served files contain none of the seed codes, SPAIN27, localStorage, or the word prototype', async () => {
    const files = ['/', GATE, '/privacy', '/style.css', '/marketing.css', '/js/gate.js', '/js/site.js', '/js/images.js', '/robots.txt'];
    const { pair } = await login(srv.base);
    const bodies = {};
    for (const p of files) bodies[p] = (await http(srv.base, p)).text;
    bodies['/site'] = (await http(srv.base, '/site', { cookie: pair })).text;
    for (const [p, text] of Object.entries(bodies)) {
      for (const code of [...SEED_CODES, 'SPAIN27']) assert.doesNotMatch(text, new RegExp(`\\b${code}\\b`), `${p} contains ${code}`);
      assert.doesNotMatch(text, /prototype/i, `${p} contains "prototype"`);
      assert.doesNotMatch(text, /localStorage/, `${p} writes localStorage`);
      assert.doesNotMatch(text, /v05-/, `${p} still has a v05- identifier`);
      assert.doesNotMatch(text, /source-notes/, `${p} still has the source-notes strip`);
    }
    // And on disk, every file under public/ (binary assets included).
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    for (const file of walk(path.join(ROOT, 'public'))) {
      const text = fs.readFileSync(file, 'latin1');
      for (const code of [...SEED_CODES, 'SPAIN27']) assert.doesNotMatch(text, new RegExp(`\\b${code}\\b`), `${file} contains ${code}`);
      assert.doesNotMatch(text, /prototype/i, `${file} contains "prototype"`);
    }
  });
});

describe('8.6–8.9 requests: rows, emails, no-guest-email, double submit', () => {
  const blank = (row, cols) => cols.forEach((c) => assert.equal(row[c], '', `${c} should be blank, got ${JSON.stringify(row[c])}`));
  const filled = (row, cols) => cols.forEach((c) => assert.notEqual(String(row[c]), '', `${c} should be filled`));

  test('8.6 private request: one row, every private column filled, vetted columns blank, two emails', async () => {
    const { pair } = await login(srv.base);
    const emails = await sentEmails();
    const r = await post('/api/request', privateBody(), pair);
    assert.equal(r.status, 200, r.text);
    assert.match(r.json.requestId, /^CS-[0-9A-HJKMNP-TV-Z]{8}$/);
    assert.equal(r.json.guestEmailSent, true);

    const rows = readMock().requests;
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.deepEqual(Object.keys(row), [
      'request_id', 'submitted_at', 'trip_id', 'request_type', 'weeks', 'guest_name', 'guest_email', 'guest_mobile', 'players', 'partners',
      'room', 'single_rooms', 'tennis', 'addons', 'party_type', 'level', 'tennis_style', 'travel_style', 'priorities', 'note',
      'player_estimate', 'partner_estimate', 'group_estimate', 'brief', 'invite_code', 'invited_by', 'status', 'owner', 'internal_notes',
    ], 'columns in the 4.2 order');
    filled(row, [...COLUMNS.always, ...COLUMNS.identity, ...COLUMNS.privateOnly, ...COLUMNS.note]);
    blank(row, [...COLUMNS.vettedOnly, ...COLUMNS.katie]);
    assert.equal(row.request_id, r.json.requestId);
    assert.equal(row.trip_id, 'spain');
    assert.equal(row.request_type, 'private');
    assert.equal(row.weeks, WEEK_LABELS.w5, 'weeks holds the label, not the id');
    assert.equal(row.guest_name, 'Ana Guest');
    assert.equal(row.guest_email, 'ana.guest@example.com');
    assert.equal(row.guest_mobile, '+1 555 0100');
    assert.equal(row.players, 6);
    assert.equal(row.partners, 2);
    assert.equal(row.room, 'Club View');
    assert.equal(row.single_rooms, 1);
    assert.equal(row.tennis, 'Daily tennis');
    assert.equal(row.addons, 'Extra session with Eva ×6, Massage ×8, Private 6-hour driver / excursion, Please do not overschedule me.');
    assert.equal(row.player_estimate, '$3,400–$3,700');
    assert.equal(row.partner_estimate, '$2,200–$2,400');
    assert.equal(row.group_estimate, '$30,000–$32,000');
    assert.equal(row.invite_code, 'GUEST1');
    assert.equal(row.invited_by, 'Katie');
    assert.equal(row.status, 'New');

    assert.equal(emails.length, 2);
    assert.deepEqual(emails[0].to, ['notify@example.com']);
    assert.match(emails[0].subject, new RegExp(`^New request ${r.json.requestId} · private · Feb 7–13$`));
    for (const needle of [`Request ID: ${r.json.requestId}`, 'Type: private', 'Weeks: Feb 7–13', 'Guest: Ana Guest', 'Email: ana.guest@example.com',
      'Mobile: +1 555 0100', 'Invite code: GUEST1 (invited by Katie)', 'Trip brief:', privateBody().brief, 'Sheet:']) {
      assert.ok(emails[0].text.includes(needle), `notification email lacks ${JSON.stringify(needle)}`);
    }
    assert.deepEqual(emails[1].to, ['ana.guest@example.com']);
    assert.ok(emails[1].text.startsWith("You're on our list."));
    assert.ok(emails[1].text.includes(r.json.requestId) && emails[1].text.includes(privateBody().brief));
  });

  test('8.7 vetted request: one row, every vetted column filled, private columns blank, two emails', async () => {
    const { pair } = await login(srv.base);
    const emails = await sentEmails();
    const r = await post('/api/request', vettedBody(), pair);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.guestEmailSent, true);
    const rows = readMock().requests;
    assert.equal(rows.length, 1);
    const row = rows[0];
    filled(row, [...COLUMNS.always, ...COLUMNS.identity, ...COLUMNS.vettedOnly, ...COLUMNS.note]);
    blank(row, [...COLUMNS.privateOnly, ...COLUMNS.katie]);
    assert.equal(row.request_type, 'vetted');
    assert.equal(row.weeks, 'Jan 17–23, Jan 24–30');
    assert.equal(row.party_type, 'Couple');
    assert.equal(row.level, '4.0');
    assert.equal(row.tennis_style, 'Competitive / serious');
    assert.equal(row.travel_style, 'Independent');
    assert.equal(row.priorities, 'Great tennis, Golf');
    assert.equal(row.note, 'We play most weekends.');
    assert.equal(emails.length, 2);
    assert.match(emails[0].subject, /· vetted · Jan 17–23, Jan 24–30$/);
    assert.ok(emails[0].text.includes('Weeks: Jan 17–23, Jan 24–30'));
    assert.deepEqual(emails[1].to, ['ana.guest@example.com']);
  });

  test('8.8 a code with no guest email: one row, one email, guestEmailSent false', async () => {
    const { pair } = await login(srv.base, 'COURTSIDE');
    const emails = await sentEmails();
    const r = await post('/api/request', privateBody(), pair);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.guestEmailSent, false, 'the confirmation must not promise an email');
    const row = readMock().requests[0];
    assert.equal(row.guest_name, 'Shared test code');
    assert.equal(row.guest_email, '');
    assert.equal(row.guest_mobile, '');
    assert.equal(row.invite_code, 'COURTSIDE');
    assert.equal(emails.length, 1);
    assert.deepEqual(emails[0].to, ['notify@example.com']);
    assert.ok(emails[0].text.includes('Email: no guest email on this invite'));
  });

  test('8.9 two concurrent identical POSTs create one row and return the same ID; a changed body is a new row', async () => {
    const { pair } = await login(srv.base);
    const emails = await sentEmails();
    const h = ip();
    const [a, b] = await Promise.all([post('/api/request', privateBody(), pair, h), post('/api/request', privateBody(), pair, h)]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(a.json.requestId, b.json.requestId);
    assert.equal(readMock().requests.length, 1);
    assert.equal(emails.length, 2, 'emails sent once');
    const c = await post('/api/request', privateBody(), pair, h);
    assert.equal(c.json.requestId, a.json.requestId, 'a third identical submit within 60 s still returns the first ID');
    assert.equal(readMock().requests.length, 1);
    const other = await post('/api/request', privateBody({ weeks: ['w6'] }), pair, h);
    assert.notEqual(other.json.requestId, a.json.requestId);
    assert.equal(readMock().requests.length, 2);
  });

  test('beyond: validation (400), unknown week id, honeypot, rate limit (429), identity never from the body', async () => {
    const { pair } = await login(srv.base);
    const emails = await sentEmails();
    const h = ip();
    const cases = [
      [privateBody({ weeks: ['w9'] }), { weeks: 'Choose a week from the list.' }],
      [privateBody({ weeks: ['w1', 'w2'] }), { weeks: 'Choose one week.' }],
      [privateBody({ weeks: [] }), { weeks: 'Choose one week.' }],
      [vettedBody({ weeks: [] }), { weeks: 'Choose at least one week.' }],
      [privateBody({ consent: false }), { consent: 'Please agree to the privacy notice to send your request.' }],
      [privateBody({ players: 13 }), { players: 'Players must be between 4 and 12.' }],
      [privateBody({ players: 4, partners: 0, singleRooms: 5 }), { singleRooms: 'Single rooms must be between 0 and 4.' }],
      [privateBody({ room: 'penthouse' }), { room: 'Choose a room.' }],
      [privateBody({ addons: [{ id: 'eva' }] }), { addons: 'Enter how many for Extra session with Eva.' }],
      [privateBody({ addons: [{ id: 'spa', qty: 1 }] }), { addons: 'Choose add-ons from the list.' }],
      [privateBody({ brief: '' }), { brief: 'The trip brief is missing.' }],
      [privateBody({ note: 'x'.repeat(2001) }), { note: 'Keep notes under 2,000 characters.' }],
      [vettedBody({ level: '6.0' }), { level: 'Choose a tennis level.' }],
      [vettedBody({ priorities: ['Napping'] }), { priorities: 'Choose priorities from the list.' }],
      [{ requestType: 'other' }, null],
    ];
    for (const [body, errors] of cases) {
      const r = await post('/api/request', body, pair, ip());
      assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
      assert.equal(r.json.ok, false);
      if (errors) assert.deepEqual(r.json.errors, errors);
      else assert.ok(r.json.errors.requestType);
    }
    const notJson = await http(srv.base, '/api/request', { method: 'POST', body: '{nope', cookie: pair, headers: { ...ip(), 'content-type': 'application/json' } });
    assert.equal(notJson.status, 400);
    assert.deepEqual(notJson.json, { ok: false, errors: { body: 'Send the request as JSON.' } });
    assert.equal(readMock().requests.length, 0, 'no row from any 400');

    const honeypot = await post('/api/request', privateBody({ website: 'http://spam.example' }), pair, ip());
    assert.equal(honeypot.status, 200);
    assert.match(honeypot.json.requestId, /^CS-[0-9A-HJKMNP-TV-Z]{8}$/);
    assert.equal(honeypot.json.guestEmailSent, false);
    assert.equal(readMock().requests.length, 0, 'honeypot writes nothing');
    assert.equal(emails.length, 0, 'honeypot sends nothing');

    // Body identity fields are ignored; the row carries the invite's identity.
    const spoof = await post('/api/request', privateBody({ guestName: 'Mallory', guestEmail: 'mallory@example.com', inviteCode: 'OTHER', invitedBy: 'Nobody' }), pair, ip());
    assert.equal(spoof.status, 200);
    const row = readMock().requests[0];
    assert.equal(row.guest_name, 'Ana Guest');
    assert.equal(row.guest_email, 'ana.guest@example.com');
    assert.equal(row.invite_code, 'GUEST1');

    const statuses = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await post('/api/request', privateBody({ weeks: [`w${i + 1}`] }), pair, h)).status);
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
    const limited = await post('/api/request', privateBody({ weeks: ['w7'] }), pair, h);
    assert.deepEqual(limited.json, { ok: false, reason: 'rate_limited' });
  });
});

describe('8.10–8.11 closed week and closed trip (server is the authority)', () => {
  test('GET /api/trips reflects the mock file; the 60 s cache is module-level', async () => {
    const { pair } = await login(srv.base);
    const first = await http(srv.base, '/api/trips', { cookie: pair });
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('cache-control'), 'no-store');
    assert.deepEqual(first.json.trips, [{ tripId: 'spain', name: 'The Spanish Offseason', status: 'open', closedMessage: 'Requests for The Spanish Offseason are closed.' }]);
    assert.deepEqual(first.json.weeks.map((w) => [w.weekId, w.label, w.status]), Object.entries(WEEK_LABELS).map(([id, label]) => [id, label, 'open']));
    assert.deepEqual(Object.keys(first.json.weeks[0]), ['weekId', 'tripId', 'label', 'start', 'end', 'status', 'closedMessage']);
    // Edit the file without dropping the cache: still open until the TTL elapses.
    const { readMockData } = await import('../../lib/store.mock.js');
    const data = readMockData();
    data.weeks[4].status = 'closed';
    fs.writeFileSync(process.env.MOCK_DATA_PATH, JSON.stringify(data));
    const cached = await http(srv.base, '/api/trips', { cookie: pair });
    assert.equal(cached.json.weeks[4].status, 'open', 'served from the 60 s cache');
    const { _resetTripsCache, TRIPS_CACHE_TTL_MS } = await import('../../api/trips.js');
    assert.equal(TRIPS_CACHE_TTL_MS, 60_000);
    _resetTripsCache();
    const fresh = await http(srv.base, '/api/trips', { cookie: pair });
    assert.equal(fresh.json.weeks[4].status, 'closed');
  });

  test('8.10 closed week: POST for it is 409 week_closed with the ids, even while /api/trips is stale', async () => {
    const { pair } = await login(srv.base);
    await http(srv.base, '/api/trips', { cookie: pair }); // warm the cache with w5 open
    const { readMockData } = await import('../../lib/store.mock.js');
    const data = readMockData();
    data.weeks.find((w) => w.week_id === 'w5').status = 'closed';
    fs.writeFileSync(process.env.MOCK_DATA_PATH, JSON.stringify(data));
    const r = await post('/api/request', privateBody({ weeks: ['w5'] }), pair);
    assert.equal(r.status, 409);
    assert.deepEqual(r.json, { ok: false, reason: 'week_closed', weeks: ['w5'] });
    const vetted = await post('/api/request', vettedBody({ weeks: ['w2', 'w5'] }), pair);
    assert.equal(vetted.status, 409);
    assert.deepEqual(vetted.json, { ok: false, reason: 'week_closed', weeks: ['w5'] });
    const open = await post('/api/request', privateBody({ weeks: ['w4'] }), pair);
    assert.equal(open.status, 200, 'other weeks still accept');
    assert.equal(readMock().requests.length, 1);
  });

  test('8.11 closed trip: POST is 409 trip_closed for any week; every week closed behaves the same', async () => {
    const { pair } = await login(srv.base);
    await setTripStatus('closed');
    const trips = await http(srv.base, '/api/trips', { cookie: pair });
    assert.equal(trips.json.trips[0].status, 'closed');
    for (const body of [privateBody({ weeks: ['w1'] }), vettedBody()]) {
      const r = await post('/api/request', body, pair);
      assert.equal(r.status, 409);
      assert.deepEqual(r.json, { ok: false, reason: 'trip_closed' });
    }
    await setTripStatus('open');
    await setAllWeeks('closed');
    const r = await post('/api/request', privateBody({ weeks: ['w1'] }), pair);
    assert.equal(r.status, 409);
    assert.deepEqual(r.json, { ok: false, reason: 'trip_closed' });
    await setWeekStatus('w3', 'open');
    const ok = await post('/api/request', privateBody({ weeks: ['w3'] }), pair);
    assert.equal(ok.status, 200);
    assert.equal(readMock().requests.length, 1);
  });
});

describe('8.13–8.14 served pages', () => {
  test('every page has noindex,nofollow; / is the homepage, not the gate; /invite?invite=PAUSED1 serves the gate', async () => {
    const { pair } = await login(srv.base);
    for (const [p, cookie] of [['/', undefined], [GATE, undefined], [`${GATE}?invite=PAUSED1`, undefined], ['/privacy', undefined], ['/site', pair]]) {
      const r = await http(srv.base, p, { cookie });
      assert.equal(r.status, 200, p);
      assert.match(r.text, NOINDEX, `${p} noindex`);
    }
    const home = await http(srv.base, '/');
    assert.equal(home.status, 200);
    assert.match(home.text, /noindex,nofollow/);
    assert.doesNotMatch(home.text, /id="inviteForm"/, 'the homepage carries no gate form');
    const gate = await http(srv.base, `${GATE}?invite=PAUSED1`);
    assert.match(gate.text, /id="inviteForm"/);
  });

  test('personal links: /invite?invite=CODE is the gate; the legacy /?invite=CODE and /?code=CODE redirect with the query intact', async () => {
    for (const q of ['?invite=GUEST1', '?code=guest1', '?invite=GUEST1&guest=Mallory', '?guest=x&code=GUEST1', '?invite=PAUSED1']) {
      const r = await http(srv.base, `/${q}`);
      assert.equal(r.status, 302, q);
      assert.equal(r.headers.get('location'), `${GATE}${q}`, q);
      assert.equal(r.headers.get('cache-control'), 'no-store');
      const gate = await http(srv.base, `${GATE}${q}`);
      assert.equal(gate.status, 200, q);
      assert.match(gate.text, /id="inviteForm"/);
    }
    // Other queries on / are the homepage.
    for (const q of ['', '?guest=Mallory', '?utm_source=x']) assert.equal((await http(srv.base, `/${q}`)).status, 200, q);
  });

  test('beyond: the public pages and /site reference only same-origin scripts and stylesheets', async () => {
    const { pair } = await login(srv.base);
    for (const [p, cookie] of [['/', undefined], [GATE, undefined], ['/pros', undefined], ['/privacy', undefined], ['/site', pair]]) {
      const text = (await http(srv.base, p, { cookie })).text;
      for (const m of text.matchAll(/<(script|link)\b([^>]*)>/g)) {
        const attrs = m[2];
        const url = attrs.match(/\b(?:src|href)="([^"]+)"/)?.[1];
        if (!url) continue;
        // Polish plan section 7: a canonical link names the public origin by design; nothing is fetched from it.
        if (/\brel="canonical"/.test(attrs)) { assert.match(url, /^https:\/\/courtside-ivory\.vercel\.app\//, `${p} canonical`); continue; }
        assert.match(url, /^\//, `${p} loads ${url}`);
      }
    }
  });
});

describe('beyond: process state', () => {
  test('resetServerState leaves no limits, cache or emails behind', async () => {
    await resetServerState();
    assert.equal((await sentEmails()).length, 0);
  });
});
