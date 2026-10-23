// tests/api.waitlist.test.js
// POST /api/waitlist (polish brief section 3) against the mock store: every validation rule, the
// honeypot, the rate limit, the double-submit guard, the Waitlist row (with the trip's display
// name) and the Log row. No cookie is ever sent.

import { test, describe, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DOUBLE_SUBMIT_TTL_MS, LOG_CODE, POST, _resetDoubleSubmit, buildRow } from '../api/waitlist.js';
import { GENERAL_TRIP_ID, GENERAL_TRIP_NAME, WAITLIST_TRIP_IDS, tripName } from '../lib/lineup.js';
import { LIMITS, _reset as resetRateLimit } from '../lib/ratelimit.js';
import { TAB_HEADERS } from '../lib/store.columns.js';
import { readMockData } from '../lib/store.mock.js';
import { EMAIL_SHAPE, WAITLIST_LIMITS, WAITLIST_SOURCES } from '../lib/validate.js';
import { TRIPS } from '../public/js/trips.js';
import { freshMockPath, jsonRequest, readMock, tempDir, useMockEnv } from './api.helpers.js';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const EMAIL_ERROR = 'Enter a valid email address.';
const CONSENT_ERROR = 'Please tick the box so we can keep your email.';

let dir;
let quiet;
before(() => { dir = tempDir('courtside-waitlist-'); useMockEnv(); quiet = mock.method(console, 'log', () => {}); });
after(() => { quiet.mock.restore(); fs.rmSync(dir, { recursive: true, force: true }); });
beforeEach(() => { freshMockPath(dir); resetRateLimit(); _resetDoubleSubmit(); useMockEnv(); });

let ipCounter = 0;
const freshIp = () => `203.0.113.${(ipCounter++ % 250) + 1}`;
const good = (overrides = {}) => ({
  email: 'Ana.Guest@Example.com', name: ' Ana Guest ', tripId: 'charleston', source: 'card', consent: true, website: '', ...overrides,
});
// A fresh IP per post unless the test says otherwise, so only the rate-limit test meets the limit.
const post = (body, headers = {}) => POST(jsonRequest('/api/waitlist', body, { headers: { 'x-forwarded-for': freshIp(), ...headers } }));
const expectJson = async (res, status) => {
  assert.equal(res.status, status, await res.clone().text());
  assert.equal(res.headers.get('content-type'), 'application/json');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  return res.json();
};
const errorsOf = async (body) => {
  const json = await expectJson(await post(body, { 'x-forwarded-for': freshIp() }), 400);
  assert.equal(json.ok, false);
  assert.ok(json.errors && typeof json.errors === 'object', 'a 400 carries errors');
  return json.errors;
};
// readMockData seeds the file when no route has touched it yet (a 400 never reaches the store).
const nothingWritten = () => {
  const data = readMockData();
  assert.equal(data.waitlist.length, 0, 'no Waitlist row');
  assert.equal(data.log.length, 0, 'no Log row');
};

