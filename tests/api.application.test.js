// tests/api.application.test.js
// POST /api/application (CONCEPT02_PLAN.md) against the mock store: every validation rule, the
// honeypot, the rate limit (3 per 10 minutes), the double-submit guard, the HostApplications row
// and the Log row. No cookie is ever sent.

import { test, describe, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DOUBLE_SUBMIT_TTL_MS, LOG_CODE, POST, RATE_LIMIT_BUCKET, _resetDoubleSubmit, buildRow } from '../api/application.js';
import { LIMITS, _reset as resetRateLimit } from '../lib/ratelimit.js';
import { TAB_HEADERS } from '../lib/store.columns.js';
import { readMockData } from '../lib/store.mock.js';
import { APPLICATION_LIMITS } from '../lib/validate.js';
import { freshMockPath, jsonRequest, readMock, tempDir, useMockEnv } from './api.helpers.js';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

let dir;
let quiet;
before(() => { dir = tempDir('courtside-application-'); useMockEnv(); quiet = mock.method(console, 'log', () => {}); });
after(() => { quiet.mock.restore(); fs.rmSync(dir, { recursive: true, force: true }); });
beforeEach(() => { freshMockPath(dir); resetRateLimit(); _resetDoubleSubmit(); useMockEnv(); });

let ipCounter = 0;
const freshIp = () => `203.0.113.${(ipCounter++ % 250) + 1}`;
const good = (overrides = {}) => ({
  name: ' Sam Pro ',
  email: 'Sam.Pro@Example.com',
  club: 'Club de Tenis Almoradí, Alicante, Spain',
  referral: 'Katie',
  background: 'Twenty years of coaching, ten of them running a club programme.',
  community: 'A club of 200 members who travel together every spring.',
  destination: 'Mallorca in June',
  consent: true,
  website: '',
  ...overrides,
});
// A fresh IP per post unless the test says otherwise, so only the rate-limit test meets the limit.
const post = (body, headers = {}) => POST(jsonRequest('/api/application', body, { headers: { 'x-forwarded-for': freshIp(), ...headers } }));
const expectJson = async (res, status) => {
  assert.equal(res.status, status, await res.clone().text());
  assert.equal(res.headers.get('content-type'), 'application/json');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  return res.json();
};
const errorsOf = async (body) => {
  const json = await expectJson(await post(body), 400);
  assert.equal(json.ok, false);
  assert.ok(json.errors && typeof json.errors === 'object', 'a 400 carries errors');
  return json.errors;
};
// readMockData seeds the file when no route has touched it yet (a 400 never reaches the store).
const nothingWritten = () => {
  const data = readMockData();
  assert.equal(data.host_applications.length, 0, 'no HostApplications row');
  assert.equal(data.log.length, 0, 'no Log row');
};

describe('a valid submission', () => {
  test('200 { ok:true }, one HostApplications row with every column mapped, one Log row application_submit', async () => {
    const started = Date.now();
    const json = await expectJson(await post(good(), { cookie: 'cs_session=garbage' }), 200);
    assert.deepEqual(json, { ok: true });

    const { host_applications: rows, log, requests, waitlist } = readMock();
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.deepEqual(Object.keys(row), [...TAB_HEADERS.HostApplications]);
    assert.deepEqual(TAB_HEADERS.HostApplications, ['timestamp', 'name', 'email', 'club', 'referral', 'background', 'community', 'destination']);
    assert.match(row.timestamp, ISO);
    assert.ok(Date.parse(row.timestamp) >= started - 1000);
    assert.deepEqual({ ...row, timestamp: 'ISO' }, {
      timestamp: 'ISO',
      name: 'Sam Pro',
      email: 'sam.pro@example.com',
      club: 'Club de Tenis Almoradí, Alicante, Spain',
      referral: 'Katie',
      background: 'Twenty years of coaching, ten of them running a club programme.',
      community: 'A club of 200 members who travel together every spring.',
      destination: 'Mallorca in June',
    });
    assert.equal(requests.length, 0);
    assert.equal(waitlist.length, 0);

    assert.equal(log.length, 1);
    assert.deepEqual(Object.keys(log[0]), [...TAB_HEADERS.Log]);
    assert.match(log[0].time, ISO);
    assert.equal(log[0].code, LOG_CODE);
    assert.equal(LOG_CODE, 'application_submit');
    assert.equal(log[0].result, 'ok');
    assert.match(log[0].ip_hash, /^[0-9a-f]{16}$/);
  });

  test('referral is optional; every other field is trimmed; unknown fields are ignored', async () => {
    const body = good({ extra: 'ignored', destination: '  Geneva  ' });
    delete body.referral;
    await expectJson(await post(body), 200);
    const [row] = readMock().host_applications;
    assert.equal(row.referral, '');
    assert.equal(row.destination, 'Geneva');
    assert.equal('extra' in row, false);
    await expectJson(await post(good({ email: 'two@example.com', referral: null })), 200);
    assert.equal(readMock().host_applications[1].referral, '');
  });

  test('buildRow maps the validated value to the HostApplications columns', () => {
    const now = new Date('2026-11-08T12:00:00.000Z');
    const value = { name: 'A', email: 'a@example.com', club: 'C', referral: '', background: 'B', community: 'M', destination: 'D', consent: true };
    assert.deepEqual(buildRow(value, now), {
      timestamp: '2026-11-08T12:00:00.000Z', name: 'A', email: 'a@example.com', club: 'C', referral: '', background: 'B', community: 'M', destination: 'D',
    });
  });
});

