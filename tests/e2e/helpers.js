// tests/e2e/helpers.js
// Shared setup for the end-to-end suites (not a test file; the glob is tests/e2e/*.test.js).
//
// Every suite starts its own dev server in-process (scripts/dev-server.js createServer) on a free
// port, with MOCK_DATA_PATH pointed at a temp file, so .data/mock.json is never touched. Because
// the API modules run in this same process, the suites can read lib/email.js sentLog directly and
// reset the in-memory rate limits, the double-submit guard and the 60 s /api/trips cache instead
// of restarting a server.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SEED_CODES = ['GUEST1', 'COURTSIDE', 'PAUSED1', 'ONCE1'];
export const WEEK_LABELS = {
  w1: 'Jan 10–16', w2: 'Jan 17–23', w3: 'Jan 24–30', w4: 'Jan 31–Feb 6', w5: 'Feb 7–13', w6: 'Feb 14–20', w7: 'Feb 21–27',
};

let fileCounter = 0;
let ipCounter = 0;

// Fresh temp mock file + mock/log env. Call before createServer() and before any API call.
export function useTempMock(prefix = 'courtside-e2e-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const file = path.join(dir, `mock-${++fileCounter}.json`);
  process.env.MOCK_DATA_PATH = file;
  delete process.env.DATA_BACKEND;
  delete process.env.COOKIE_SECRET;
  delete process.env.VERCEL;
  delete process.env.NOTIFY_EMAILS;
  delete process.env.SHEET_URL;
  process.env.EMAIL_MODE = 'log';
  return { dir, file };
}

export async function startServer() {
  const { createServer } = await import('../../scripts/dev-server.js');
  const server = createServer({ quiet: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    server,
    port,
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    }),
  };
}

// Clears everything the server keeps in memory: rate-limit buckets, the double-submit map, the
// trips cache and the email log. Equivalent to a server restart for the API modules.
export async function resetServerState() {
  const [ratelimit, request, trips, email] = await Promise.all([
    import('../../lib/ratelimit.js'), import('../../api/request.js'), import('../../api/trips.js'), import('../../lib/email.js'),
  ]);
  ratelimit._reset();
  request._resetDoubleSubmit();
  trips._resetTripsCache();
  email._resetSentLog();
}

export async function sentEmails() {
  const { sentLog } = await import('../../lib/email.js');
  return sentLog;
}

export function readMock() {
  return JSON.parse(fs.readFileSync(process.env.MOCK_DATA_PATH, 'utf8'));
}

// Edit the mock file in place (seeding it first) and drop the /api/trips cache, which is what a
// Sheet edit plus the 60 s TTL (or a dev-server restart) would do.
export async function editMock(mutate) {
  const { readMockData } = await import('../../lib/store.mock.js');
  const data = readMockData();
  mutate(data);
  fs.writeFileSync(process.env.MOCK_DATA_PATH, `${JSON.stringify(data, null, 2)}\n`);
  const { _resetTripsCache } = await import('../../api/trips.js');
  _resetTripsCache();
}

export async function resetMock() {
  fs.rmSync(process.env.MOCK_DATA_PATH, { force: true });
  await resetServerState();
}

export const setWeekStatus = (weekId, status) => editMock((d) => {
  d.weeks.find((w) => w.week_id === weekId).status = status;
});
export const setAllWeeks = (status) => editMock((d) => {
  d.weeks.forEach((w) => { w.status = status; });
});
export const setTripStatus = (status) => editMock((d) => {
  d.trips.find((t) => t.trip_id === 'spain').status = status;
});

// A distinct client IP per caller so the per-IP rate limits never bleed between tests.
export function freshIp() {
  ipCounter += 1;
  return `10.0.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
}

// fetch wrapper: JSON in, { status, headers, setCookie, text, json } out, no redirect following.
export async function http(base, pathname, { method = 'GET', body, cookie, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['content-type'] = 'application/json';
  if (cookie) h.cookie = cookie;
  const res = await fetch(base + pathname, {
    method, headers: h, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)), redirect: 'manual',
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: res.status, headers: res.headers, setCookie: res.headers.getSetCookie?.() ?? [], text, json };
}

// POST /api/code and return "cs_session=<token>" for a Cookie header (and the raw token).
export async function login(base, code = 'GUEST1', headers = { 'x-forwarded-for': freshIp() }) {
  const res = await http(base, '/api/code', { method: 'POST', body: { code }, headers });
  if (res.status !== 200) throw new Error(`login with ${code} failed: ${res.status} ${res.text}`);
  const pair = res.setCookie[0].split(';')[0];
  return { pair, token: pair.slice('cs_session='.length), body: res.json };
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

// Requests columns (plan 4.2) split by which request type fills them.
export const COLUMNS = {
  always: ['request_id', 'submitted_at', 'trip_id', 'request_type', 'weeks', 'guest_name', 'brief', 'invite_code', 'invited_by', 'status'],
  identity: ['guest_email', 'guest_mobile'],
  privateOnly: ['players', 'partners', 'room', 'single_rooms', 'tennis', 'addons', 'player_estimate', 'partner_estimate', 'group_estimate'],
  vettedOnly: ['party_type', 'level', 'tennis_style', 'travel_style', 'priorities'],
  katie: ['owner', 'internal_notes'],
  note: ['note'],
};

// Flip the last character of the HMAC so the signature no longer matches.
export function tamper(cookiePair) {
  const last = cookiePair[cookiePair.length - 1];
  return cookiePair.slice(0, -1) + (last === 'A' ? 'B' : 'A');
}