describe('a valid submission', () => {
  test('200 { ok:true }, one Waitlist row with the trip name, one Log row; no cookie needed', async () => {
    const started = Date.now();
    const json = await expectJson(await post(good(), { 'x-forwarded-for': '198.51.100.7', cookie: 'cs_session=garbage' }), 200);
    assert.deepEqual(json, { ok: true });

    const { waitlist, log, requests } = readMock();
    assert.equal(waitlist.length, 1);
    const row = waitlist[0];
    assert.deepEqual(Object.keys(row), [...TAB_HEADERS.Waitlist]);
    assert.match(row.timestamp, ISO);
    assert.ok(Date.parse(row.timestamp) >= started - 1000);
    assert.equal(row.email, 'ana.guest@example.com', 'lower-cased and trimmed');
    assert.equal(row.name, 'Ana Guest', 'trimmed');
    assert.equal(row.trip, 'Charleston', 'the trip name from trips.js, not the id');
    assert.equal(row.source, 'card');
    assert.equal(requests.length, 0);

    assert.equal(log.length, 1);
    assert.deepEqual(Object.keys(log[0]), [...TAB_HEADERS.Log]);
    assert.match(log[0].time, ISO);
    assert.equal(log[0].code, LOG_CODE);
    assert.equal(LOG_CODE, 'waitlist_submit');
    assert.equal(log[0].result, 'charleston', 'the trip id');
    assert.match(log[0].ip_hash, /^[0-9a-f]{16}$/);
  });

  test('every trip id in public/js/trips.js is accepted and written with its name; "general" is "General"', async () => {
    assert.deepEqual([...WAITLIST_TRIP_IDS], [...TRIPS.map((t) => t.id), GENERAL_TRIP_ID]);
    assert.equal(GENERAL_TRIP_ID, 'general');
    for (const trip of TRIPS) {
      resetRateLimit();
      await expectJson(await post(good({ email: `${trip.id}@example.com`, tripId: trip.id })), 200);
    }
    await expectJson(await post(good({ email: 'general@example.com', tripId: 'general', source: 'footer' })), 200);
    const { waitlist, log } = readMock();
    assert.deepEqual(waitlist.map((r) => r.trip), [...TRIPS.map((t) => t.name), 'General']);
    assert.deepEqual(log.map((r) => r.result), [...TRIPS.map((t) => t.id), 'general']);
    assert.equal(waitlist.at(-1).source, 'footer');
    assert.equal(tripName('general'), GENERAL_TRIP_NAME);
    assert.equal(tripName('spain'), 'The Spanish Offseason');
    assert.equal(tripName('nope'), '');
  });

  test('name is optional and source may be footer', async () => {
    const body = good({ source: 'footer' });
    delete body.name;
    await expectJson(await post(body), 200);
    const [row] = readMock().waitlist;
    assert.equal(row.name, '');
    assert.equal(row.source, 'footer');
    assert.deepEqual([...WAITLIST_SOURCES], ['card', 'footer']);
  });

  test('buildRow maps the validated value to the Waitlist columns', () => {
    const now = new Date('2026-10-22T12:00:00.000Z');
    assert.deepEqual(
      buildRow({ email: 'a@example.com', name: 'A', tripId: 'geneva', source: 'card' }, now),
      { timestamp: '2026-10-22T12:00:00.000Z', email: 'a@example.com', name: 'A', trip: 'Geneva', source: 'card' },
    );
    assert.equal(buildRow({ email: 'a@example.com', name: '', tripId: 'general', source: 'footer' }, now).trip, 'General');
  });
});

