// tests/api.event.test.js
// POST /api/event (polish brief section 3) against the mock store: both event names, the detail
// rules, the 1 KB cap, text/plain and application/json bodies, the rate limit, the Log row, and a
// store failure that still answers 204.

import { test, describe, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MAX_BODY_BYTES, POST } from '../api/event.js';
import { LIMITS, _reset as resetRateLimit } from '../lib/ratelimit.js';
import { TAB_HEADERS } from '../lib/store.columns.js';
import { readMockData } from '../lib/store.mock.js';
import { EVENT_DETAIL_MAX, EVENT_NAMES } from '../lib/validate.js';
import { TRIPS } from '../public/js/trips.js';
import { freshMockPath, readMock, tempDir, useMockEnv } from './api.helpers.js';

const BASE = 'http://localhost:3000';
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

let dir;
before(() => { dir = tempDir('courtside-event-'); useMockEnv(); });
after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
beforeEach(() => { freshMockPath(dir); resetRateLimit(); useMockEnv(); });

let ipCounter = 0;
const freshIp = () => `203.0.113.${(ipCounter++ % 250) + 1}`;

// The body as a string with the given content type: what navigator.sendBeacon(url, string) sends
// is text/plain;charset=UTF-8; a Blob of type application/json sends that.
function send(body, { contentType = 'text/plain;charset=UTF-8', ip = freshIp() } = {}) {
  const headers = { 'x-forwarded-for': ip };
  if (contentType) headers['content-type'] = contentType;
  const init = { method: 'POST', headers };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  return POST(new Request(`${BASE}/api/event`, init));
}

const expectNoContent = async (res) => {
  assert.equal(res.status, 204, await res.clone().text());
  assert.equal(res.body, null, 'a 204 has no body');
  assert.equal(await res.text(), '');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('content-type'), null);
};
const expectErrors = async (res) => {
  assert.equal(res.status, 400, await res.clone().text());
  assert.equal(res.headers.get('content-type'), 'application/json');
  const json = await res.json();
  assert.equal(json.ok, false);
  assert.ok(json.errors && typeof json.errors === 'object');
  return json.errors;
};
// readMockData seeds the file when no route has touched it yet (a 400 never reaches the store).
const logRows = () => readMockData().log;

describe('accepted events', () => {
  test('no_code_click → 204 with no body and one Log row { time, code, result:"", ip_hash }', async () => {
    const started = Date.now();
    await expectNoContent(await send({ name: 'no_code_click', detail: '' }, { ip: '198.51.100.7' }));
    const log = logRows();
    assert.equal(log.length, 1);
    assert.deepEqual(Object.keys(log[0]), [...TAB_HEADERS.Log]);
    assert.match(log[0].time, ISO);
    assert.ok(Date.parse(log[0].time) >= started - 1000);
    assert.equal(log[0].code, 'no_code_click');
    assert.equal(log[0].result, '');
    assert.match(log[0].ip_hash, /^[0-9a-f]{16}$/);
    assert.equal(readMock().waitlist.length, 0);
    assert.equal(readMock().requests.length, 0);
  });

  test('no_code_click accepts a missing detail or any text up to 80 characters', async () => {
    await expectNoContent(await send({ name: 'no_code_click' }));
    await expectNoContent(await send({ name: 'no_code_click', detail: `  ${'h'.repeat(EVENT_DETAIL_MAX)}  ` }));
    await expectNoContent(await send({ name: 'no_code_click', detail: 'hero' }));
    assert.deepEqual(logRows().map((r) => r.result), ['', 'h'.repeat(80), 'hero']);
    assert.equal(EVENT_DETAIL_MAX, 80);
  });

  test('trip_card_open with every trip id from public/js/trips.js → one Log row each with the id', async () => {
    for (const trip of TRIPS) await expectNoContent(await send({ name: 'trip_card_open', detail: trip.id }));
    assert.deepEqual(logRows().map((r) => [r.code, r.result]), TRIPS.map((t) => ['trip_card_open', t.id]));
    assert.deepEqual([...EVENT_NAMES], ['no_code_click', 'trip_card_open']);
  });

  test('both text/plain (sendBeacon with a string), application/json and no content type are parsed as JSON', async () => {
    await expectNoContent(await send({ name: 'no_code_click', detail: 'a' }, { contentType: 'text/plain;charset=UTF-8' }));
    await expectNoContent(await send({ name: 'no_code_click', detail: 'b' }, { contentType: 'application/json' }));
    await expectNoContent(await send({ name: 'no_code_click', detail: 'c' }, { contentType: null }));
    assert.deepEqual(logRows().map((r) => r.result), ['a', 'b', 'c']);
  });

  test('a body of exactly 1 KB is accepted', async () => {
    const base = { name: 'no_code_click', detail: 'x', pad: '' };
    const overhead = JSON.stringify(base).length;
    const body = JSON.stringify({ ...base, pad: 'p'.repeat(MAX_BODY_BYTES - overhead) });
    assert.equal(new TextEncoder().encode(body).length, MAX_BODY_BYTES);
    assert.equal(MAX_BODY_BYTES, 1024);
    await expectNoContent(await send(body));
    assert.equal(logRows().length, 1);
  });
});

