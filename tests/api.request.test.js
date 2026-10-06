// tests/api.request.test.js
// POST /api/request end to end against the mock store and log-mode email.

import { test, describe, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { POST, _resetDoubleSubmit, formatAddons } from '../api/request.js';
import { _resetSentLog, sentLog } from '../lib/email.js';
import { _reset as resetRateLimit } from '../lib/ratelimit.js';
import { TAB_HEADERS } from '../lib/store.columns.js';
import {
  editMock, freshMockPath, jsonRequest, loginCookie, privateBody, readMock, tempDir, useMockEnv, vettedBody,
} from './api.helpers.js';

const IDENTITY_COMMENT = [
  '// IDENTITY: the guest\'s name, email and mobile come from the invite row (one code per guest,',
  '// set by Katie in the Invites tab), not from form fields. Decision KC 2026-10-05.',
  '// Alternative, if shared codes are wanted later: collect name/email/mobile (+ consent) in the',
  '// request modal and validate them here; the Requests columns already exist for them.',
].join('\n');
const PRIVATE_COLUMNS = ['players', 'partners', 'room', 'single_rooms', 'tennis', 'addons', 'player_estimate', 'partner_estimate', 'group_estimate'];
const VETTED_COLUMNS = ['party_type', 'level', 'tennis_style', 'travel_style', 'priorities'];
const ID = /^CS-[0-9A-HJKMNP-TV-Z]{8}$/;

let dir;
let quiet;
before(() => { dir = tempDir(); useMockEnv(); quiet = mock.method(console, 'log', () => {}); });
after(() => { quiet.mock.restore(); fs.rmSync(dir, { recursive: true, force: true }); });
beforeEach(() => { freshMockPath(dir); resetRateLimit(); _resetDoubleSubmit(); _resetSentLog(); useMockEnv(); });

const post = (body, cookie, headers = {}) => POST(jsonRequest('/api/request', body, { headers: cookie ? { cookie, ...headers } : headers }));
const expectJson = async (res, status) => {
  assert.equal(res.status, status, await res.clone().text());
  assert.equal(res.headers.get('content-type'), 'application/json');
  return res.json();
};

test('api/request.js starts with the 4.7 identity comment, verbatim', () => {
  const source = fs.readFileSync(new URL('../api/request.js', import.meta.url), 'utf8');
  assert.ok(source.startsWith(`${IDENTITY_COMMENT}\n`));
});

test('401 without a cookie; nothing is written', async () => {
  const body = await expectJson(await post(privateBody(), null), 401);
  assert.deepEqual(body, { ok: false, reason: 'unauthorized' });
  await expectJson(await post(privateBody(), 'cs_session=abc.def'), 401);
  assert.equal(sentLog.length, 0);
});

test('400 with field errors, and for a body that is not JSON', async () => {
  const cookie = await loginCookie('GUEST1');
  const body = await expectJson(await post(privateBody({ players: 3, consent: false, room: 'x' }), cookie), 400);
  assert.equal(body.ok, false);
  assert.deepEqual(body.errors, {
    players: 'Players must be between 4 and 12.',
    consent: 'Please agree to the privacy notice to send your request.',
    room: 'Choose a room.',
  });
  const notJson = await expectJson(await post('{oops', cookie), 400);
  assert.deepEqual(notJson, { ok: false, errors: { body: 'Send the request as JSON.' } });
  assert.equal(readMock().requests.length, 0);
  assert.equal(sentLog.length, 0);
});

test('a filled honeypot returns a fake success and writes nothing', async () => {
  const cookie = await loginCookie('GUEST1');
  const body = await expectJson(await post(privateBody({ website: 'http://spam.example' }), cookie), 200);
  assert.equal(body.ok, true);
  assert.match(body.requestId, ID);
  assert.equal(body.guestEmailSent, false);
  assert.equal(readMock().requests.length, 0);
  assert.equal(sentLog.length, 0);
});

describe('valid requests', () => {
  test('private → 200, one Requests row with every private column filled, two emails', async () => {
    process.env.SHEET_URL = 'https://docs.google.com/spreadsheets/d/abc';
    const cookie = await loginCookie('GUEST1');
    const body = await expectJson(await post(privateBody(), cookie), 200);
    assert.match(body.requestId, ID);
    assert.deepEqual(body, { ok: true, requestId: body.requestId, guestEmailSent: true });

    const { requests } = readMock();
    assert.equal(requests.length, 1);
    const row = requests[0];
    assert.deepEqual(Object.keys(row), [...TAB_HEADERS.Requests]);
    assert.equal(row.request_id, body.requestId);
    assert.match(row.submitted_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(row.trip_id, 'spain');
    assert.equal(row.request_type, 'private');
    assert.equal(row.weeks, 'Feb 7–13');
    assert.equal(row.guest_name, 'Ana Guest');
    assert.equal(row.guest_email, 'ana.guest@example.com');
    assert.equal(row.guest_mobile, '+1 555 0100');
    assert.equal(row.players, 6);
    assert.equal(row.partners, 2);
    assert.equal(row.room, 'Club View');
    assert.equal(row.single_rooms, 1);
    assert.equal(row.tennis, 'Daily tennis');
    assert.equal(row.addons, 'Extra session with Eva ×6, Massage ×8, Private 6-hour driver / excursion, Please do not overschedule me.');
    assert.equal(row.note, 'Celebrating a birthday that week.');
    assert.equal(row.player_estimate, '$3,400–$3,700');
    assert.equal(row.partner_estimate, '$2,200–$2,400');
    assert.equal(row.group_estimate, '$30,000–$32,000');
    assert.equal(row.brief, privateBody().brief);
    assert.equal(row.invite_code, 'GUEST1');
    assert.equal(row.invited_by, 'Katie');
    assert.equal(row.status, 'New');
    assert.equal(row.owner, '');
    assert.equal(row.internal_notes, '');
    for (const column of PRIVATE_COLUMNS) assert.notEqual(row[column], '', column);
    for (const column of VETTED_COLUMNS) assert.equal(row[column], '', column);

    assert.equal(sentLog.length, 2);
    const [katie, guest] = sentLog;
    assert.deepEqual(katie.to, ['notify@example.com']);
    assert.equal(katie.subject, `New request ${body.requestId} · private · Feb 7–13`);
    for (const line of ['Guest: Ana Guest', 'Email: ana.guest@example.com', 'Mobile: +1 555 0100', 'Invite code: GUEST1 (invited by Katie)', privateBody().brief, 'Sheet: https://docs.google.com/spreadsheets/d/abc']) {
      assert.ok(katie.text.includes(line), line);
    }
    assert.deepEqual(guest.to, ['ana.guest@example.com']);
    assert.ok(guest.text.startsWith("You're on our list."));
    assert.ok(guest.text.includes(body.requestId));
    assert.ok(guest.text.includes(privateBody().brief));
  });

  test('vetted → 200, one row with every vetted column filled, two emails', async () => {
    const cookie = await loginCookie('GUEST1');
    const body = await expectJson(await post(vettedBody(), cookie), 200);
    assert.deepEqual(body, { ok: true, requestId: body.requestId, guestEmailSent: true });
    const row = readMock().requests[0];
    assert.equal(row.request_type, 'vetted');
    assert.equal(row.weeks, 'Jan 17–23, Jan 24–30');
    assert.equal(row.party_type, 'Couple');
    assert.equal(row.level, '4.0');
    assert.equal(row.tennis_style, 'Competitive / serious');
    assert.equal(row.travel_style, 'Independent');
    assert.equal(row.priorities, 'Great tennis, Golf');
    assert.equal(row.note, 'We play most weekends.');
    assert.equal(row.brief, vettedBody().brief);
    assert.equal(row.guest_name, 'Ana Guest');
    assert.equal(row.invite_code, 'GUEST1');
    assert.equal(row.status, 'New');
    for (const column of VETTED_COLUMNS) assert.notEqual(row[column], '', column);
    for (const column of PRIVATE_COLUMNS) assert.equal(row[column], '', column);
    assert.equal(sentLog.length, 2);
    assert.equal(sentLog[0].subject, `New request ${body.requestId} · vetted · Jan 17–23, Jan 24–30`);
    assert.deepEqual(sentLog[1].to, ['ana.guest@example.com']);
  });

  test('COURTSIDE (no guest email) → one email, guestEmailSent:false', async () => {
    const cookie = await loginCookie('COURTSIDE');
    const body = await expectJson(await post(vettedBody({ weeks: ['w1'], priorities: [] }), cookie), 200);
    assert.equal(body.guestEmailSent, false);
    const row = readMock().requests[0];
    assert.equal(row.guest_name, 'Shared test code');
    assert.equal(row.guest_email, '');
    assert.equal(row.guest_mobile, '');
    assert.equal(row.priorities, '');
    assert.equal(row.weeks, 'Jan 10–16');
    assert.equal(sentLog.length, 1);
    assert.ok(sentLog[0].text.includes('Email: no guest email on this invite'));
  });

  test('NOTIFY_EMAILS may hold several addresses', async () => {
    process.env.NOTIFY_EMAILS = 'katie@example.com, kc@example.com';
    const cookie = await loginCookie('COURTSIDE');
    await expectJson(await post(privateBody(), cookie), 200);
    assert.equal(sentLog.length, 1);
    assert.deepEqual(sentLog[0].to, ['katie@example.com', 'kc@example.com']);
  });

  test('identity comes from the invite row at request time, never from the body', async () => {
    const cookie = await loginCookie('GUEST1');
    await expectJson(await post(privateBody({ guestName: 'Mallory', guestEmail: 'mallory@example.com', inviteCode: 'ADMIN', invitedBy: 'Nobody' }), cookie), 200);
    const row = readMock().requests[0];
    assert.equal(row.guest_name, 'Ana Guest');
    assert.equal(row.guest_email, 'ana.guest@example.com');
    assert.equal(row.invite_code, 'GUEST1');
    assert.equal(row.invited_by, 'Katie');
    await editMock((data) => { data.invites.find((i) => i.code === 'GUEST1').guest_mobile = '+1 555 0199'; });
    await expectJson(await post(privateBody({ weeks: ['w6'] }), cookie), 200);
    assert.equal(readMock().requests[1].guest_mobile, '+1 555 0199');
  });

  test('a code revoked after sign-in can no longer submit', async () => {
    const cookie = await loginCookie('GUEST1');
    await editMock((data) => { data.invites.find((i) => i.code === 'GUEST1').status = 'revoked'; });
    assert.deepEqual(await expectJson(await post(privateBody(), cookie), 401), { ok: false, reason: 'unauthorized' });
    assert.equal(readMock().requests.length, 0);
    await editMock((data) => { data.invites = data.invites.filter((i) => i.code !== 'GUEST1'); });
    assert.equal((await post(privateBody(), cookie)).status, 401);
  });

  test('a code paused after sign-in can no longer submit', async () => {
    const cookie = await loginCookie('GUEST1');
    await editMock((data) => { data.invites.find((i) => i.code === 'GUEST1').status = 'paused'; });
    assert.deepEqual(await expectJson(await post(privateBody(), cookie), 401), { ok: false, reason: 'unauthorized' });
    assert.equal(readMock().requests.length, 0);
  });
});

describe('open / closed', () => {
  test('a closed week → 409 week_closed with the closed ids (status read fresh, no cache)', async () => {
    const cookie = await loginCookie('GUEST1');
    await expectJson(await post(privateBody(), cookie), 200);
    await editMock((data) => { data.weeks.find((w) => w.week_id === 'w5').status = 'closed'; });
    const body = await expectJson(await post(privateBody({ weeks: ['w5'] }), cookie), 409);
    assert.deepEqual(body, { ok: false, reason: 'week_closed', weeks: ['w5'] });
    const vetted = await expectJson(await post(vettedBody({ weeks: ['w6', 'w5', 'w1'] }), cookie), 409);
    assert.deepEqual(vetted, { ok: false, reason: 'week_closed', weeks: ['w5'] });
    await expectJson(await post(vettedBody({ weeks: ['w6', 'w1'] }), cookie), 200);
    assert.equal(readMock().requests.length, 2);
    assert.equal(sentLog.length, 4);
  });

  test('a week missing from the store counts as closed', async () => {
    const cookie = await loginCookie('GUEST1');
    await editMock((data) => { data.weeks = data.weeks.filter((w) => w.week_id !== 'w7'); });
    assert.deepEqual(await expectJson(await post(privateBody({ weeks: ['w7'] }), cookie), 409), { ok: false, reason: 'week_closed', weeks: ['w7'] });
  });

  test('trip closed, or every week closed → 409 trip_closed', async () => {
    const cookie = await loginCookie('GUEST1');
    await editMock((data) => { data.trips[0].status = 'closed'; });
    assert.deepEqual(await expectJson(await post(privateBody(), cookie), 409), { ok: false, reason: 'trip_closed' });
    await editMock((data) => { data.trips[0].status = 'open'; data.weeks.forEach((w) => { w.status = 'closed'; }); });
    assert.deepEqual(await expectJson(await post(vettedBody(), cookie), 409), { ok: false, reason: 'trip_closed' });
    await editMock((data) => { data.trips = []; });
    assert.equal((await post(privateBody(), cookie)).status, 409);
    assert.equal(readMock().requests.length, 0);
    assert.equal(sentLog.length, 0);
  });
});

describe('double submit and rate limit', () => {
  test('an identical code + type + weeks + brief within 60 s returns the first response and writes once', async () => {
    const cookie = await loginCookie('GUEST1');
    const first = await expectJson(await post(privateBody(), cookie), 200);
    const second = await expectJson(await post(privateBody({ note: 'changed' }), cookie), 200);
    assert.deepEqual(second, first);
    assert.equal(readMock().requests.length, 1);
    assert.equal(sentLog.length, 2);
    // concurrent double-click
    const [a, b] = await Promise.all([post(vettedBody(), cookie), post(vettedBody(), cookie)]);
    assert.deepEqual(await a.json(), await b.json());
    assert.equal(readMock().requests.length, 2);
    // different weeks or type → a new request
    const other = await expectJson(await post(privateBody({ weeks: ['w6'] }), cookie), 200);
    assert.notEqual(other.requestId, first.requestId);
    assert.equal(readMock().requests.length, 3);
    _resetDoubleSubmit();
    resetRateLimit();
    const again = await expectJson(await post(privateBody(), cookie), 200);
    assert.notEqual(again.requestId, first.requestId);
    // a changed brief (any edited builder choice) within 60 s is a new request
    const edited = await expectJson(await post(privateBody({ brief: 'edited brief' }), cookie), 200);
    assert.notEqual(edited.requestId, again.requestId);
    assert.equal(readMock().requests.length, 5);
  });

  test('a different code with the same type and weeks is a separate request', async () => {
    const guest = await loginCookie('GUEST1');
    const shared = await loginCookie('COURTSIDE');
    const a = await expectJson(await post(privateBody(), guest), 200);
    const b = await expectJson(await post(privateBody(), shared), 200);
    assert.notEqual(a.requestId, b.requestId);
    assert.equal(readMock().requests.length, 2);
  });

  test('the 6th post from one IP within the window → 429 rate_limited', async () => {
    const cookie = await loginCookie('GUEST1');
    const ip = { 'x-forwarded-for': '203.0.113.50' };
    for (let i = 1; i <= 5; i += 1) await expectJson(await post(privateBody(), cookie, ip), 200);
    assert.deepEqual(await expectJson(await post(privateBody(), cookie, ip), 429), { ok: false, reason: 'rate_limited' });
    await expectJson(await post(privateBody(), cookie, { 'x-forwarded-for': '203.0.113.51' }), 200);
    assert.equal(readMock().requests.length, 1, 'double-submit still collapsed the valid posts');
  });
});

test('formatAddons renders names with ×qty for player/guest add-ons only', () => {
  assert.equal(formatAddons([{ id: 'eva', qty: 6 }, { id: 'golf', qty: 4 }, { id: 'driver' }, { id: 'free' }]), 'Extra session with Eva ×6, Round of golf ×4, Private 6-hour driver / excursion, Please do not overschedule me.');
  assert.equal(formatAddons([]), '');
  assert.equal(formatAddons([{ id: 'nope', qty: 1 }]), '');
});