describe('validation (400 with complete-sentence messages; nothing written)', () => {
  test('email: required, shaped local@domain.tld, at most 254 characters', async () => {
    for (const bad of [undefined, '', '   ', 'ana', 'ana@', '@example.com', 'ana@example', 'ana@example.c', 'ana guest@example.com', 'ana@@example.com', 'ana@exam ple.com', { email: 'x' }, ['a@b.co']]) {
      const body = good();
      if (bad === undefined) delete body.email; else body.email = bad;
      assert.equal((await errorsOf(body)).email, EMAIL_ERROR, JSON.stringify(bad));
    }
    const longLocal = `${'a'.repeat(250)}@example.com`; // 262 chars, valid shape
    assert.equal(longLocal.length > WAITLIST_LIMITS.email, true);
    assert.equal((await errorsOf(good({ email: longLocal }))).email, 'That email address is too long.');
    assert.equal(WAITLIST_LIMITS.email, 254);
    nothingWritten();

    const exactly254 = `${'a'.repeat(254 - '@example.com'.length)}@example.com`;
    assert.equal(exactly254.length, 254);
    assert.ok(EMAIL_SHAPE.test(exactly254));
    await expectJson(await post(good({ email: `  ${exactly254.toUpperCase()}  ` })), 200);
    assert.equal(readMock().waitlist[0].email, exactly254, 'trimmed, lower-cased, 254 characters accepted');
  });

  test('name: optional, trimmed, text only, at most 120 characters', async () => {
    assert.equal(WAITLIST_LIMITS.name, 120);
    assert.equal((await errorsOf(good({ name: 'x'.repeat(121) }))).name, 'Keep your name under 120 characters.');
    assert.equal((await errorsOf(good({ name: { first: 'Ana' } }))).name, 'Enter your name as text.');
    nothingWritten();
    await expectJson(await post(good({ name: `  ${'x'.repeat(120)}  ` })), 200);
    assert.equal(readMock().waitlist[0].name.length, 120);
    await expectJson(await post(good({ email: 'two@example.com', name: null })), 200);
    assert.equal(readMock().waitlist[1].name, '');
  });

  test('tripId: a trip id from trips.js or "general"; anything else is refused', async () => {
    for (const bad of [undefined, '', 'Charleston', 'spain-2028', 'General', 'GENERAL', 7, ['spain'], { id: 'spain' }]) {
      const body = good();
      if (bad === undefined) delete body.tripId; else body.tripId = bad;
      assert.equal((await errorsOf(body)).tripId, 'Choose a trip from the lineup.', JSON.stringify(bad));
    }
    nothingWritten();
  });

  test('source: card or footer only', async () => {
    for (const bad of [undefined, '', 'nav', 'Card', 'FOOTER', 1, ['card']]) {
      const body = good();
      if (bad === undefined) delete body.source; else body.source = bad;
      assert.equal((await errorsOf(body)).source, 'Reload the page and try again.', JSON.stringify(bad));
    }
    nothingWritten();
  });

  test('consent must be the boolean true', async () => {
    for (const bad of [undefined, false, 'true', 'yes', 1, 'on', null]) {
      const body = good();
      if (bad === undefined) delete body.consent; else body.consent = bad;
      assert.equal((await errorsOf(body)).consent, CONSENT_ERROR, JSON.stringify(bad));
    }
    nothingWritten();
  });

  test('every failing field is reported at once, unknown fields are ignored', async () => {
    const errors = await errorsOf({ email: 'nope', name: 'x'.repeat(200), tripId: 'nowhere', source: 'nav', consent: 'yes', extra: 'ignored', website: '' });
    assert.deepEqual(Object.keys(errors).sort(), ['consent', 'email', 'name', 'source', 'tripId']);
    for (const message of Object.values(errors)) assert.match(message, /^[A-Z].*\.$/, `complete sentence: ${message}`);
    await expectJson(await post(good({ extra: 'ignored', requestType: 'private' })), 200);
  });

  test('a body that is not JSON, or not a JSON object, is a 400 with a body error', async () => {
    const notJson = await expectJson(await post('{oops'), 400);
    assert.deepEqual(notJson, { ok: false, errors: { body: 'Send the request as JSON.' } });
    const empty = await expectJson(await POST(new Request('http://localhost:3000/api/waitlist', { method: 'POST' })), 400);
    assert.deepEqual(empty, { ok: false, errors: { body: 'Send the request as JSON.' } });
    for (const bad of ['"text"', '[1,2]', '5', 'null', 'true']) {
      const json = await expectJson(await post(bad), 400);
      assert.deepEqual(json, { ok: false, errors: { body: 'Send the request as a JSON object.' } }, bad);
    }
    nothingWritten();
  });
});

describe('honeypot', () => {
  test('a filled website field returns 200 { ok:true } and writes nothing, before validation runs', async () => {
    assert.deepEqual(await expectJson(await post(good({ website: 'http://spam.example' })), 200), { ok: true });
    assert.deepEqual(await expectJson(await post(good({ website: 'x', email: 'not-an-email', consent: false, tripId: 'nope' })), 200), { ok: true }, 'no 400 for a bot');
    assert.deepEqual(await expectJson(await post(good({ website: 5 })), 200), { ok: true });
    assert.deepEqual(await expectJson(await post(good({ website: { a: 1 } })), 200), { ok: true });
    nothingWritten();
  });

  test('a missing or blank website field is fine', async () => {
    const body = good();
    delete body.website;
    await expectJson(await post(body), 200);
    await expectJson(await post(good({ email: 'two@example.com', website: '   ' })), 200);
    assert.equal(readMock().waitlist.length, 2);
  });
});

