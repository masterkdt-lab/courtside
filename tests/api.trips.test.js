// tests/api.trips.test.js
// GET /api/trips: cookie required, 4.4 shape, 60-second module cache.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GET, TRIPS_CACHE_TTL_MS, _resetTripsCache } from '../api/trips.js';
import { _reset as resetRateLimit } from '../lib/ratelimit.js';
import { editMock, freshMockPath, getRequest, loginCookie, tempDir, useMockEnv } from './api.helpers.js';

let dir;
before(() => { dir = tempDir(); useMockEnv(); });
after(() => fs.rmSync(dir, { recursive: true, force: true }));
beforeEach(() => { freshMockPath(dir); resetRateLimit(); _resetTripsCache(); useMockEnv(); });

test('401 without a valid cookie', async () => {
  const res = await GET(getRequest('/api/trips'));
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { ok: false, reason: 'unauthorized' });
  const bad = await GET(getRequest('/api/trips', { cookie: 'cs_session=abc.def' }));
  assert.equal(bad.status, 401);
});

test('200 with the trips and weeks in the 4.4 shape', async () => {
  const cookie = await loginCookie('COURTSIDE');
  const res = await GET(getRequest('/api/trips', { cookie }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/json');
  const body = await res.json();
  assert.deepEqual(Object.keys(body), ['trips', 'weeks']);
  assert.deepEqual(body.trips, [{ tripId: 'spain', name: 'The Spanish Offseason', status: 'open', closedMessage: 'Requests for The Spanish Offseason are closed.' }]);
  assert.equal(body.weeks.length, 7);
  assert.deepEqual(body.weeks.map((w) => w.weekId), ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7']);
  assert.deepEqual(body.weeks[4], {
    weekId: 'w5', tripId: 'spain', label: 'Feb 7–13', start: '2027-02-07', end: '2027-02-13', status: 'open', closedMessage: 'Requests for this week are closed.',
  });
  for (const week of body.weeks) assert.deepEqual(Object.keys(week), ['weekId', 'tripId', 'label', 'start', 'end', 'status', 'closedMessage']);
});

test('the response is cached for 60 seconds and _resetTripsCache clears it', async () => {
  assert.equal(TRIPS_CACHE_TTL_MS, 60_000);
  const cookie = await loginCookie('GUEST1');
  const first = await (await GET(getRequest('/api/trips', { cookie }))).json();
  assert.equal(first.weeks[4].status, 'open');
  await editMock((data) => {
    data.weeks[4].status = 'closed';
    data.trips[0].status = 'closed';
  });
  const cached = await (await GET(getRequest('/api/trips', { cookie }))).json();
  assert.equal(cached.weeks[4].status, 'open', 'served from cache');
  assert.equal(cached.trips[0].status, 'open');
  _resetTripsCache();
  const fresh = await (await GET(getRequest('/api/trips', { cookie }))).json();
  assert.equal(fresh.weeks[4].status, 'closed');
  assert.equal(fresh.trips[0].status, 'closed');
  // the cache never bypasses the cookie check
  assert.equal((await GET(getRequest('/api/trips'))).status, 401);
});
