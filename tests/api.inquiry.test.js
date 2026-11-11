// tests/api.inquiry.test.js
// POST /api/inquiry (CONCEPT02_PLAN.md) against the mock store and log-mode email: every validation
// rule, the honeypot, the shared "request" rate limit, trip and week status read fresh, the
// double-submit guard, the full 29-column Requests row for one group and one match request, the
// brief text, invite columns from a cs_session cookie (blank without), the Log row and the email.

import { test, describe, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DOUBLE_SUBMIT_TTL_MS, FLEXIBLE_WEEKS, LOG_CODE, NOT_SURE, PATH_LABEL, POST, RATE_LIMIT_BUCKET, REQUEST_TYPE_BY_PATH, SHOWN_PRICE,
  SUBMITTED_FROM, TRIP_CLOSED_MESSAGE, TRIP_LINE, _resetDoubleSubmit, buildBrief, buildRow, formatWeeks, weekClosedMessage,
} from '../api/inquiry.js';
import { _resetLineupCache } from '../api/lineup.js';
import { _resetSentLog, sentLog } from '../lib/email.js';
import { LIMITS, _reset as resetRateLimit } from '../lib/ratelimit.js';
import { TAB_HEADERS } from '../lib/store.columns.js';
import { readMockData } from '../lib/store.mock.js';
import {
  INQUIRY_FLEXIBLE, INQUIRY_LEVELS, INQUIRY_LIMITS, INQUIRY_PARTIES, INQUIRY_PATHS, INQUIRY_RANGES, INQUIRY_TENNIS, validateInquiry,
} from '../lib/validate.js';
import { editMock, freshMockPath, jsonRequest, loginCookie, readMock, tempDir, useMockEnv } from './api.helpers.js';

const ID = /^CS-[0-9A-HJKMNP-TV-Z]{8}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

let dir;
let quiet;
before(() => { dir = tempDir('courtside-inquiry-'); useMockEnv(); quiet = mock.method(console, 'log', () => {}); });
after(() => { quiet.mock.restore(); fs.rmSync(dir, { recursive: true, force: true }); });
beforeEach(() => { freshMockPath(dir); resetRateLimit(); _resetDoubleSubmit(); _resetLineupCache(); _resetSentLog(); useMockEnv(); });

let ipCounter = 0;
const freshIp = () => `203.0.113.${(ipCounter++ % 250) + 1}`;

// The two Concept 02 paths as the SPA sends them (CONCEPT02_PLAN.md body).
const groupBody = (overrides = {}) => ({
  path: 'group',
  weeks: ['w5'],
  players: '6',
  partners: '2',
  tennis: 'Daily tennis',
  name: ' Ana Guest ',
  email: 'Ana.Guest@Example.com',
  notes: 'Celebrating a birthday that week.',
  consent: true,
  website: '',
  ...overrides,
});
const matchBody = (overrides = {}) => ({
  path: 'match',
  weeks: ['w2', 'w3'],
  party: 'Couple',
  level: '4.0',
  tennis: 'Four mornings',
  name: 'Sam Match',
  email: 'sam@example.com',
  notes: '',
  consent: true,
  website: '',
  ...overrides,
});

// A fresh IP per post unless the test says otherwise, so only the rate-limit test meets the limit.
const post = (body, headers = {}) => POST(jsonRequest('/api/inquiry', body, { headers: { 'x-forwarded-for': freshIp(), ...headers } }));
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
// readMockData seeds the file when no route has touched it yet.
const nothingWritten = () => {
  const data = readMockData();
  assert.equal(data.requests.length, 0, 'no Requests row');
  assert.equal(data.log.length, 0, 'no Log row');
  assert.equal(sentLog.length, 0, 'no email');
};

