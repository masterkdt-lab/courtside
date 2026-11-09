// tests/store.mock.test.js
// The JSON-file store. Every test gets its own file through MOCK_DATA_PATH.

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as mock from '../lib/store.mock.js';
import { TAB_HEADERS, snakeToCamel } from '../lib/store.columns.js';

const SEED = JSON.parse(fs.readFileSync(new URL('./fixtures/seed.json', import.meta.url), 'utf8'));
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const WEEK_LABELS = ['Jan 10–16', 'Jan 17–23', 'Jan 24–30', 'Jan 31–Feb 6', 'Feb 7–13', 'Feb 14–20', 'Feb 21–27'];

let dir;
let counter = 0;

before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'courtside-mock-')); });
after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
beforeEach(() => { process.env.MOCK_DATA_PATH = path.join(dir, `store-${++counter}.json`); });

const readFile = () => JSON.parse(fs.readFileSync(process.env.MOCK_DATA_PATH, 'utf8'));

test('seeds the data file from tests/fixtures/seed.json on first use', async () => {
  assert.equal(fs.existsSync(process.env.MOCK_DATA_PATH), false);
  const trips = await mock.listTrips();
  assert.equal(trips.length, 1);
  assert.equal(fs.existsSync(process.env.MOCK_DATA_PATH), true);
  const data = readFile();
  assert.deepEqual(Object.keys(data), ['trips', 'weeks', 'invites', 'requests', 'log', 'waitlist', 'host_applications']);
  assert.deepEqual(data.waitlist, []);
  assert.deepEqual(data.host_applications, []);
  assert.deepEqual(data, SEED);
  assert.equal(data.invites.length, 4);
  assert.deepEqual(data.invites.map((r) => r.code), ['COURTSIDE', 'GUEST1', 'PAUSED1', 'ONCE1']);
});

test('MOCK_DATA_PATH isolates state between files', async () => {
  await mock.logAttempt({ code: 'X', result: 'invalid', ipHash: 'a' });
  assert.equal(readFile().log.length, 1);
  process.env.MOCK_DATA_PATH = path.join(dir, `store-${++counter}.json`);
  await mock.listTrips();
  assert.equal(readFile().log.length, 0);
});

test('mockDataPath defaults to .data/mock.json in the repo when MOCK_DATA_PATH is unset', () => {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  assert.equal(mock.mockDataPath({}), path.join(repoRoot, '.data', 'mock.json'));
  assert.equal(mock.mockDataPath({ MOCK_DATA_PATH: '/tmp/x.json' }), '/tmp/x.json');
  assert.equal(mock.mockDataPath({ MOCK_DATA_PATH: '  ' }), path.join(repoRoot, '.data', 'mock.json'));
});

describe('findInvite', () => {
  test('matches case-insensitively and trimmed', async () => {
    const invite = await mock.findInvite('  guest1 ');
    assert.ok(invite);
    assert.equal(invite.code, 'GUEST1');
    assert.equal(invite.issuedTo, 'Ana Guest');
    assert.equal(invite.guestEmail, 'ana.guest@example.com');
    assert.equal(invite.guestMobile, '+1 555 0100');
    assert.equal(invite.invitedBy, 'Katie');
    assert.equal(invite.status, 'active');
    assert.deepEqual(await mock.findInvite('Guest1'), invite);
  });

  test('returns null for unknown, blank and missing codes', async () => {
    assert.equal(await mock.findInvite('NOPE'), null);
    assert.equal(await mock.findInvite(''), null);
    assert.equal(await mock.findInvite('   '), null);
    assert.equal(await mock.findInvite(undefined), null);
    assert.equal(await mock.findInvite(null), null);
  });

  test('maxUses is null when blank and a number otherwise; uses is a number', async () => {
    const shared = await mock.findInvite('COURTSIDE');
    assert.equal(shared.maxUses, null);
    assert.equal(shared.uses, 0);
    assert.equal(typeof shared.uses, 'number');
    assert.equal(shared.guestEmail, '');
    assert.equal(shared.guestMobile, '');
    assert.equal(shared.issuedTo, 'Shared test code');

    const once = await mock.findInvite('once1');
    assert.equal(once.maxUses, 1);
    assert.equal(once.uses, 0);

    const paused = await mock.findInvite('PAUSED1');
    assert.equal(paused.status, 'paused');
  });

  test('returns the 4.1 fields (plus createdAt and lastUsedAt)', async () => {
    const invite = await mock.findInvite('GUEST1');
    assert.deepEqual(Object.keys(invite), [
      'code', 'issuedTo', 'guestEmail', 'guestMobile', 'invitedBy', 'maxUses', 'uses', 'status', 'createdAt', 'lastUsedAt',
    ]);
    assert.equal(invite.createdAt, '2026-10-05T00:00:00Z');
    assert.equal(invite.lastUsedAt, '');
  });
});