describe('validation (400 with complete-sentence messages; nothing written)', () => {
  test('limits are the plan\'s', () => {
    assert.deepEqual(APPLICATION_LIMITS, { name: 120, email: 254, club: 200, referral: 200, background: 4000, community: 4000, destination: 200 });
  });

  test('name: required, text, at most 120 characters', async () => {
    for (const bad of [undefined, '', '   ']) {
      const body = good();
      if (bad === undefined) delete body.name; else body.name = bad;
      assert.equal((await errorsOf(body)).name, 'Enter your name.', JSON.stringify(bad));
    }
    assert.equal((await errorsOf(good({ name: 'x'.repeat(121) }))).name, 'Keep your name under 120 characters.');
    assert.equal((await errorsOf(good({ name: { first: 'Sam' } }))).name, 'Enter your name as text.');
    nothingWritten();
    await expectJson(await post(good({ name: 'x'.repeat(120) })), 200);
  });

  test('email: required, shaped local@domain.tld, at most 254 characters, lower-cased', async () => {
    for (const bad of [undefined, '', 'sam', 'sam@', '@example.com', 'sam@example', 'sam pro@example.com', 'sam@@example.com', { email: 'x' }]) {
      const body = good();
      if (bad === undefined) delete body.email; else body.email = bad;
      assert.equal((await errorsOf(body)).email, 'Enter a valid email address.', JSON.stringify(bad));
    }
    assert.equal((await errorsOf(good({ email: `${'a'.repeat(250)}@example.com` }))).email, 'That email address is too long.');
    nothingWritten();
  });

  test('club, background, community and destination are required with their own messages and caps', async () => {
    const rules = [
      ['club', 'Tell us where you coach.', 200, 'Keep the club under 200 characters.', 'Enter the club as text.'],
      ['background', 'Tell us about your professional background.', 4000, 'Keep your background under 4,000 characters.', 'Enter your background as text.'],
      ['community', 'Tell us about your community.', 4000, 'Keep the community note under 4,000 characters.', 'Enter the community note as text.'],
      ['destination', 'Tell us where you would love to take them.', 200, 'Keep the destination under 200 characters.', 'Enter the destination as text.'],
    ];
    for (const [field, missing, max, tooLong, notText] of rules) {
      for (const bad of [undefined, '', '  ']) {
        const body = good();
        if (bad === undefined) delete body[field]; else body[field] = bad;
        assert.equal((await errorsOf(body))[field], missing, `${field} ${JSON.stringify(bad)}`);
      }
      assert.equal((await errorsOf(good({ [field]: 'x'.repeat(max + 1) })))[field], tooLong, field);
      assert.equal((await errorsOf(good({ [field]: ['x'] })))[field], notText, field);
      resetRateLimit();
      await expectJson(await post(good({ [field]: 'x'.repeat(max), email: `${field}@example.com` })), 200);
    }
    assert.equal(readMock().host_applications.length, rules.length, 'the at-cap values were accepted');
  });

  test('referral: optional, at most 200 characters, text', async () => {
    assert.equal((await errorsOf(good({ referral: 'x'.repeat(201) }))).referral, 'Keep the referral under 200 characters.');
    assert.equal((await errorsOf(good({ referral: { by: 'Katie' } }))).referral, 'Enter the referral as text.');
    nothingWritten();
  });

  test('consent must be the boolean true', async () => {
    for (const bad of [undefined, false, 'true', 'yes', 1, 'on', null]) {
      const body = good();
      if (bad === undefined) delete body.consent; else body.consent = bad;
      assert.equal((await errorsOf(body)).consent, 'Please tick the box so Courtside can keep your application.', JSON.stringify(bad));
    }
    nothingWritten();
  });

  test('every failing field is reported at once, each a complete sentence', async () => {
    const errors = await errorsOf({ email: 'nope', name: '', club: '', referral: 'x'.repeat(300), background: '', community: '', destination: '', consent: 'yes', website: '' });
    assert.deepEqual(Object.keys(errors).sort(), ['background', 'club', 'community', 'consent', 'destination', 'email', 'name', 'referral']);
    for (const message of Object.values(errors)) assert.match(message, /^[A-Z].*\.$/, `complete sentence: ${message}`);
    nothingWritten();
  });

  test('a body that is not JSON, or not a JSON object, is a 400 with a body error', async () => {
    assert.deepEqual(await expectJson(await post('{oops'), 400), { ok: false, errors: { body: 'Send the request as JSON.' } });
    const empty = await expectJson(await POST(new Request('http://localhost:3000/api/application', { method: 'POST' })), 400);
    assert.deepEqual(empty, { ok: false, errors: { body: 'Send the request as JSON.' } });
    for (const bad of ['"text"', '[1,2]', '5', 'null', 'true']) {
      assert.deepEqual(await expectJson(await post(bad), 400), { ok: false, errors: { body: 'Send the request as a JSON object.' } }, bad);
    }
    nothingWritten();
  });
});

