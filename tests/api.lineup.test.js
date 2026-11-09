// tests/api.lineup.test.js
// GET /api/lineup (CONCEPT02_PLAN.md): public, the Spain trip row and its weeks, 60-second module
// cache, null trip when the row is missing, 500 on a store failure.

import { test, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GET, LINEUP_CACHE_TTL_MS, LINEUP_TRIP_ID, _resetLineupCache, readLineup, toLineupWeek } from '../api/lineup.js';
import { editMock, freshMockPath, getRequest, tempDir, useMockEnv } from './api.helpers.js';

const WEEK_KEYS = ['weekId', 'label', 'start', 'end', 'status', 'closedMessage'];
const SPAIN = { tripId: 'spain', name: 'The Spanish Offseason', status: 'open', closedMessage: 'Requests for The Spanish Offseason are closed.' };

let dir;
before(() => { dir = tempDir('courtside-lineup-'); useMockEnv(); });
after(() => fs.rmSync(dir, { recursive: true, force: true }));
beforeEach(() => { freshMockPath(dir); _resetLineupCache(); useMockEnv(); });

const expectJson = async (res, status) => {
  assert.equal(res.status, status, await res.clone().text());
  assert.equal(res.headers.get('content-type'), 'application/json');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  return res.json();
};

test('200 with { trip, weeks } and no cookie: the spain row and its seven weeks, in sheet order', async () => {
  assert.equal(LINEUP_TRIP_ID, 'spain');
  const body = await expectJson(await GET(getRequest('/api/lineup')), 200);
  assert.deepEqual(Object.keys(body), ['trip', 'weeks']);
  assert.deepEqual(body.trip, SPAIN);
  assert.equal(body.weeks.length, 7);
  assert.deepEqual(body.weeks.map((w) => w.weekId), ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7']);
  assert.deepEqual(body.weeks[4], {
    weekId: 'w5', label: 'Feb 7–13', start: '2027-02-07', end: '2027-02-13', status: 'open', closedMessage: 'Requests for this week are closed.',
  });
  for (const week of body.weeks) assert.deepEqual(Object.keys(week), WEEK_KEYS, 'no tripId: every week here is the one trip\'s');
  // A garbage cookie changes nothing: the route never reads it.
  const withCookie = await expectJson(await GET(getRequest('/api/lineup', { cookie: 'cs_session=abc.def' })), 200);
  assert.deepEqual(withCookie, body);
});

test('closed status and closed messages come through as the Sheet has them', async () => {
  await editMock((data) => {
    data.weeks[1].status = 'closed';
    data.weeks[1].closed_message = 'Jan 17–23 is full.';
    data.weeks[6].status = 'Closed'; // the store normalises case
    data.trips[0].status = 'closed';
  });
  const body = await expectJson(await GET(getRequest('/api/lineup')), 200);
  assert.equal(body.trip.status, 'closed');
  assert.deepEqual(body.weeks.map((w) => w.status), ['open', 'closed', 'open', 'open', 'open', 'open', 'closed']);
  assert.equal(body.weeks[1].closedMessage, 'Jan 17–23 is full.');
});

test('weeks of another trip are left out; a missing spain row is trip:null, not an error', async () => {
  await editMock((data) => {
    data.weeks.push({ week_id: 'm1', trip_id: 'mallorca', label: 'Jun 6–12', start_date: '2027-06-06', end_date: '2027-06-12', status: 'open', closed_message: '' });
    data.trips[0].trip_id = 'mallorca';
  });
  const body = await expectJson(await GET(getRequest('/api/lineup')), 200);
  assert.equal(body.trip, null);
  assert.equal(body.weeks.length, 7);
  assert.ok(body.weeks.every((w) => w.weekId !== 'm1'));
});

test('the response is cached for 60 seconds and _resetLineupCache clears it; readLineup is always fresh', async () => {
  assert.equal(LINEUP_CACHE_TTL_MS, 60_000);
  const first = await (await GET(getRequest('/api/lineup'))).json();
  assert.equal(first.weeks[4].status, 'open');
  await editMock((data) => {
    data.weeks[4].status = 'closed';
    data.trips[0].status = 'closed';
  });
  const cached = await (await GET(getRequest('/api/lineup'))).json();
  assert.equal(cached.weeks[4].status, 'open', 'served from cache');
  assert.equal(cached.trip.status, 'open');
  const fresh = await readLineup();
  assert.equal(fresh.weeks[4].status, 'closed', 'readLineup bypasses the cache (what /api/inquiry uses)');
  assert.equal(fresh.trip.status, 'closed');
  _resetLineupCache();
  const after = await (await GET(getRequest('/api/lineup'))).json();
  assert.equal(after.weeks[4].status, 'closed');
  assert.equal(after.trip.status, 'closed');
});

test('toLineupWeek keeps the six public fields only', () => {
  assert.deepEqual(
    toLineupWeek({ weekId: 'w1', tripId: 'spain', label: 'Jan 10–16', start: '2027-01-10', end: '2027-01-16', status: 'open', closedMessage: '', extra: 1 }),
    { weekId: 'w1', label: 'Jan 10–16', start: '2027-01-10', end: '2027-01-16', status: 'open', closedMessage: '' },
  );
});

test('a store failure is 500 server_error and is not cached', async () => {
  const errors = mock.method(console, 'error', () => {});
  try {
    const file = process.env.MOCK_DATA_PATH;
    process.env.MOCK_DATA_PATH = dir; // a directory: the mock store cannot read it
    const json = await expectJson(await GET(getRequest('/api/lineup')), 500);
    assert.deepEqual(json, { ok: false, reason: 'server_error' });
    assert.equal(errors.mock.calls[0].arguments[0], '[api/lineup]');
    process.env.MOCK_DATA_PATH = file;
    const ok = await expectJson(await GET(getRequest('/api/lineup')), 200);
    assert.deepEqual(ok.trip, SPAIN);
  } finally {
    errors.mock.restore();
  }
});