describe('recordInviteUse', () => {
  test('increments uses and stamps last_used_at on that row only', async () => {
    const started = Date.now();
    const updated = await mock.recordInviteUse(' once1 ');
    assert.equal(updated.code, 'ONCE1');
    assert.equal(updated.uses, 1);
    assert.match(updated.lastUsedAt, ISO);
    assert.ok(Date.parse(updated.lastUsedAt) >= started - 1000);

    const again = await mock.findInvite('ONCE1');
    assert.equal(again.uses, 1);
    assert.equal(again.lastUsedAt, updated.lastUsedAt);

    const file = readFile();
    const row = file.invites.find((r) => r.code === 'ONCE1');
    assert.equal(row.uses, 1);
    assert.equal(row.last_used_at, updated.lastUsedAt);
    assert.equal(row.max_uses, 1);
    for (const other of file.invites.filter((r) => r.code !== 'ONCE1')) {
      assert.equal(other.uses, 0);
      assert.equal(other.last_used_at, '');
    }

    await mock.recordInviteUse('ONCE1');
    assert.equal((await mock.findInvite('ONCE1')).uses, 2);
  });

  test('returns null for an unknown code and writes nothing', async () => {
    assert.equal(await mock.recordInviteUse('NOPE'), null);
    assert.equal(await mock.recordInviteUse(''), null);
    assert.deepEqual(readFile().invites, SEED.invites);
  });
});

test('logAttempt appends a Log row with the 4.2 columns', async () => {
  await mock.logAttempt({ code: ' abc ', result: 'invalid', ipHash: 'deadbeefdeadbeef' });
  await mock.logAttempt({ code: 'GUEST1', result: 'ok', ipHash: 'deadbeefdeadbeef' });
  const { log } = readFile();
  assert.equal(log.length, 2);
  assert.deepEqual(Object.keys(log[0]), ['time', 'code', 'result', 'ip_hash']);
  assert.match(log[0].time, ISO);
  assert.equal(log[0].code, 'abc');
  assert.equal(log[0].result, 'invalid');
  assert.equal(log[0].ip_hash, 'deadbeefdeadbeef');
  assert.equal(log[1].code, 'GUEST1');
  assert.equal(log[1].result, 'ok');
});

