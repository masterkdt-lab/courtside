// tests/api.helpers.js
// Shared setup for the API tests. Not a test file itself (the npm test glob is tests/*.test.js).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const BASE = 'http://localhost:3000';
let counter = 0;

export function tempDir(prefix = 'courtside-api-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Mock store, log-mode email, no NOTIFY_EMAILS / SHEET_URL / VERCEL, dev cookie secret.
export function useMockEnv() {
  delete process.env.DATA_BACKEND;
  delete process.env.COOKIE_SECRET;
  delete process.env.VERCEL;
  delete process.env.NOTIFY_EMAILS;
  delete process.env.SHEET_URL;
  process.env.EMAIL_MODE = 'log';
}

// A fresh mock file for the next test; the store resolves MOCK_DATA_PATH on every call.
export function freshMockPath(dir) {
  process.env.MOCK_DATA_PATH = path.join(dir, `mock-${++counter}.json`);
  return process.env.MOCK_DATA_PATH;
}

export function readMock() {
  return JSON.parse(fs.readFileSync(process.env.MOCK_DATA_PATH, 'utf8'));
}

// Edit the mock file in place (seeding it first); the store reads it fresh on every call.
export async function editMock(mutate) {
  const { readMockData } = await import('../lib/store.mock.js');
  const data = readMockData();
  mutate(data);
  fs.writeFileSync(process.env.MOCK_DATA_PATH, `${JSON.stringify(data, null, 2)}\n`);
}

export function jsonRequest(pathname, body, { method = 'POST', headers = {}, base = BASE } = {}) {
  const init = { method, headers: { 'content-type': 'application/json', ...headers } };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  return new Request(base + pathname, init);
}

export function getRequest(pathname, headers = {}, base = BASE) {
  return new Request(base + pathname, { method: 'GET', headers });
}

// POST /api/code and return the "cs_session=..." pair for a Cookie header.
export async function loginCookie(code = 'GUEST1', headers = {}) {
  const { POST } = await import('../api/code.js');
  const res = await POST(jsonRequest('/api/code', { code }, { headers }));
  assert.equal(res.status, 200, `login with ${code} failed: ${await res.clone().text()}`);
  return res.headers.get('set-cookie').split(';')[0];
}

export const privateBody = (overrides = {}) => ({
  requestType: 'private',
  weeks: ['w5'],
  players: 6,
  partners: 2,
  room: 'club',
  singleRooms: 1,
  tennis: 'daily',
  addons: [{ id: 'eva', qty: 6 }, { id: 'massage', qty: 8 }, { id: 'driver' }, { id: 'free' }],
  note: 'Celebrating a birthday that week.',
  playerEstimate: '$3,400–$3,700',
  partnerEstimate: '$2,200–$2,400',
  groupEstimate: '$30,000–$32,000',
  brief: 'THE SPANISH OFFSEASON — PRIVATE GROUP REQUEST\n\nWeek: Feb 7–13, 2027 (Sunday–Saturday)',
  consent: true,
  website: '',
  ...overrides,
});

export const vettedBody = (overrides = {}) => ({
  requestType: 'vetted',
  weeks: ['w2', 'w3'],
  partyType: 'Couple',
  level: '4.0',
  tennisStyle: 'Competitive / serious',
  travelStyle: 'Independent',
  priorities: ['Great tennis', 'Golf'],
  note: 'We play most weekends.',
  brief: 'THE SPANISH OFFSEASON — VETTED GROUP REQUEST\n\nWeeks that work: Jan 17–23, Jan 24–30',
  consent: true,
  website: '',
  ...overrides,
});