describe('rate limit (bucket "waitlist", 5 per 10 minutes per IP hash)', () => {
  test('the sixth post from one IP is 429 rate_limited; honeypot hits and invalid posts count; another IP is unaffected', async () => {
    assert.deepEqual(LIMITS.waitlist, { limit: 5, windowMs: 600_000 });
    const h = { 'x-forwarded-for': '198.51.100.50' };
    const statuses = [];
    for (let i = 0; i < 5; i += 1) statuses.push((await post(good({ email: `guest${i}@example.com` }), h)).status);
    assert.deepEqual(statuses, [200, 200, 200, 200, 200]);
    const sixth = await expectJson(await post(good({ email: 'guest6@example.com' }), h), 429);
    assert.deepEqual(sixth, { ok: false, reason: 'rate_limited' });
    assert.equal(readMock().waitlist.length, 5, 'the sixth wrote nothing');
    assert.equal(readMock().log.length, 5, 'a 429 is not logged');

    const other = await post(good({ email: 'other@example.com' }), { 'x-forwarded-for': '198.51.100.51' });
    assert.equal(other.status, 200);

    resetRateLimit();
    const h2 = { 'x-forwarded-for': '198.51.100.52' };
    for (let i = 0; i < 3; i += 1) assert.equal((await post(good({ website: 'spam' }), h2)).status, 200, 'honeypot hits look like success');
    for (let i = 0; i < 2; i += 1) assert.equal((await post(good({ email: 'bad' }), h2)).status, 400);
    assert.equal((await post(good({ email: 'fine@example.com' }), h2)).status, 429, 'five attempts of any kind use up the window');
  });
});

describe('double submit (same email + tripId within 60 seconds)', () => {
  test('returns 200 again and writes nothing; a different trip, or a different email, is a new row', async () => {
    assert.equal(DOUBLE_SUBMIT_TTL_MS, 60_000);
    const h = { 'x-forwarded-for': '198.51.100.60' };
    await expectJson(await post(good(), h), 200);
    assert.deepEqual(await expectJson(await post(good({ name: 'Ana G.' }), h), 200), { ok: true });
    assert.deepEqual(await expectJson(await post(good({ email: '  ANA.GUEST@example.com ' }), { 'x-forwarded-for': '198.51.100.61' }), 200), { ok: true }, 'the key is the normalised email, from any IP');
    let data = readMock();
    assert.equal(data.waitlist.length, 1);
    assert.equal(data.log.length, 1);

    await expectJson(await post(good({ tripId: 'geneva' }), h), 200);
    await expectJson(await post(good({ email: 'friend@example.com' }), h), 200);
    data = readMock();
    assert.deepEqual(data.waitlist.map((r) => [r.email, r.trip]), [
      ['ana.guest@example.com', 'Charleston'], ['ana.guest@example.com', 'Geneva'], ['friend@example.com', 'Charleston'],
    ]);
    assert.equal(data.log.length, 3);
  });

  test('concurrent identical posts share one write', async () => {
    const results = await Promise.all([0, 1, 2].map((i) => post(good(), { 'x-forwarded-for': `198.51.100.7${i}` })));
    for (const res of results) assert.deepEqual(await expectJson(res, 200), { ok: true });
    assert.equal(readMock().waitlist.length, 1);
    assert.equal(readMock().log.length, 1);
  });

  test('_resetDoubleSubmit (what a restart does) allows the row again', async () => {
    await expectJson(await post(good()), 200);
    _resetDoubleSubmit();
    await expectJson(await post(good()), 200);
    assert.equal(readMock().waitlist.length, 2);
  });
});

describe('store failures', () => {
  test('a failing Waitlist write is 500 server_error and does not poison the double-submit guard', async () => {
    const errors = mock.method(console, 'error', () => {});
    try {
      const file = process.env.MOCK_DATA_PATH;
      process.env.MOCK_DATA_PATH = dir; // a directory: the mock store cannot read or write it
      const json = await expectJson(await post(good()), 500);
      assert.deepEqual(json, { ok: false, reason: 'server_error' });
      assert.ok(errors.mock.callCount() >= 1, 'the failure is reported to the console');
      assert.equal(errors.mock.calls[0].arguments[0], '[api/waitlist]');

      process.env.MOCK_DATA_PATH = file; // the store is healthy again: the same submission must now succeed
      await expectJson(await post(good()), 200);
      assert.equal(readMock().waitlist.length, 1);
    } finally {
      errors.mock.restore();
    }
  });
});
