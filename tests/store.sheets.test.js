// tests/store.sheets.test.js
// The Google Sheets store with a stubbed fetch and a stubbed token: no network, no credentials.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createSheetsStore } from '../lib/store.sheets.js';
import {
  createSheetsClient, normalizePrivateKey, columnLetter, cellRange, tabRange, valuesUrl,
  readConfig, missingEnv, SHEETS_API,
} from '../lib/store.sheets.client.js';
import { parseSheetValues, requestRowToValues, waitlistRowToValues, recordToValues, toInvite, TAB_HEADERS } from '../lib/store.columns.js';

const BASE = `${SHEETS_API}/SHEET123`;
const NOW = '2026-10-05T12:00:00.000Z';

// Invites tab as values.get returns it: all strings, trailing blanks dropped from short rows.
const INVITES = [
  [...TAB_HEADERS.Invites],
  ['COURTSIDE', 'Shared test code', '', '', 'Katie', '', '0', 'active', '2026-10-05T00:00:00Z', ''],
  ['GUEST1', 'Ana Guest', 'ana.guest@example.com', '+1 555 0100', 'Katie', '', '0', 'active', '2026-10-05T00:00:00Z', ''],
  ['PAUSED1', 'Paused test code', '', '', 'Katie', '', '0', 'paused', '2026-10-05T00:00:00Z', ''],
  ['ONCE1', 'Single-use test code', '', '', 'Katie', '1', '0', 'active', '2026-10-05T00:00:00Z'],
];

const TRIPS = [
  [...TAB_HEADERS.Trips],
  ['spain', 'The Spanish Offseason', 'open', 'Requests for The Spanish Offseason are closed.'],
];

const WEEKS = [
  [...TAB_HEADERS.Weeks],
  ['w1', 'spain', 'Jan 10–16', '2027-01-10', '2027-01-16', 'open', 'Requests for this week are closed.'],
  [],
  ['w2', 'spain', 'Jan 17–23', '2027-01-17', '2027-01-23', 'closed', 'Requests for this week are closed.'],
];