describe('refused events (400, nothing written)', () => {
  test('an unknown name, including the server-written ones', async () => {
    for (const name of ['page_view', 'waitlist_submit', 'ok', 'invalid', '', 'NO_CODE_CLICK', 'trip card open', 5, null, ['no_code_click']]) {
      const errors = await expectErrors(await send({ name, detail: 'spain' }));
      assert.equal(errors.name, 'Unknown event.', JSON.stringify(name));
    }
    const missing = await expectErrors(await send({ detail: 'spain' }));
    assert.equal(missing.name, 'Unknown event.');
    assert.equal(logRows().length, 0);
  });

  test('trip_card_open needs a known trip id; "general" and "General" are not trips', async () => {
    for (const detail of [undefined, '', 'general', 'General', 'Spain', 'spain-2028', 'nowhere', 7]) {
      const errors = await expectErrors(await send({ name: 'trip_card_open', detail }));
      assert.equal(errors.detail, 'The event detail must be a trip id.', JSON.stringify(detail));
    }
    assert.equal(logRows().length, 0);
  });

  test('a detail over 80 characters, or not text', async () => {
    assert.equal((await expectErrors(await send({ name: 'no_code_click', detail: 'x'.repeat(81) }))).detail, 'The event detail is too long.');
    assert.equal((await expectErrors(await send({ name: 'trip_card_open', detail: 'x'.repeat(81) }))).detail, 'The event detail is too long.');
    assert.equal((await expectErrors(await send({ name: 'no_code_click', detail: { id: 'spain' } }))).detail, 'The event detail must be text.');
    assert.equal((await expectErrors(await send({ name: 'no_code_click', detail: ['spain'] }))).detail, 'The event detail must be text.');
    assert.equal(logRows().length, 0);
  });

  test('a body over 1 KB, measured in bytes, is refused before parsing', async () => {
    const over = JSON.stringify({ name: 'no_code_click', detail: 'x', pad: 'p'.repeat(MAX_BODY_BYTES) });
    assert.deepEqual(await expectErrors(await send(over)), { body: 'The event is too large.' });
    const multibyte = JSON.stringify({ name: 'no_code_click', detail: 'x', pad: '€'.repeat(400) }); // 1,200+ bytes, under 1,024 characters
    assert.ok(multibyte.length < MAX_BODY_BYTES && new TextEncoder().encode(multibyte).length > MAX_BODY_BYTES);
    assert.deepEqual(await expectErrors(await send(multibyte)), { body: 'The event is too large.' });
    assert.deepEqual(await expectErrors(await send('{'.repeat(2000))), { body: 'The event is too large.' }, 'size wins over syntax');
    assert.equal(logRows().length, 0);
  });

  test('not JSON, empty, or not a JSON object', async () => {
    assert.deepEqual(await expectErrors(await send('name=no_code_click')), { body: 'Send the event as JSON.' });
    assert.deepEqual(await expectErrors(await send('')), { body: 'Send the event as JSON.' });
    assert.deepEqual(await expectErrors(await send(undefined)), { body: 'Send the event as JSON.' });
    for (const bad of ['"no_code_click"', '[]', '7', 'null']) {
      assert.deepEqual(await expectErrors(await send(bad)), { body: 'Send the event as a JSON object.' }, bad);
    }
    assert.equal(logRows().length, 0);
  });
});

describe('rate limit (bucket "event", 60 per 10 minutes per IP hash)', () => {
  test('the 61st event from one IP is 429 rate_limited and not logged; another IP is unaffected', async () => {
    assert.deepEqual(LIMITS.event, { limit: 60, windowMs: 600_000 });
    const ip = '198.51.100.90';
    for (let i = 0; i < 60; i += 1) assert.equal((await send({ name: 'no_code_click', detail: String(i) }, { ip })).status, 204, `event ${i + 1}`);
    const res = await send({ name: 'no_code_click', detail: '61' }, { ip });
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('content-type'), 'application/json');
    assert.deepEqual(await res.json(), { ok: false, reason: 'rate_limited' });
    assert.equal(logRows().length, 60);
    assert.equal((await send({ name: 'no_code_click', detail: 'other' }, { ip: '198.51.100.91' })).status, 204);
  });
});

describe('best effort', () => {
  test('a failing store still answers 204 and reports the failure to the console', async () => {
    const errors = mock.method(console, 'error', () => {});
    try {
      process.env.MOCK_DATA_PATH = dir; // a directory: the mock store cannot read or write it
      await expectNoContent(await send({ name: 'trip_card_open', detail: 'spain' }));
      assert.equal(errors.mock.callCount(), 1);
      assert.equal(errors.mock.calls[0].arguments[0], '[api/event] logAttempt failed');
    } finally {
      errors.mock.restore();
    }
  });
});