describe('honeypot', () => {
  test('a filled website field returns 200 { ok:true } and writes nothing, before validation runs', async () => {
    assert.deepEqual(await expectJson(await post(good({ website: 'http://spam.example' })), 200), { ok: true });
    assert.deepEqual(await expectJson(await post(good({ website: 'x', email: 'not-an-email', consent: false, club: '' })), 200), { ok: true }, 'no 400 for a bot');
    assert.deepEqual(await expectJson(await post(good({ website: 5 })), 200), { ok: true });
    nothingWritten();
  });

  test('a missing or blank website field is fine', async () => {
    const body = good();
    delete body.website;
    await expectJson(await post(body), 200);
    await expectJson(await post(good({ email: 'two@example.com', website: '   ' })), 200);
    assert.equal(readMock().host_applications.length, 2);
  });
});

describe('rate limit (bucket "application", 3 per 10 minutes per IP hash)', () => {
  test('the fourth post from one IP is 429 rate_limited; honeypot hits and invalid posts count; another IP is unaffected', async () => {
    assert.equal(RATE_LIMIT_BUCKET, 'application');
    assert.deepEqual(LIMITS.application, { limit: 3, windowMs: 600_000 });
    const h = { 'x-forwarded-for': '198.51.100.50' };
    const statuses = [];
    for (let i = 0; i < 3; i += 1) statuses.push((await post(good({ email: `pro${i}@example.com` }), h)).status);
    assert.deepEqual(statuses, [200, 200, 200]);
    const fourth = await expectJson(await post(good({ email: 'pro4@example.com' }), h), 429);
    assert.deepEqual(fourth, { ok: false, reason: 'rate_limited' });
    assert.equal(readMock().host_applications.length, 3, 'the fourth wrote nothing');
    assert.equal(readMock().log.length, 3, 'a 429 is not logged');

    assert.equal((await post(good({ email: 'other@example.com' }), { 'x-forwarded-for': '198.51.100.51' })).status, 200);

    resetRateLimit();
    const h2 = { 'x-forwarded-for': '198.51.100.52' };
    assert.equal((await post(good({ website: 'spam' }), h2)).status, 200, 'honeypot hits look like success');
    for (let i = 0; i < 2; i += 1) assert.equal((await post(good({ email: 'bad' }), h2)).status, 400);
    assert.equal((await post(good({ email: 'fine@example.com' }), h2)).status, 429, 'three attempts of any kind use up the window');
  });
});

describe('double submit (same email within 60 seconds)', () => {
  test('returns 200 again and writes nothing; a different email is a new row', async () => {
    assert.equal(DOUBLE_SUBMIT_TTL_MS, 60_000);
    await expectJson(await post(good()), 200);
    assert.deepEqual(await expectJson(await post(good({ club: 'Edited club' })), 200), { ok: true });
    assert.deepEqual(await expectJson(await post(good({ email: '  SAM.PRO@example.com ' })), 200), { ok: true }, 'the key is the normalised email');
    let data = readMock();
    assert.equal(data.host_applications.length, 1);
    assert.equal(data.log.length, 1);
    await expectJson(await post(good({ email: 'friend@example.com' })), 200);
    data = readMock();
    assert.deepEqual(data.host_applications.map((r) => r.email), ['sam.pro@example.com', 'friend@example.com']);
    assert.equal(data.log.length, 2);
  });

  test('concurrent identical posts share one write; _resetDoubleSubmit allows the row again', async () => {
    const results = await Promise.all([0, 1, 2].map(() => post(good())));
    for (const res of results) assert.deepEqual(await expectJson(res, 200), { ok: true });
    assert.equal(readMock().host_applications.length, 1);
    _resetDoubleSubmit();
    await expectJson(await post(good()), 200);
    assert.equal(readMock().host_applications.length, 2);
  });
});

describe('store failures', () => {
  test('a failing HostApplications write is 500 server_error and does not poison the double-submit guard', async () => {
    const errors = mock.method(console, 'error', () => {});
    try {
      const file = process.env.MOCK_DATA_PATH;
      process.env.MOCK_DATA_PATH = dir; // a directory: the mock store cannot read or write it
      const json = await expectJson(await post(good()), 500);
      assert.deepEqual(json, { ok: false, reason: 'server_error' });
      assert.ok(errors.mock.callCount() >= 1, 'the failure is reported to the console');
      assert.equal(errors.mock.calls[0].arguments[0], '[api/application]');

      process.env.MOCK_DATA_PATH = file; // the store is healthy again: the same submission must now succeed
      await expectJson(await post(good()), 200);
      assert.equal(readMock().host_applications.length, 1);
    } finally {
      errors.mock.restore();
    }
  });
});