function stubFetch(responder) {
  const calls = [];
  async function fetch(url, init = {}) {
    const call = {
      url: decodeURIComponent(String(url)),
      method: init.method || 'GET',
      headers: init.headers || {},
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const reply = responder(call);
    if (reply instanceof Response) return reply;
    return new Response(JSON.stringify(reply === undefined ? {} : reply), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  return { fetch, calls };
}

function tabOf(call) {
  const m = call.url.match(/\/values\/'([^']+)'!/);
  return m ? m[1] : null;
}

function valuesFor(tab) {
  return {
    Invites: INVITES, Trips: TRIPS, Weeks: WEEKS, Requests: [[...TAB_HEADERS.Requests]], Log: [[...TAB_HEADERS.Log]], Waitlist: [[...TAB_HEADERS.Waitlist]],
  }[tab];
}

function defaultResponder(call) {
  if (call.method === 'GET' && tabOf(call)) return { range: tabOf(call), majorDimension: 'ROWS', values: valuesFor(tabOf(call)) };
  if (call.url.endsWith(':append')) return { updates: { updatedRows: 1 } };
  if (call.url.endsWith('/values:batchUpdate')) return { totalUpdatedCells: 2 };
  return {};
}

function makeStore(responder = defaultResponder, extra = {}) {
  const { fetch, calls } = stubFetch(responder);
  const store = createSheetsStore({ sheetId: 'SHEET123', fetch, getToken: async () => 'stub-token', now: () => NOW, ...extra });
  return { store, calls };
}

describe('pure helpers', () => {
  test('normalizePrivateKey converts literal \\n and strips wrapping quotes', () => {
    const raw = '"-----BEGIN PRIVATE KEY-----\\nMIIEvQ\\n-----END PRIVATE KEY-----\\n"';
    assert.equal(normalizePrivateKey(raw), '-----BEGIN PRIVATE KEY-----\nMIIEvQ\n-----END PRIVATE KEY-----\n');
    assert.equal(normalizePrivateKey('-----BEGIN\nreal\n-----END'), '-----BEGIN\nreal\n-----END');
    assert.equal(normalizePrivateKey(undefined), '');
  });

  test('columnLetter and cellRange', () => {
    assert.equal(columnLetter(0), 'A');
    assert.equal(columnLetter(6), 'G');
    assert.equal(columnLetter(9), 'J');
    assert.equal(columnLetter(25), 'Z');
    assert.equal(columnLetter(26), 'AA');
    assert.equal(columnLetter(28), 'AC');
    assert.equal(columnLetter(701), 'ZZ');
    assert.throws(() => columnLetter(-1), RangeError);
    assert.equal(cellRange('Invites', 6, 5), "'Invites'!G5");
    assert.equal(cellRange("Katie's", 0, 2), "'Katie''s'!A2");
    assert.equal(tabRange('Trips'), "'Trips'!A1:ZZ");
    assert.equal(tabRange('Log', 'A1'), "'Log'!A1");
  });

  test('valuesUrl builds the v4 values URL', () => {
    assert.equal(decodeURIComponent(valuesUrl('SHEET123', "'Trips'!A1:ZZ")), `${BASE}/values/'Trips'!A1:ZZ`);
    assert.equal(
      decodeURIComponent(valuesUrl('SHEET123', "'Log'!A1", { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' }, ':append')),
      `${BASE}/values/'Log'!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    );
  });

  test('missingEnv and readConfig name the missing variables', () => {
    assert.deepEqual(missingEnv({}), ['SHEET_ID', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY']);
    assert.deepEqual(missingEnv({ SHEET_ID: 'x', GOOGLE_SERVICE_ACCOUNT_EMAIL: ' ', GOOGLE_PRIVATE_KEY: 'k' }), ['GOOGLE_SERVICE_ACCOUNT_EMAIL']);
    assert.throws(() => readConfig({}), /missing SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY/);
    assert.deepEqual(
      readConfig({ SHEET_ID: ' id ', GOOGLE_SERVICE_ACCOUNT_EMAIL: 'sa@x.iam.gserviceaccount.com', GOOGLE_PRIVATE_KEY: 'a\\nb' }),
      { sheetId: 'id', email: 'sa@x.iam.gserviceaccount.com', privateKey: 'a\nb' },
    );
  });

  test('parseSheetValues maps the header row to objects with real row numbers', () => {
    const { headers, rows } = parseSheetValues(WEEKS);
    assert.deepEqual(headers, [...TAB_HEADERS.Weeks]);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.rowNumber), [2, 4]);
    assert.equal(rows[1].record.week_id, 'w2');
    assert.equal(rows[1].record.status, 'closed');
    const short = parseSheetValues([['a', 'b', 'c'], ['1']]);
    assert.deepEqual(short.rows[0].record, { a: '1', b: '', c: '' });
    assert.deepEqual(parseSheetValues([]), { headers: [], rows: [] });
    assert.deepEqual(parseSheetValues(undefined), { headers: [], rows: [] });
  });

  test('requestRowToValues follows the 4.2 column order with "" for missing keys', () => {
    const values = requestRowToValues({ requestId: 'CS-1', submittedAt: NOW, status: 'New', internalNotes: 'x', weeks: ['Jan 10–16', 'Feb 7–13'], players: 6 });
    assert.equal(values.length, 29);
    assert.equal(values[0], 'CS-1');
    assert.equal(values[1], NOW);
    assert.equal(values[4], 'Jan 10–16, Feb 7–13');
    assert.equal(values[8], 6);
    assert.equal(values[26], 'New');
    assert.equal(values[27], '');
    assert.equal(values[28], 'x');
    assert.deepEqual(requestRowToValues({}), new Array(29).fill(''));
    assert.deepEqual(recordToValues(TAB_HEADERS.Log, { time: NOW, code: 'X', result: 'ok', ipHash: 'h' }), [NOW, 'X', 'ok', 'h']);
  });

  test('waitlistRowToValues follows the Waitlist header order: timestamp, email, name, trip, source', () => {
    assert.deepEqual(TAB_HEADERS.Waitlist, ['timestamp', 'email', 'name', 'trip', 'source']);
    assert.deepEqual(
      waitlistRowToValues({ timestamp: NOW, email: 'ana.guest@example.com', name: 'Ana Guest', trip: 'Charleston', source: 'card' }),
      [NOW, 'ana.guest@example.com', 'Ana Guest', 'Charleston', 'card'],
    );
    assert.deepEqual(waitlistRowToValues({ email: 'x@example.com', trip: 'General', bogus: 1 }), ['', 'x@example.com', '', 'General', '']);
    assert.deepEqual(waitlistRowToValues({}), ['', '', '', '', '']);
  });

  test('toInvite: blank max_uses is null, numbers come through as numbers', () => {
    assert.equal(toInvite({ code: 'A', max_uses: '' }).maxUses, null);
    assert.equal(toInvite({ code: 'A', max_uses: '3' }).maxUses, 3);
    assert.equal(toInvite({ code: 'A', max_uses: 'lots' }).maxUses, null);
    assert.equal(toInvite({ code: 'A', uses: '7' }).uses, 7);
    assert.equal(toInvite({ code: 'A' }).uses, 0);
    assert.equal(toInvite({ code: ' a ', status: ' Active ' }).status, 'active');
  });
});

describe('createSheetsStore with a stubbed fetch', () => {
  test('findInvite reads Invites!A1:ZZ with a Bearer token and matches case-insensitively', async () => {
    const { store, calls } = makeStore();
    const invite = await store.findInvite(' guest1 ');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[0].url, `${BASE}/values/'Invites'!A1:ZZ`);
    assert.equal(calls[0].headers.Authorization, 'Bearer stub-token');
    assert.deepEqual(invite, {
      code: 'GUEST1', issuedTo: 'Ana Guest', guestEmail: 'ana.guest@example.com', guestMobile: '+1 555 0100',
      invitedBy: 'Katie', maxUses: null, uses: 0, status: 'active', createdAt: '2026-10-05T00:00:00Z', lastUsedAt: '',
    });
    const once = await store.findInvite('once1');
    assert.equal(once.maxUses, 1);
    assert.equal(once.lastUsedAt, '');
    assert.equal(await store.findInvite('NOPE'), null);
    assert.equal(await store.findInvite(''), null);
    assert.equal(calls.length, 3, 'a blank code makes no request');
  });

  test('recordInviteUse updates exactly the uses and last_used_at cells of the matching row', async () => {
    const { store, calls } = makeStore();
    const updated = await store.recordInviteUse('once1');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[1].method, 'POST');
    assert.equal(calls[1].url, `${BASE}/values:batchUpdate`);
    assert.deepEqual(calls[1].body, {
      valueInputOption: 'RAW',
      data: [
        { range: "'Invites'!G5", values: [[1]] },
        { range: "'Invites'!J5", values: [[NOW]] },
      ],
    });
    assert.equal(updated.code, 'ONCE1');
    assert.equal(updated.uses, 1);
    assert.equal(updated.lastUsedAt, NOW);
    assert.equal(updated.maxUses, 1);
  });

  test('recordInviteUse follows the header row, not fixed positions, and counts blank rows', async () => {
    const values = [
      ['last_used_at', 'code', 'uses'],
      [],
      ['', 'guest1', '4'],
    ];
    const { store, calls } = makeStore((call) => (call.method === 'GET' ? { values } : {}));
    const updated = await store.recordInviteUse('GUEST1');
    assert.deepEqual(calls[1].body.data, [
      { range: "'Invites'!C3", values: [[5]] },
      { range: "'Invites'!A3", values: [[NOW]] },
    ]);
    assert.equal(updated.uses, 5);
  });

  test('recordInviteUse returns null and writes nothing for an unknown code', async () => {
    const { store, calls } = makeStore();
    assert.equal(await store.recordInviteUse('NOPE'), null);
    assert.equal(calls.length, 1);
    assert.equal(await store.recordInviteUse(''), null);
    assert.equal(calls.length, 1);
  });

  test('recordInviteUse fails clearly when the Invites headers are missing', async () => {
    const { store } = makeStore((call) => (call.method === 'GET' ? { values: [['code'], ['GUEST1']] } : {}));
    await assert.rejects(store.recordInviteUse('GUEST1'), /setup-sheet/);
  });

  test('appendRequest appends one row in 4.2 order with RAW + INSERT_ROWS and returns the requestId', async () => {
    const { store, calls } = makeStore();
    const row = {
      requestId: 'CS-ABCDEFGH', submittedAt: NOW, tripId: 'spain', requestType: 'private', weeks: 'Feb 7–13',
      guestName: 'Ana Guest', guestEmail: 'ana.guest@example.com', guestMobile: '+1 555 0100',
      players: 6, partners: 2, room: 'club', singleRooms: 1, tennis: 'core',
      addons: 'Extra session with Eva ×6, Private 6-hour driver / excursion', note: 'n',
      playerEstimate: '$4,200–$4,600', partnerEstimate: '$2,100–$2,300', groupEstimate: '$29,400–$32,200',
      brief: 'b', inviteCode: 'GUEST1', invitedBy: 'Katie', status: 'New',
    };
    assert.deepEqual(await store.appendRequest(row), { requestId: 'CS-ABCDEFGH' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].url, `${BASE}/values/'Requests'!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`);
    assert.equal(calls[0].headers['Content-Type'], 'application/json');
    assert.deepEqual(calls[0].body, { values: [[
      'CS-ABCDEFGH', NOW, 'spain', 'private', 'Feb 7–13',
      'Ana Guest', 'ana.guest@example.com', '+1 555 0100',
      6, 2, 'club', 1, 'core', 'Extra session with Eva ×6, Private 6-hour driver / excursion',
      '', '', '', '', '',
      'n', '$4,200–$4,600', '$2,100–$2,300', '$29,400–$32,200', 'b',
      'GUEST1', 'Katie', 'New', '', '',
    ]] });
    await assert.rejects(store.appendRequest({ submittedAt: NOW }), /requestId/);
    assert.equal(calls.length, 1);
  });

  test('appendWaitlist appends one row in Waitlist header order with RAW + INSERT_ROWS and returns email + trip', async () => {
    const { store, calls } = makeStore();
    const row = { timestamp: NOW, email: 'ana.guest@example.com', name: 'Ana Guest', trip: 'Charleston', source: 'card' };
    assert.deepEqual(await store.appendWaitlist(row), { email: 'ana.guest@example.com', trip: 'Charleston' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].url, `${BASE}/values/'Waitlist'!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`);
    assert.equal(calls[0].headers['Content-Type'], 'application/json');
    assert.deepEqual(calls[0].body, { values: [[NOW, 'ana.guest@example.com', 'Ana Guest', 'Charleston', 'card']] });

    assert.deepEqual(await store.appendWaitlist({ timestamp: NOW, email: 'x@example.com', trip: 'General', source: 'footer' }), { email: 'x@example.com', trip: 'General' });
    assert.deepEqual(calls[1].body, { values: [[NOW, 'x@example.com', '', 'General', 'footer']] }, 'a missing name is written as ""');

    await assert.rejects(store.appendWaitlist({ timestamp: NOW, trip: 'General' }), /email/);
    assert.equal(calls.length, 2, 'nothing is written without an email');
  });

  test('logAttempt appends time, code, result, ip_hash to Log', async () => {
    const { store, calls } = makeStore();
    await store.logAttempt({ code: ' abc ', result: 'invalid', ipHash: 'deadbeefdeadbeef' });
    assert.equal(calls[0].url, `${BASE}/values/'Log'!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`);
    assert.deepEqual(calls[0].body, { values: [[NOW, 'abc', 'invalid', 'deadbeefdeadbeef']] });
  });

  test('listTrips and listWeeks map headers to camelCase in sheet order, skipping blank rows', async () => {
    const { store, calls } = makeStore();
    assert.deepEqual(await store.listTrips(), [{
      tripId: 'spain', name: 'The Spanish Offseason', status: 'open', closedMessage: 'Requests for The Spanish Offseason are closed.',
    }]);
    assert.equal(calls[0].url, `${BASE}/values/'Trips'!A1:ZZ`);
    const weeks = await store.listWeeks();
    assert.equal(calls[1].url, `${BASE}/values/'Weeks'!A1:ZZ`);
    assert.deepEqual(weeks, [
      { weekId: 'w1', tripId: 'spain', label: 'Jan 10–16', start: '2027-01-10', end: '2027-01-16', status: 'open', closedMessage: 'Requests for this week are closed.' },
      { weekId: 'w2', tripId: 'spain', label: 'Jan 17–23', start: '2027-01-17', end: '2027-01-23', status: 'closed', closedMessage: 'Requests for this week are closed.' },
    ]);
  });

  test('an empty tab (no values key) lists as []', async () => {
    const { store } = makeStore(() => ({ range: 'x', majorDimension: 'ROWS' }));
    assert.deepEqual(await store.listTrips(), []);
    assert.equal(await store.findInvite('GUEST1'), null);
  });

  test('a non-2xx response rejects with the status and Google message', async () => {
    const { store } = makeStore(() => new Response(JSON.stringify({ error: { code: 403, message: 'The caller does not have permission' } }), { status: 403 }));
    await assert.rejects(store.listTrips(), /failed with 403: The caller does not have permission/);
  });

  test('uses globalThis.fetch when no fetch is injected', async () => {
    const original = globalThis.fetch;
    const { fetch, calls } = stubFetch(defaultResponder);
    globalThis.fetch = fetch;
    try {
      const store = createSheetsStore({ sheetId: 'SHEET123', getToken: async () => 'tok' });
      assert.equal((await store.findInvite('COURTSIDE')).issuedTo, 'Shared test code');
      assert.equal(calls[0].headers.Authorization, 'Bearer tok');
    } finally {
      globalThis.fetch = original;
    }
  });

  test('createSheetsClient reads env lazily and fails clearly when it is missing', async () => {
    const client = createSheetsClient({ env: {} });
    await assert.rejects(client.getValues("'Trips'!A1:ZZ"), /missing SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY/);
    assert.throws(() => client.sheetId, /missing/);
  });
});