describe('a valid group request', () => {
  test('200 { ok, requestId }; the 29-column Requests row with the exact Concept 02 mapping; one Log row; one email', async () => {
    process.env.SHEET_URL = 'https://docs.google.com/spreadsheets/d/abc';
    const started = Date.now();
    const json = await expectJson(await post(groupBody()), 200);
    assert.deepEqual(Object.keys(json), ['ok', 'requestId', 'groupId', 'memberId'], 'the group path adds the Wave 2 ids');
    assert.equal(json.ok, true);
    assert.match(json.requestId, ID);

    const { requests, log: allLog, waitlist } = readMock();
    const log = allLog.filter((l) => l.code === LOG_CODE);
    assert.deepEqual(allLog.map((l) => l.code), ['inquiry_submit', 'group_create', 'member_add']);
    assert.equal(requests.length, 1);
    const row = requests[0];
    assert.deepEqual(Object.keys(row), [...TAB_HEADERS.Requests]);
    assert.equal(Object.keys(row).length, 29);
    assert.match(row.submitted_at, ISO);
    assert.ok(Date.parse(row.submitted_at) >= started - 1000);
    const brief = [
      'TRIP REQUEST · Private group',
      'Trip: The Spanish Offseason (Spain with Katie + Eva)',
      'Weeks: Feb 7–13',
      'Players: 6',
      'Partners: 2',
      'Party: —',
      'Tennis level: —',
      'Tennis rhythm: Daily tennis',
      'Name: Ana Guest',
      'Email: ana.guest@example.com',
      'Notes: Celebrating a birthday that week.',
      'Shown price: From $2,995 / player',
      'Submitted from: courtsidetravel.co trip request',
    ].join('\n');
    assert.deepEqual({ ...row, submitted_at: 'ISO' }, {
      request_id: json.requestId,
      submitted_at: 'ISO',
      trip_id: 'spain',
      request_type: 'private',
      weeks: 'Feb 7–13',
      guest_name: 'Ana Guest',
      guest_email: 'ana.guest@example.com',
      guest_mobile: '',
      players: 6,
      partners: 2,
      room: '',
      single_rooms: '',
      tennis: 'Daily tennis',
      addons: '',
      party_type: '',
      level: '',
      tennis_style: '',
      travel_style: '',
      priorities: '',
      note: 'Celebrating a birthday that week.',
      player_estimate: '',
      partner_estimate: '',
      group_estimate: '',
      brief,
      invite_code: '',
      invited_by: '',
      status: 'New',
      owner: '',
      internal_notes: '',
    });
    assert.equal(waitlist.length, 0);

    assert.equal(log.length, 1);
    assert.deepEqual(Object.keys(log[0]), [...TAB_HEADERS.Log]);
    assert.match(log[0].time, ISO);
    assert.equal(log[0].code, LOG_CODE);
    assert.equal(LOG_CODE, 'inquiry_submit');
    assert.equal(log[0].result, json.requestId);
    assert.match(log[0].ip_hash, /^[0-9a-f]{16}$/);

    assert.equal(sentLog.length, 2, 'Katie\'s notification, then the guest\'s confirmation');
    const [katie, guest] = sentLog;
    assert.deepEqual(guest.to, ['ana.guest@example.com']);
    assert.equal(guest.subject, 'Your Spanish Offseason request is in');
    assert.match(guest.html, /I&#39;m so excited your request came in!/); assert.match(guest.text, /\nBesos!\nKatie\n/);
    assert.match(guest.html, /Feb 7–13, 2027/);
    assert.match(guest.html, /hero-1200x600\.jpg/);
    assert.match(guest.text, /Reference: CS-/);
    assert.deepEqual(katie.to, ['notify@example.com'], 'the log-mode fallback when NOTIFY_EMAILS is unset');
    assert.equal(katie.subject, `New request ${json.requestId} · Private group · Feb 7–13`);
    for (const line of ['Type: Private group', 'Name: Ana Guest', 'Email: ana.guest@example.com', 'Invite code: none (public trip page)', brief, 'Sheet: https://docs.google.com/spreadsheets/d/abc']) {
      assert.ok(katie.text.includes(line), line);
    }
  });

  test('"Not sure yet" (blank players and partners) writes "" and the brief says Not sure yet; numbers are accepted too', async () => {
    await expectJson(await post(groupBody({ players: '', partners: '' })), 200);
    await expectJson(await post(groupBody({ email: 'two@example.com', players: 12, partners: 0 })), 200);
    const [blank, numbers] = readMock().requests;
    assert.equal(blank.players, '');
    assert.equal(blank.partners, '');
    assert.ok(blank.brief.includes('\nPlayers: Not sure yet\nPartners: Not sure yet\n'));
    assert.equal(numbers.players, 12);
    assert.equal(numbers.partners, 0);
    assert.ok(numbers.brief.includes('\nPlayers: 12\nPartners: 0\n'));
    assert.equal(NOT_SURE, 'Not sure yet');
  });

  test('"flexible" writes Flexible as the weeks and is accepted while a week is closed', async () => {
    await editMock((d) => { d.weeks[1].status = 'closed'; });
    const json = await expectJson(await post(groupBody({ weeks: ['flexible'] })), 200);
    assert.match(json.requestId, ID);
    const [row] = readMock().requests;
    assert.equal(row.weeks, 'Flexible');
    assert.equal(FLEXIBLE_WEEKS, 'Flexible');
    assert.equal(INQUIRY_FLEXIBLE, 'flexible');
    assert.ok(row.brief.includes('\nWeeks: Flexible\n'));
    assert.equal(sentLog[0].subject, `New request ${json.requestId} · Private group · Flexible`);
  });

  test('match-path fields in a group body are ignored, never written', async () => {
    await expectJson(await post(groupBody({ party: 'bogus', level: 'bogus' })), 200);
    const [row] = readMock().requests;
    assert.equal(row.party_type, '');
    assert.equal(row.level, '');
  });

  test('NOTIFY_EMAILS may hold several addresses', async () => {
    process.env.NOTIFY_EMAILS = 'katie@example.com, kc@example.com';
    await expectJson(await post(groupBody()), 200);
    assert.deepEqual(sentLog[0].to, ['katie@example.com', 'kc@example.com']);
  });
});

describe('a valid match request', () => {
  test('200; the 29-column row with the exact Concept 02 mapping (vetted, party and level, several week labels)', async () => {
    const json = await expectJson(await post(matchBody()), 200);
    const [row] = readMock().requests;
    const brief = [
      'TRIP REQUEST · Group match',
      'Trip: The Spanish Offseason (Spain with Katie + Eva)',
      'Weeks: Jan 17–23, Jan 24–30',
      'Players: —',
      'Partners: —',
      'Party: Couple',
      'Tennis level: 4.0',
      'Tennis rhythm: Four mornings',
      'Name: Sam Match',
      'Email: sam@example.com',
      'Notes: —',
      'Shown price: From $2,995 / player',
      'Submitted from: courtsidetravel.co trip request',
    ].join('\n');
    assert.deepEqual({ ...row, submitted_at: 'ISO' }, {
      request_id: json.requestId,
      submitted_at: 'ISO',
      trip_id: 'spain',
      request_type: 'vetted',
      weeks: 'Jan 17–23, Jan 24–30',
      guest_name: 'Sam Match',
      guest_email: 'sam@example.com',
      guest_mobile: '',
      players: '',
      partners: '',
      room: '',
      single_rooms: '',
      tennis: 'Four mornings',
      addons: '',
      party_type: 'Couple',
      level: '4.0',
      tennis_style: '',
      travel_style: '',
      priorities: '',
      note: '',
      player_estimate: '',
      partner_estimate: '',
      group_estimate: '',
      brief,
      invite_code: '',
      invited_by: '',
      status: 'New',
      owner: '',
      internal_notes: '',
    });
    assert.equal(sentLog[0].subject, `New request ${json.requestId} · Group match · Jan 17–23, Jan 24–30`);
    assert.ok(sentLog[0].text.includes('Type: Group match'));
  });

  test('a blank level ("Not sure yet") writes "" and the brief says Not sure yet; group fields are ignored', async () => {
    await expectJson(await post(matchBody({ level: '', players: '99', partners: '99' })), 200);
    const [row] = readMock().requests;
    assert.equal(row.level, '');
    assert.equal(row.players, '');
    assert.equal(row.partners, '');
    assert.ok(row.brief.includes('\nTennis level: Not sure yet\n'));
  });

  test('week labels follow the lineup, in the order the guest chose them', async () => {
    await editMock((d) => { d.weeks[0].label = 'Jan 10–16 (opening week)'; });
    await expectJson(await post(matchBody({ weeks: ['w7', 'w1'] })), 200);
    assert.equal(readMock().requests[0].weeks, 'Feb 21–27, Jan 10–16 (opening week)');
  });
});

describe('invite columns', () => {
  test('a valid cs_session cookie fills invite_code and invited_by; a bad or missing cookie leaves them blank', async () => {
    const cookie = await loginCookie('GUEST1');
    const json = await expectJson(await post(groupBody(), { cookie }), 200);
    const withCookie = readMock().requests.find((r) => r.request_id === json.requestId);
    assert.equal(withCookie.invite_code, 'GUEST1');
    assert.equal(withCookie.invited_by, 'Katie');
    assert.equal(withCookie.guest_name, 'Ana Guest', 'identity still comes from the form, not the invite row');
    assert.ok(sentLog.at(-2).text.includes('Invite code: GUEST1 (invited by Katie)'), 'the team notification (the guest confirmation follows it)');

    const garbage = await expectJson(await post(groupBody({ email: 'two@example.com' }), { cookie: 'cs_session=abc.def' }), 200);
    const bad = readMock().requests.find((r) => r.request_id === garbage.requestId);
    assert.equal(bad.invite_code, '');
    assert.equal(bad.invited_by, '');

    const none = await expectJson(await post(groupBody({ email: 'three@example.com' })), 200);
    const blank = readMock().requests.find((r) => r.request_id === none.requestId);
    assert.equal(blank.invite_code, '');
    assert.equal(blank.invited_by, '');
  });

  test('the shared COURTSIDE code (no invited_by surprises) and a paused code after sign-in both still fill from the cookie', async () => {
    const cookie = await loginCookie('COURTSIDE');
    await expectJson(await post(groupBody(), { cookie }), 200);
    assert.deepEqual([readMock().requests[0].invite_code, readMock().requests[0].invited_by], ['COURTSIDE', 'Katie']);
  });
});

describe('validation (400 with complete-sentence messages; nothing written)', () => {
  test('the allowed values are the Concept 02 strings', () => {
    assert.deepEqual([...INQUIRY_PATHS], ['group', 'match']);
    assert.deepEqual([...INQUIRY_TENNIS], ['Help us decide', 'A few relaxed mornings', 'Four mornings', 'Daily tennis', 'As much as possible']);
    assert.deepEqual([...INQUIRY_PARTIES], ['Solo', 'Couple', '2–3 friends']);
    assert.deepEqual([...INQUIRY_LEVELS], ['2.5', '3.0', '3.5', '4.0', '4.5', '5.0+']);
    assert.deepEqual(INQUIRY_RANGES, { players: { min: 4, max: 12 }, partners: { min: 0, max: 6 } });
    assert.deepEqual(INQUIRY_LIMITS, { name: 120, email: 254, notes: 2000, weekId: 40 });
    assert.deepEqual(REQUEST_TYPE_BY_PATH, { group: 'private', match: 'vetted' });
    assert.deepEqual(PATH_LABEL, { group: 'Private group', match: 'Group match' });
  });

  test('path must be group or match', async () => {
    for (const bad of [undefined, '', 'private', 'vetted', 'Group', 1, ['group']]) {
      const body = groupBody();
      if (bad === undefined) delete body.path; else body.path = bad;
      assert.equal((await errorsOf(body)).path, 'Choose a private group or a group match request.', JSON.stringify(bad));
    }
    nothingWritten();
  });

  test('weeks: a non-empty list of distinct ids, or exactly ["flexible"]', async () => {
    for (const bad of [undefined, [], 'w5', null]) {
      const body = groupBody();
      if (bad === undefined) delete body.weeks; else body.weeks = bad;
      assert.equal((await errorsOf(body)).weeks, 'Choose a week, or tell us you’re flexible.', JSON.stringify(bad));
    }
    for (const bad of [[''], [5], [{ id: 'w5' }], ['Flexible'], ['FLEXIBLE'], ['flexible', 'w5'], ['w5', 'flexible'], ['x'.repeat(41)], ['w9'], ['w5', 'nope']]) {
      assert.equal((await errorsOf(groupBody({ weeks: bad }))).weeks, 'Choose a week from the list.', JSON.stringify(bad));
    }
    assert.equal((await errorsOf(matchBody({ weeks: ['w2', 'w2'] }))).weeks, 'Each week can be chosen once.');
    nothingWritten();
    // Unknown ids are refused against the live lineup, so a week added to the Sheet is accepted right away.
    await editMock((d) => {
      d.weeks.push({ week_id: 'w8', trip_id: 'spain', label: 'Feb 28–Mar 6', start_date: '2027-02-28', end_date: '2027-03-06', status: 'open', closed_message: '' });
    });
    await expectJson(await post(matchBody({ weeks: ['w8'] })), 200);
    assert.equal(readMock().requests[0].weeks, 'Feb 28–Mar 6');
    // A week id that belongs to another trip is not in the lineup.
    await editMock((d) => {
      d.weeks.push({ week_id: 'm1', trip_id: 'mallorca', label: 'Jun 6–12', start_date: '2027-06-06', end_date: '2027-06-12', status: 'open', closed_message: '' });
    });
    assert.equal((await errorsOf(matchBody({ weeks: ['m1'] }))).weeks, 'Choose a week from the list.');
  });

  test('group: players and partners must be present, "" or integers in range (4–12, 0–6)', async () => {
    for (const bad of [undefined, '3', '13', 3, 13, 'six', 'Not sure yet', '6.5', ['6'], { n: 6 }]) {
      const body = groupBody();
      if (bad === undefined) delete body.players; else body.players = bad;
      assert.equal((await errorsOf(body)).players, 'Players must be a number between 4 and 12.', JSON.stringify(bad));
    }
    for (const bad of [undefined, '-1', '7', 7, 'two', 'Not sure yet', ['0']]) {
      const body = groupBody();
      if (bad === undefined) delete body.partners; else body.partners = bad;
      assert.equal((await errorsOf(body)).partners, 'Partners must be a number between 0 and 6.', JSON.stringify(bad));
    }
    nothingWritten();
    for (const [i, [players, partners]] of [['4', '0'], ['12', '6'], [' 8 ', ' 3 '], ['', '']].entries()) {
      resetRateLimit();
      await expectJson(await post(groupBody({ players, partners, email: `guest${i}@example.com` })), 200);
    }
    assert.deepEqual(readMock().requests.map((r) => [r.players, r.partners]), [[4, 0], [12, 6], [8, 3], ['', '']]);
  });

  test('match: party must be one of three; level one of six or ""', async () => {
    for (const bad of [undefined, '', 'Family', 'solo', '2-3 friends', 1, ['Solo']]) {
      const body = matchBody();
      if (bad === undefined) delete body.party; else body.party = bad;
      assert.equal((await errorsOf(body)).party, 'Choose who you are coming as.', JSON.stringify(bad));
    }
    for (const bad of ['Mixed / not sure', 'Not sure yet', '4', '5.0', 4, ['4.0']]) {
      assert.equal((await errorsOf(matchBody({ level: bad }))).level, 'Choose a tennis level from the list.', JSON.stringify(bad));
    }
    nothingWritten();
    const body = matchBody();
    delete body.level;
    await expectJson(await post(body), 200);
    assert.equal(readMock().requests[0].level, '', 'a missing level counts as ""');
  });

  test('tennis must be one of the five rhythms, on both paths', async () => {
    for (const bad of [undefined, '', '2–3 mornings', 'daily', 'Daily Tennis', 'core', 1]) {
      const body = groupBody();
      if (bad === undefined) delete body.tennis; else body.tennis = bad;
      assert.equal((await errorsOf(body)).tennis, 'Choose a tennis rhythm from the list.', JSON.stringify(bad));
      assert.equal((await errorsOf(matchBody({ tennis: bad ?? '' }))).tennis, 'Choose a tennis rhythm from the list.', JSON.stringify(bad));
    }
    nothingWritten();
    for (const tennis of INQUIRY_TENNIS) {
      resetRateLimit();
      await expectJson(await post(groupBody({ tennis, email: `${tennis.replace(/\W/g, '')}@example.com` })), 200);
    }
    assert.deepEqual(readMock().requests.map((r) => r.tennis), [...INQUIRY_TENNIS]);
  });

  test('name: required, text, at most 120 characters, trimmed', async () => {
    for (const bad of [undefined, '', '   ']) {
      const body = groupBody();
      if (bad === undefined) delete body.name; else body.name = bad;
      assert.equal((await errorsOf(body)).name, 'Enter your name.', JSON.stringify(bad));
    }
    assert.equal((await errorsOf(groupBody({ name: 'x'.repeat(121) }))).name, 'Keep your name under 120 characters.');
    assert.equal((await errorsOf(groupBody({ name: { first: 'Ana' } }))).name, 'Enter your name as text.');
    nothingWritten();
    await expectJson(await post(groupBody({ name: `  ${'x'.repeat(120)}  ` })), 200);
    assert.equal(readMock().requests[0].guest_name.length, 120);
  });

  test('email: required, shaped local@domain.tld, at most 254 characters, lower-cased', async () => {
    for (const bad of [undefined, '', 'ana', 'ana@', '@example.com', 'ana@example', 'ana@example.c', 'ana guest@example.com', 'ana@@example.com', { email: 'x' }]) {
      const body = groupBody();
      if (bad === undefined) delete body.email; else body.email = bad;
      assert.equal((await errorsOf(body)).email, 'Enter a valid email address.', JSON.stringify(bad));
    }
    assert.equal((await errorsOf(groupBody({ email: `${'a'.repeat(250)}@example.com` }))).email, 'That email address is too long.');
    nothingWritten();
    const exactly254 = `${'a'.repeat(254 - '@example.com'.length)}@example.com`;
    await expectJson(await post(groupBody({ email: `  ${exactly254.toUpperCase()}  ` })), 200);
    assert.equal(readMock().requests[0].guest_email, exactly254);
  });

  test('notes: optional, text, at most 2,000 characters', async () => {
    assert.equal((await errorsOf(groupBody({ notes: 'x'.repeat(2001) }))).notes, 'Keep notes under 2,000 characters.');
    assert.equal((await errorsOf(groupBody({ notes: ['x'] }))).notes, 'Notes must be text.');
    nothingWritten();
    const body = groupBody();
    delete body.notes;
    await expectJson(await post(body), 200);
    await expectJson(await post(groupBody({ email: 'two@example.com', notes: 'x'.repeat(2000) })), 200);
    const [missing, long] = readMock().requests;
    assert.equal(missing.note, '');
    assert.ok(missing.brief.includes('\nNotes: —\n'));
    assert.equal(long.note.length, 2000);
  });

  test('consent must be the boolean true', async () => {
    for (const bad of [undefined, false, 'true', 'yes', 1, 'on', null]) {
      const body = groupBody();
      if (bad === undefined) delete body.consent; else body.consent = bad;
      assert.equal((await errorsOf(body)).consent, 'Please tick the box so Courtside can keep these details to prepare a proposal.', JSON.stringify(bad));
    }
    nothingWritten();
  });

  test('every failing field is reported at once, each a complete sentence; unknown fields are ignored', async () => {
    const errors = await errorsOf({ path: 'group', weeks: [], players: '1', partners: '9', tennis: 'x', name: '', email: 'nope', notes: ['x'], consent: 'yes', website: '', extra: 1 });
    assert.deepEqual(Object.keys(errors).sort(), ['consent', 'email', 'name', 'notes', 'partners', 'players', 'tennis', 'weeks']);
    for (const message of Object.values(errors)) assert.match(message, /^[A-Z].*\.$/, `complete sentence: ${message}`);
    const matchErrors = await errorsOf({ path: 'match', weeks: ['w1'], tennis: 'Daily tennis', name: 'A', email: 'a@example.com', consent: true });
    assert.deepEqual(Object.keys(matchErrors), ['party']);
    nothingWritten();
    await expectJson(await post(groupBody({ extra: 'ignored', requestType: 'vetted', brief: 'ignored' })), 200);
    assert.equal(readMock().requests[0].request_type, 'private');
  });

  test('validateInquiry returns the trimmed, coerced value', () => {
    const result = validateInquiry(groupBody({ players: ' 6 ', partners: '' }));
    assert.equal(result.ok, true);
    assert.deepEqual(result.value, {
      path: 'group', weeks: ['w5'], flexible: false, players: 6, partners: '', party: '', level: '', tennis: 'Daily tennis',
      name: 'Ana Guest', email: 'ana.guest@example.com', notes: 'Celebrating a birthday that week.', consent: true,
    });
    const flexible = validateInquiry(matchBody({ weeks: ['flexible'] }));
    assert.deepEqual([flexible.value.weeks, flexible.value.flexible, flexible.value.party, flexible.value.level], [['flexible'], true, 'Couple', '4.0']);
    for (const bad of [null, undefined, 'x', 5, [], true]) assert.equal(validateInquiry(bad).errors.body, 'Send the request as a JSON object.');
  });

  test('a body that is not JSON, or not a JSON object, is a 400 with a body error', async () => {
    assert.deepEqual(await expectJson(await post('{oops'), 400), { ok: false, errors: { body: 'Send the request as JSON.' } });
    const empty = await expectJson(await POST(new Request('http://localhost:3000/api/inquiry', { method: 'POST' })), 400);
    assert.deepEqual(empty, { ok: false, errors: { body: 'Send the request as JSON.' } });
    for (const bad of ['"text"', '[1,2]', '5', 'null', 'true']) {
      assert.deepEqual(await expectJson(await post(bad), 400), { ok: false, errors: { body: 'Send the request as a JSON object.' } }, bad);
    }
    nothingWritten();
  });
});

describe('honeypot', () => {
  test('a filled website field returns 200 with a fake requestId and writes nothing, before validation runs', async () => {
    const json = await expectJson(await post(groupBody({ website: 'http://spam.example' })), 200);
    assert.deepEqual(Object.keys(json), ['ok', 'requestId']);
    assert.equal(json.ok, true);
    assert.match(json.requestId, ID);
    const bot = await expectJson(await post(groupBody({ website: 'x', email: 'not-an-email', consent: false, weeks: [] })), 200);
    assert.match(bot.requestId, ID, 'no 400 for a bot');
    assert.notEqual(bot.requestId, json.requestId);
    assert.equal((await expectJson(await post(groupBody({ website: 5 })), 200)).ok, true);
    nothingWritten();
  });

  test('a missing or blank website field is fine', async () => {
    const body = groupBody();
    delete body.website;
    await expectJson(await post(body), 200);
    await expectJson(await post(groupBody({ email: 'two@example.com', website: '   ' })), 200);
    assert.equal(readMock().requests.length, 2);
  });
});

describe('rate limit (bucket "request", 5 per 10 minutes per IP hash, shared with /api/request)', () => {
  test('the sixth post from one IP is 429 rate_limited; honeypot hits and invalid posts count; another IP is unaffected', async () => {
    assert.equal(RATE_LIMIT_BUCKET, 'request');
    assert.deepEqual(LIMITS.request, { limit: 5, windowMs: 600_000 });
    const h = { 'x-forwarded-for': '198.51.100.50' };
    const statuses = [];
    for (let i = 0; i < 5; i += 1) statuses.push((await post(groupBody({ email: `guest${i}@example.com` }), h)).status);
    assert.deepEqual(statuses, [200, 200, 200, 200, 200]);
    const sixth = await expectJson(await post(groupBody({ email: 'guest6@example.com' }), h), 429);
    assert.deepEqual(sixth, { ok: false, reason: 'rate_limited' });
    assert.equal(readMock().requests.length, 5, 'the sixth wrote nothing');
    assert.equal(readMock().log.filter((l) => l.code === LOG_CODE).length, 5, 'a 429 is not logged');
    assert.equal(sentLog.length, 10, 'two emails per accepted request');

    assert.equal((await post(groupBody({ email: 'other@example.com' }), { 'x-forwarded-for': '198.51.100.51' })).status, 200);

    resetRateLimit();
    const h2 = { 'x-forwarded-for': '198.51.100.52' };
    for (let i = 0; i < 3; i += 1) assert.equal((await post(groupBody({ website: 'spam' }), h2)).status, 200, 'honeypot hits look like success');
    for (let i = 0; i < 2; i += 1) assert.equal((await post(groupBody({ email: 'bad' }), h2)).status, 400);
    assert.equal((await post(groupBody({ email: 'fine@example.com' }), h2)).status, 429, 'five attempts of any kind use up the window');
  });
});

describe('open / closed (status read fresh on every call, never from the /api/lineup cache)', () => {
  test('trip closed → 409 trip_closed with the Sheet\'s closed_message (or the default); nothing written', async () => {
    // Warm the /api/lineup cache first, to prove the inquiry route does not use it.
    const { GET } = await import('../api/lineup.js');
    await GET(new Request('http://localhost:3000/api/lineup'));
    await editMock((d) => { d.trips[0].status = 'closed'; });
    const json = await expectJson(await post(groupBody()), 409);
    assert.deepEqual(json, { ok: false, reason: 'trip_closed', message: 'Requests for The Spanish Offseason are closed.' });
    assert.deepEqual(await expectJson(await post(groupBody({ weeks: ['flexible'] })), 409), json, 'flexible does not help when the trip is closed');

    await editMock((d) => { d.trips[0].closed_message = ''; });
    assert.equal((await expectJson(await post(matchBody()), 409)).message, TRIP_CLOSED_MESSAGE);
    assert.equal(TRIP_CLOSED_MESSAGE, 'Requests for The Spanish Offseason are closed.');

    await editMock((d) => { d.trips[0].status = 'open'; d.trips[0].trip_id = 'mallorca'; });
    assert.equal((await expectJson(await post(matchBody()), 409)).reason, 'trip_closed', 'a missing spain row counts as closed');
    nothingWritten();
  });

  test('a chosen week closed → 409 week_closed with the closed ids and a message; the other weeks still work', async () => {
    await editMock((d) => { d.weeks[1].status = 'closed'; d.weeks[1].closed_message = 'Jan 17–23 is full.'; d.weeks[2].status = 'closed'; });
    const one = await expectJson(await post(matchBody({ weeks: ['w1', 'w2'] })), 409);
    assert.deepEqual(one, { ok: false, reason: 'week_closed', weeks: ['w2'], message: 'Jan 17–23 is full.' });
    const two = await expectJson(await post(matchBody({ weeks: ['w3', 'w2', 'w4'] })), 409);
    assert.deepEqual(two, { ok: false, reason: 'week_closed', weeks: ['w3', 'w2'], message: 'Requests for Jan 24–30 and Jan 17–23 are closed.' });
    await editMock((d) => { d.weeks[2].closed_message = ''; });
    const blank = await expectJson(await post(matchBody({ weeks: ['w3'] })), 409);
    assert.equal(blank.message, 'Requests for Jan 24–30 are closed.', 'a blank closed_message gets a default naming the week');
    nothingWritten();

    await expectJson(await post(matchBody({ weeks: ['w1', 'w4'] })), 200);
    await expectJson(await post(groupBody({ weeks: ['flexible'] })), 200);
    assert.equal(readMock().requests.length, 2);
  });

  test('every week closed → flexible is 409 trip_closed too', async () => {
    await editMock((d) => { d.weeks.forEach((w) => { w.status = 'closed'; }); });
    const json = await expectJson(await post(groupBody({ weeks: ['flexible'] })), 409);
    assert.deepEqual(json, { ok: false, reason: 'trip_closed', message: 'Requests for The Spanish Offseason are closed.' });
    assert.equal((await expectJson(await post(groupBody()), 409)).reason, 'week_closed', 'a named week still says which');
    nothingWritten();
  });

  test('weekClosedMessage lists one, two or more weeks', () => {
    const w = (weekId, label, closedMessage = '') => ({ weekId, label, closedMessage });
    assert.equal(weekClosedMessage([w('w2', 'Jan 17–23', 'Full.')]), 'Full.');
    assert.equal(weekClosedMessage([w('w2', 'Jan 17–23')]), 'Requests for Jan 17–23 are closed.');
    assert.equal(weekClosedMessage([w('w2', '')]), 'Requests for w2 are closed.');
    assert.equal(weekClosedMessage([w('w2', 'Jan 17–23', 'Full.'), w('w3', 'Jan 24–30')]), 'Requests for Jan 17–23 and Jan 24–30 are closed.');
    assert.equal(weekClosedMessage([w('w1', 'A'), w('w2', 'B'), w('w3', 'C')]), 'Requests for A, B and C are closed.');
  });
});

describe('double submit (same email + weeks within 60 seconds)', () => {
  test('returns the first response again and writes once; different weeks or a different email is a new row', async () => {
    assert.equal(DOUBLE_SUBMIT_TTL_MS, 60_000);
    const first = await expectJson(await post(groupBody()), 200);
    const again = await expectJson(await post(groupBody({ notes: 'edited' })), 200);
    assert.deepEqual(again, first, 'the first requestId again');
    const upper = await expectJson(await post(groupBody({ email: '  ANA.GUEST@example.com ' })), 200);
    assert.deepEqual(upper, first, 'the key is the normalised email, from any IP');
    let data = readMock();
    assert.equal(data.requests.length, 1);
    assert.equal(data.log.filter((l) => l.code === LOG_CODE).length, 1);
    assert.equal(data.groups.length, 1, 'one group for the repeated submit');
    assert.equal(sentLog.length, 2, 'one notification + one confirmation for the repeated submit');

    const other = await expectJson(await post(groupBody({ weeks: ['w6'] })), 200);
    assert.notEqual(other.requestId, first.requestId);
    const friend = await expectJson(await post(groupBody({ email: 'friend@example.com' })), 200);
    assert.notEqual(friend.requestId, first.requestId);
    data = readMock();
    assert.deepEqual(data.requests.map((r) => [r.guest_email, r.weeks]), [
      ['ana.guest@example.com', 'Feb 7–13'], ['ana.guest@example.com', 'Feb 14–20'], ['friend@example.com', 'Feb 7–13'],
    ]);
    assert.equal(data.log.filter((l) => l.code === LOG_CODE).length, 3);
  });

  test('concurrent identical posts share one write; _resetDoubleSubmit allows the row again', async () => {
    const results = await Promise.all([0, 1, 2].map(() => post(matchBody())));
    const ids = new Set();
    for (const res of results) ids.add((await expectJson(res, 200)).requestId);
    assert.equal(ids.size, 1);
    assert.equal(readMock().requests.length, 1);
    _resetDoubleSubmit();
    const next = await expectJson(await post(matchBody()), 200);
    assert.equal(ids.has(next.requestId), false);
    assert.equal(readMock().requests.length, 2);
  });
});

describe('store failures', () => {
  test('a failing Requests write is 500 server_error and does not poison the double-submit guard', async () => {
    const errors = mock.method(console, 'error', () => {});
    try {
      const file = process.env.MOCK_DATA_PATH;
      process.env.MOCK_DATA_PATH = dir; // a directory: the mock store cannot read or write it
      const json = await expectJson(await post(groupBody()), 500);
      assert.deepEqual(json, { ok: false, reason: 'server_error' });
      assert.ok(errors.mock.callCount() >= 1, 'the failure is reported to the console');
      assert.equal(errors.mock.calls[0].arguments[0], '[api/inquiry]');
      assert.equal(sentLog.length, 0, 'no email for a failed write');

      process.env.MOCK_DATA_PATH = file; // the store is healthy again: the same submission must now succeed
      await expectJson(await post(groupBody()), 200);
      assert.equal(readMock().requests.length, 1);
    } finally {
      errors.mock.restore();
    }
  });
});

describe('pure helpers', () => {
  const weeksById = new Map([['w1', { weekId: 'w1', label: 'Jan 10–16' }], ['w5', { weekId: 'w5', label: 'Feb 7–13' }]]);

  test('formatWeeks joins lineup labels with ", " or says Flexible', () => {
    assert.equal(formatWeeks({ flexible: false, weeks: ['w5', 'w1'] }, weeksById), 'Feb 7–13, Jan 10–16');
    assert.equal(formatWeeks({ flexible: false, weeks: ['w9'] }, weeksById), 'w9', 'an id with no label falls back to the id');
    assert.equal(formatWeeks({ flexible: true, weeks: ['flexible'] }, weeksById), 'Flexible');
  });

  test('buildBrief follows the plan\'s line order; buildRow carries the constants', () => {
    const value = {
      path: 'match', weeks: ['w1'], flexible: false, players: '', partners: '', party: 'Solo', level: '', tennis: 'Help us decide',
      name: 'A', email: 'a@example.com', notes: '', consent: true,
    };
    const brief = buildBrief(value, 'Jan 10–16');
    assert.deepEqual(brief.split('\n').map((l) => l.split(':')[0]), [
      'TRIP REQUEST · Group match', 'Trip', 'Weeks', 'Players', 'Partners', 'Party', 'Tennis level', 'Tennis rhythm', 'Name', 'Email', 'Notes', 'Shown price', 'Submitted from',
    ]);
    assert.ok(brief.includes(`Trip: ${TRIP_LINE}`));
    assert.ok(brief.includes(`Shown price: ${SHOWN_PRICE}`));
    assert.ok(brief.endsWith(`Submitted from: ${SUBMITTED_FROM}`));
    assert.equal(TRIP_LINE, 'The Spanish Offseason (Spain with Katie + Eva)');
    assert.equal(SHOWN_PRICE, 'From $2,995 / player');
    assert.equal(SUBMITTED_FROM, 'courtsidetravel.co trip request');

    const now = new Date('2026-11-08T12:00:00.000Z');
    const row = buildRow({ id: 'CS-TEST0001', value, weeksById, session: { code: 'GUEST1', invitedBy: 'Katie', issuedTo: 'Ana', exp: 1 }, now });
    assert.equal(Object.keys(row).length, 29);
    assert.equal(row.submittedAt, '2026-11-08T12:00:00.000Z');
    assert.equal(row.tripId, 'spain');
    assert.equal(row.requestType, 'vetted');
    assert.equal(row.weeks, 'Jan 10–16');
    assert.equal(row.inviteCode, 'GUEST1');
    assert.equal(row.invitedBy, 'Katie');
    assert.equal(row.status, 'New');
    assert.equal(buildRow({ id: 'CS-TEST0002', value, weeksById, now }).inviteCode, '');
    assert.equal(buildRow({ id: 'CS-TEST0003', value, weeksById, session: { code: 'X', exp: 1 }, now }).invitedBy, '', 'a cookie without invitedBy writes ""');
  });
});