describe('listTrips / listWeeks', () => {
  test('listTrips returns camelCase rows in sheet order', async () => {
    assert.deepEqual(await mock.listTrips(), [{
      tripId: 'spain',
      name: 'The Spanish Offseason',
      status: 'open',
      closedMessage: 'Requests for The Spanish Offseason are closed.',
    }]);
  });

  test('listWeeks returns the seven 2027 weeks in order, Sunday to Saturday', async () => {
    const weeks = await mock.listWeeks();
    assert.equal(weeks.length, 7);
    assert.deepEqual(weeks.map((w) => w.weekId), ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7']);
    assert.deepEqual(weeks.map((w) => w.label), WEEK_LABELS);
    assert.deepEqual(weeks[0], {
      weekId: 'w1', tripId: 'spain', label: 'Jan 10–16', start: '2027-01-10', end: '2027-01-16',
      status: 'open', closedMessage: 'Requests for this week are closed.',
    });
    assert.deepEqual(weeks[6], {
      weekId: 'w7', tripId: 'spain', label: 'Feb 21–27', start: '2027-02-21', end: '2027-02-27',
      status: 'open', closedMessage: 'Requests for this week are closed.',
    });
    for (const w of weeks) {
      assert.deepEqual(Object.keys(w), ['weekId', 'tripId', 'label', 'start', 'end', 'status', 'closedMessage']);
      assert.equal(new Date(`${w.start}T00:00:00Z`).getUTCDay(), 0, `${w.weekId} starts on a Sunday`);
      assert.equal(new Date(`${w.end}T00:00:00Z`).getUTCDay(), 6, `${w.weekId} ends on a Saturday`);
      assert.equal((Date.parse(w.end) - Date.parse(w.start)) / 86400000, 6);
    }
  });

  test('status edits in the file show up on the next read (no caching)', async () => {
    await mock.listWeeks();
    const data = readFile();
    data.weeks[4].status = 'closed';
    data.trips[0].status = 'closed';
    fs.writeFileSync(process.env.MOCK_DATA_PATH, JSON.stringify(data));
    assert.equal((await mock.listWeeks())[4].status, 'closed');
    assert.equal((await mock.listTrips())[0].status, 'closed');
  });
});

describe('appendRequest', () => {
  const privateRow = {
    requestId: 'CS-TEST0001',
    submittedAt: '2026-10-05T12:00:00.000Z',
    tripId: 'spain',
    requestType: 'private',
    weeks: 'Feb 7–13',
    guestName: 'Ana Guest',
    guestEmail: 'ana.guest@example.com',
    guestMobile: '+1 555 0100',
    players: 6,
    partners: 2,
    room: 'club',
    singleRooms: 1,
    tennis: 'core',
    addons: 'Extra session with Eva ×6, Private 6-hour driver / excursion',
    note: 'Two of us are lefties.',
    playerEstimate: '$4,200–$4,600',
    partnerEstimate: '$2,100–$2,300',
    groupEstimate: '$29,400–$32,200',
    brief: 'Private group, Feb 7–13 ...',
    inviteCode: 'GUEST1',
    invitedBy: 'Katie',
    status: 'New',
  };

  test('writes every Requests column in order, "" for missing keys, and returns the requestId', async () => {
    assert.deepEqual(await mock.appendRequest(privateRow), { requestId: 'CS-TEST0001' });
    const { requests } = readFile();
    assert.equal(requests.length, 1);
    const [saved] = requests;
    assert.deepEqual(Object.keys(saved), [...TAB_HEADERS.Requests]);
    assert.equal(Object.keys(saved).length, 29);
    for (const header of TAB_HEADERS.Requests) {
      const expected = privateRow[snakeToCamel(header)];
      assert.equal(saved[header], expected === undefined ? '' : expected, header);
    }
    assert.equal(saved.players, 6);
    assert.equal(saved.party_type, '');
    assert.equal(saved.priorities, '');
    assert.equal(saved.owner, '');
    assert.equal(saved.internal_notes, '');
  });

  test('joins arrays with ", ", stringifies numbers as numbers, ignores unknown keys', async () => {
    await mock.appendRequest({
      requestId: 'CS-TEST0002',
      submittedAt: '2026-10-05T12:01:00.000Z',
      requestType: 'vetted',
      weeks: ['Jan 10–16', 'Feb 7–13'],
      priorities: ['Great tennis', 'Golf'],
      players: null,
      bogus: 'ignored',
    });
    const [saved] = readFile().requests;
    assert.equal(saved.weeks, 'Jan 10–16, Feb 7–13');
    assert.equal(saved.priorities, 'Great tennis, Golf');
    assert.equal(saved.players, '');
    assert.equal('bogus' in saved, false);
  });

  test('appends in order', async () => {
    await mock.appendRequest({ ...privateRow, requestId: 'CS-A' });
    await mock.appendRequest({ ...privateRow, requestId: 'CS-B' });
    assert.deepEqual(readFile().requests.map((r) => r.request_id), ['CS-A', 'CS-B']);
  });

  test('requires requestId and writes nothing without it', async () => {
    await mock.listTrips();
    await assert.rejects(mock.appendRequest({ submittedAt: '2026-10-05T12:00:00.000Z' }), /requestId/);
    await assert.rejects(mock.appendRequest({ requestId: '   ' }), /requestId/);
    assert.equal(readFile().requests.length, 0);
  });
});

describe('appendWaitlist', () => {
  const row = { timestamp: '2026-10-22T12:00:00.000Z', email: 'ana.guest@example.com', name: 'Ana Guest', trip: 'Charleston', source: 'card' };

  test('writes the five Waitlist columns in order, "" for missing keys, and returns email + trip', async () => {
    assert.deepEqual(await mock.appendWaitlist(row), { email: 'ana.guest@example.com', trip: 'Charleston' });
    assert.deepEqual(await mock.appendWaitlist({ timestamp: '2026-10-22T12:01:00.000Z', email: 'b@example.com', trip: 'General', bogus: 'ignored' }), { email: 'b@example.com', trip: 'General' });
    const { waitlist } = readFile();
    assert.equal(waitlist.length, 2);
    assert.deepEqual(Object.keys(waitlist[0]), [...TAB_HEADERS.Waitlist]);
    assert.deepEqual(waitlist[0], { timestamp: '2026-10-22T12:00:00.000Z', email: 'ana.guest@example.com', name: 'Ana Guest', trip: 'Charleston', source: 'card' });
    assert.deepEqual(waitlist[1], { timestamp: '2026-10-22T12:01:00.000Z', email: 'b@example.com', name: '', trip: 'General', source: '' });
    assert.equal('bogus' in waitlist[1], false);
    assert.equal(readFile().requests.length, 0, 'Requests is untouched');
    assert.equal(readFile().log.length, 0, 'Log is untouched; the API route writes its own Log row');
  });

  test('requires email and writes nothing without it', async () => {
    await mock.listTrips();
    await assert.rejects(mock.appendWaitlist({ timestamp: row.timestamp, trip: 'General' }), /email/);
    await assert.rejects(mock.appendWaitlist({ ...row, email: '   ' }), /email/);
    assert.equal(readFile().waitlist.length, 0);
  });

  test('a mock file written before the Waitlist tab existed gains an empty waitlist section', async () => {
    const legacy = { ...SEED };
    delete legacy.waitlist;
    fs.writeFileSync(process.env.MOCK_DATA_PATH, JSON.stringify(legacy));
    assert.equal((await mock.listTrips()).length, 1);
    await mock.appendWaitlist(row);
    assert.deepEqual(readFile().waitlist.map((r) => r.email), ['ana.guest@example.com']);
  });
});

describe('appendHostApplication', () => {
  const row = {
    timestamp: '2026-11-08T12:00:00.000Z', name: 'Sam Pro', email: 'sam.pro@example.com', club: 'Club de Tenis, Alicante, Spain',
    referral: 'Katie', background: 'Twenty years of coaching.', community: 'A club of 200 members.', destination: 'Mallorca',
  };

  test('writes the eight HostApplications columns in order, "" for missing keys, and returns the email', async () => {
    assert.deepEqual(TAB_HEADERS.HostApplications, ['timestamp', 'name', 'email', 'club', 'referral', 'background', 'community', 'destination']);
    assert.deepEqual(await mock.appendHostApplication(row), { email: 'sam.pro@example.com' });
    assert.deepEqual(await mock.appendHostApplication({ timestamp: '2026-11-08T12:01:00.000Z', name: 'B', email: 'b@example.com', bogus: 'ignored' }), { email: 'b@example.com' });
    const { host_applications: rows } = readFile();
    assert.equal(rows.length, 2);
    assert.deepEqual(Object.keys(rows[0]), [...TAB_HEADERS.HostApplications]);
    assert.deepEqual(rows[0], row);
    assert.deepEqual(rows[1], {
      timestamp: '2026-11-08T12:01:00.000Z', name: 'B', email: 'b@example.com', club: '', referral: '', background: '', community: '', destination: '',
    });
    assert.equal('bogus' in rows[1], false);
    assert.equal(readFile().requests.length, 0, 'Requests is untouched');
    assert.equal(readFile().waitlist.length, 0, 'Waitlist is untouched');
    assert.equal(readFile().log.length, 0, 'Log is untouched; the API route writes its own Log row');
  });

  test('requires email and writes nothing without it', async () => {
    await mock.listTrips();
    await assert.rejects(mock.appendHostApplication({ timestamp: row.timestamp, name: 'Sam' }), /email/);
    await assert.rejects(mock.appendHostApplication({ ...row, email: '   ' }), /email/);
    assert.equal(readFile().host_applications.length, 0);
  });

  test('a mock file written before the HostApplications tab existed gains an empty host_applications section', async () => {
    const legacy = { ...SEED };
    delete legacy.host_applications;
    fs.writeFileSync(process.env.MOCK_DATA_PATH, JSON.stringify(legacy));
    assert.equal((await mock.listTrips()).length, 1);
    await mock.appendHostApplication(row);
    assert.deepEqual(readFile().host_applications.map((r) => r.email), ['sam.pro@example.com']);
    assert.deepEqual(readFile().waitlist, []);
  });
});

test('resetMockStore deletes the file so the next call reseeds', async () => {
  await mock.recordInviteUse('ONCE1');
  assert.equal((await mock.findInvite('ONCE1')).uses, 1);
  await mock.resetMockStore();
  assert.equal(fs.existsSync(process.env.MOCK_DATA_PATH), false);
  assert.equal((await mock.findInvite('ONCE1')).uses, 0);
  assert.deepEqual(mock.readMockData(), SEED);
});
