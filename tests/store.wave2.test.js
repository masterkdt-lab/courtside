// tests/store.wave2.test.js
// The Wave 2 store methods (CONCEPT02_WAVE2_PLAN.md section 6 "Store") in both backends, the row
// mappers, lib/settings.js (defaults and the 60-second cache) and lib/ids.js's new prefixes.

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as mock from '../lib/store.mock.js';
import * as store from '../lib/store.js';
import { createSheetsStore } from '../lib/store.sheets.js';
import { SHEETS_API } from '../lib/store.sheets.client.js';
import { TAB_HEADERS, applyPatch, toMember, toNumber, toProposal } from '../lib/store.columns.js';
import { SETTINGS_CACHE_TTL_MS, SETTINGS_DEFAULTS, _resetSettingsCache, getSettings, settingsFromRows } from '../lib/settings.js';
import { ID_SHAPE, conciergeId, groupId, memberId, paymentId, proposalId, requestId } from '../lib/ids.js';

const WAVE2_METHODS = [
  'getGroup', 'appendGroup', 'updateGroup', 'listMembers', 'getMember', 'appendMember', 'updateMember',
  'listConcierge', 'getConcierge', 'appendConcierge', 'updateConcierge', 'getProposalForMember', 'appendProposal', 'updateProposal',
  'listPayments', 'appendPayment', 'listSettings',
];

let dir;
let counter = 0;
before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'courtside-wave2-store-')); delete process.env.DATA_BACKEND; });
after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
beforeEach(() => { process.env.MOCK_DATA_PATH = path.join(dir, `store-${++counter}.json`); _resetSettingsCache(); });
const readFile = () => JSON.parse(fs.readFileSync(process.env.MOCK_DATA_PATH, 'utf8'));

test('every Wave 2 method exists on lib/store.js, the mock and the Sheets store', () => {
  const sheets = createSheetsStore({ sheetId: 'X', fetch: async () => new Response('{}'), getToken: async () => 't' });
  for (const name of WAVE2_METHODS) {
    assert.equal(typeof store[name], 'function', name);
    assert.equal(typeof mock[name], 'function', `mock.${name}`);
    assert.equal(typeof sheets[name], 'function', `sheets.${name}`);
  }
});

test('ids: CS- CSG- CSM- CSR- CSP- CSY- + 8 Crockford characters', () => {
  const cases = [[requestId, 'CS-'], [groupId, 'CSG-'], [memberId, 'CSM-'], [conciergeId, 'CSR-'], [proposalId, 'CSP-'], [paymentId, 'CSY-']];
  for (const [make, prefix] of cases) {
    const id = make();
    assert.ok(id.startsWith(prefix), id);
    assert.match(id.slice(prefix.length), /^[0-9A-HJKMNP-TV-Z]{8}$/);
    assert.match(id, ID_SHAPE);
  }
  assert.notEqual(groupId(), groupId());
});

describe('mappers', () => {
  test('flags become booleans, money and versions numbers, text is trimmed', () => {
    const m = toMember({ member_id: ' CSM-1 ', planning_complete: 'TRUE', removed: 'false' });
    assert.equal(m.memberId, 'CSM-1');
    assert.equal(m.planningComplete, true);
    assert.equal(m.removed, false);
    assert.equal(m.arrivalDate, '');
    assert.deepEqual(Object.keys(m).length, TAB_HEADERS.GroupMembers.length);
    const p = toProposal({ base_price: '2995', extras_total: '', version: '3', deposit_amount: 300 });
    assert.deepEqual([p.basePrice, p.extrasTotal, p.version, p.depositAmount], [2995, 0, 3, 300]);
    assert.deepEqual([toNumber('$1,250'), toNumber('tbd'), toNumber(''), toNumber(12.5)], [1250, 0, 0, 12.5]);
  });

  test('applyPatch changes only header keys, never the id, and stamps updated_at', () => {
    const record = { member_id: 'CSM-1', name: 'A', email: 'a@x.com', updated_at: 'old' };
    const out = applyPatch('GroupMembers', record, { name: 'B', memberId: 'CSM-HACK', bogus: 1, updatedAt: 'ignored', interests: ['Golf', 'Spa'] }, 'NOW');
    assert.equal(out.member_id, 'CSM-1');
    assert.equal(out.name, 'B');
    assert.equal(out.email, 'a@x.com');
    assert.equal(out.interests, 'Golf, Spa');
    assert.equal(out.updated_at, 'NOW');
    assert.equal('bogus' in out, false);
    assert.equal('updated_at' in applyPatch('Proposals', { proposal_id: 'P' }, { status: 'sent' }), false, 'Proposals has no updated_at');
  });
});

describe('mock store', () => {
  test('groups: append, get, update by id (only the patched keys + updated_at), unknown id → null', async () => {
    const g = await mock.appendGroup({ groupId: 'CSG-AAAAAAAA', name: 'Ana’s Spain group', players: 6, reviewNeeded: 'FALSE', updatedAt: 'T0' });
    assert.equal(g.groupId, 'CSG-AAAAAAAA');
    assert.equal(g.reviewNeeded, false);
    await mock.appendGroup({ groupId: 'CSG-BBBBBBBB', name: 'Other' });
    const raw = readFile().groups[0];
    assert.deepEqual(Object.keys(raw), [...TAB_HEADERS.Groups]);
    assert.equal(raw.players, 6, 'numbers stay numbers in the file');
    const u = await mock.updateGroup('CSG-AAAAAAAA', { name: 'Renamed', reviewNeeded: 'TRUE' });
    assert.equal(u.name, 'Renamed');
    assert.equal(u.reviewNeeded, true);
    assert.notEqual(u.updatedAt, 'T0');
    assert.equal(readFile().groups[1].name, 'Other', 'other rows untouched');
    assert.equal((await mock.getGroup(' CSG-AAAAAAAA ')).name, 'Renamed');
    assert.equal(await mock.getGroup('CSG-NOPE'), null);
    assert.equal(await mock.updateGroup('CSG-NOPE', { name: 'x' }), null);
    await assert.rejects(mock.appendGroup({ name: 'no id' }), /groupId/);
  });

  test('members: listMembers filters by group and includes removed rows', async () => {
    await mock.appendMember({ memberId: 'CSM-1', groupId: 'G1', name: 'A', removed: 'FALSE' });
    await mock.appendMember({ memberId: 'CSM-2', groupId: 'G1', name: 'B', removed: 'TRUE' });
    await mock.appendMember({ memberId: 'CSM-3', groupId: 'G2', name: 'C' });
    assert.deepEqual((await mock.listMembers('G1')).map((m) => [m.memberId, m.removed]), [['CSM-1', false], ['CSM-2', true]]);
    assert.deepEqual(await mock.listMembers(''), []);
    assert.equal((await mock.updateMember('CSM-3', { participation: 'Interested' })).participation, 'Interested');
    assert.equal((await mock.getMember('CSM-3')).name, 'C');
  });

  test('concierge, proposals, payments and settings', async () => {
    await mock.appendConcierge({ conciergeId: 'CSR-1', groupId: 'G1', memberId: 'CSM-1', cost: 150, status: 'Received' });
    assert.equal((await mock.listConcierge('G1'))[0].cost, 150);
    assert.equal((await mock.updateConcierge('CSR-1', { status: 'Approved' })).status, 'Approved');
    assert.equal((await mock.getConcierge('CSR-1')).status, 'Approved');

    assert.equal(await mock.getProposalForMember('CSM-1'), null);
    await mock.appendProposal({ proposalId: 'CSP-1', groupId: 'G1', memberId: 'CSM-1', basePrice: 2995, version: 1, status: 'draft' });
    const p = await mock.getProposalForMember('CSM-1');
    assert.deepEqual([p.proposalId, p.basePrice, p.version], ['CSP-1', 2995, 1]);
    assert.equal((await mock.updateProposal('CSP-1', { version: 2 })).version, 2);

    await mock.appendPayment({ paymentId: 'CSY-1', groupId: 'G1', memberId: 'CSM-1', amount: 300, status: 'pending' });
    assert.deepEqual((await mock.listPayments('G1')).map((x) => [x.paymentId, x.amount]), [['CSY-1', 300]]);
    assert.deepEqual(await mock.listPayments('G2'), []);

    assert.deepEqual((await mock.listSettings()).map((s) => s.key), ['deposit_per_person', 'deposit_per_group', 'balance_due_days_before', 'deposit_due_days', 'currency']);
  });

  test('a mock file written before Wave 2 gains the six empty sections', async () => {
    fs.writeFileSync(process.env.MOCK_DATA_PATH, JSON.stringify({ trips: [], weeks: [], invites: [] }));
    assert.deepEqual(await mock.listSettings(), []);
    for (const s of ['groups', 'group_members', 'concierge_requests', 'proposals', 'payments', 'settings']) assert.deepEqual(mock.readMockData()[s], [], s);
  });
});

describe('Sheets store', () => {
  const BASE = `${SHEETS_API}/SHEET123`;
  const NOW = '2026-11-08T12:00:00.000Z';
  const MEMBERS = [
    [...TAB_HEADERS.GroupMembers],
    ['CSM-AAAAAAAA', 'CSG-1', 'Ana', 'ana@example.com', 'Organizer + player', 'Responded', 'Interested', 'FALSE'],
    [],
    ['CSM-BBBBBBBB', 'CSG-1', 'Sam', 'sam@example.com', 'Player', 'Not invited', '', 'FALSE', '', '', '', '', '', '', 'Draft', 'Not due', '', '', '', '', '', '', 'T0', 'FALSE'],
    ['CSM-CCCCCCCC', 'CSG-2', 'Other'],
  ];
  const PROPOSALS = [[...TAB_HEADERS.Proposals], ['CSP-1', 'CSG-1', 'CSM-AAAAAAAA', 'CS-1', 'spain', 'Feb 7–13', 'Organizer + player', '', '6', '2', 'x', '', '2995', '0', '2995', 'USD', '300', '2026-12-09', 'draft', '1']];

  function make(values) {
    const calls = [];
    const fetch = async (url, init = {}) => {
      const call = { url: decodeURIComponent(String(url)), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined };
      calls.push(call);
      const tab = (call.url.match(/\/values\/'([^']+)'!/) || [])[1];
      const reply = call.method === 'GET' ? { values: values[tab] || [] } : {};
      return new Response(JSON.stringify(reply), { status: 200 });
    };
    return { calls, s: createSheetsStore({ sheetId: 'SHEET123', fetch, getToken: async () => 'tok', now: () => NOW }) };
  }

  test('updateMember rewrites exactly the matching row (A4:X4, blank rows counted) with merged values and updated_at', async () => {
    const { s, calls } = make({ GroupMembers: MEMBERS });
    const m = await s.updateMember('CSM-BBBBBBBB', { inviteStatus: 'Link shared', invitedAt: NOW });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].method, 'PUT');
    assert.equal(calls[1].url, `${BASE}/values/'GroupMembers'!A4:X4?valueInputOption=RAW`);
    const row = calls[1].body.values[0];
    assert.equal(calls[1].body.range, "'GroupMembers'!A4:X4");
    assert.equal(row.length, 24);
    assert.equal(row[0], 'CSM-BBBBBBBB');
    assert.equal(row[2], 'Sam', 'untouched cells are written back as they were');
    assert.equal(row[5], 'Link shared');
    assert.equal(row[20], NOW);
    assert.equal(row[22], NOW, 'updated_at');
    assert.equal(m.inviteStatus, 'Link shared');
    assert.equal(m.removed, false);
  });

  test('a short row is padded to the full header width; unknown id → null and no write', async () => {
    const { s, calls } = make({ GroupMembers: MEMBERS });
    await s.updateMember('CSM-AAAAAAAA', { removed: 'TRUE' });
    assert.equal(calls[1].url, `${BASE}/values/'GroupMembers'!A2:X2?valueInputOption=RAW`);
    assert.equal(calls[1].body.values[0].length, 24);
    assert.equal(calls[1].body.values[0][23], 'TRUE');
    assert.equal(await s.updateMember('CSM-NOPE', { name: 'x' }), null);
    assert.equal(calls.filter((c) => c.method === 'PUT').length, 1);
  });

  test('updateProposal keeps numeric cells numeric and has no updated_at to stamp', async () => {
    const { s, calls } = make({ Proposals: PROPOSALS });
    const p = await s.updateProposal('CSP-1', { status: 'accepted', acceptedAt: NOW });
    const row = calls[1].body.values[0];
    assert.equal(calls[1].url, `${BASE}/values/'Proposals'!A2:W2?valueInputOption=RAW`);
    assert.equal(row[12], 2995);
    assert.equal(row[16], 300);
    assert.equal(row[18], 'accepted');
    assert.equal(row[22], NOW);
    assert.equal(p.basePrice, 2995);
  });

  test('update follows the Sheet header order, and a missing id header is a setup-sheet error', async () => {
    const reordered = [['name', 'group_id', 'updated_at'], ['Ana', 'CSG-1', '']];
    const { s, calls } = make({ Groups: reordered });
    await s.updateGroup('CSG-1', { name: 'B' });
    assert.deepEqual(calls[1].body.values, [['B', 'CSG-1', NOW]]);
    assert.equal(calls[1].url, `${BASE}/values/'Groups'!A2:C2?valueInputOption=RAW`);
    const broken = make({ Groups: [['name'], ['x']] });
    await assert.rejects(broken.s.updateGroup('CSG-1', { name: 'B' }), /setup-sheet/);
  });

  test('appends go to <Tab>!A1:append in header order; reads map and filter', async () => {
    const { s, calls } = make({ GroupMembers: MEMBERS, Proposals: PROPOSALS, Settings: [['key', 'value', 'note'], ['currency', 'EUR', '']] });
    const p = await s.appendPayment({ paymentId: 'CSY-1', proposalId: 'CSP-1', amount: 300, status: 'pending' });
    assert.equal(calls[0].url, `${BASE}/values/'Payments'!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`);
    assert.equal(calls[0].body.values[0].length, TAB_HEADERS.Payments.length);
    assert.deepEqual(calls[0].body.values[0].slice(0, 2), ['CSY-1', 'CSP-1']);
    assert.equal(calls[0].body.values[0][7], 300);
    assert.equal(p.amount, 300);
    await assert.rejects(s.appendGroup({}), /groupId/);
    for (const [method, prefix, id] of [['appendGroup', 'Groups', 'groupId'], ['appendMember', 'GroupMembers', 'memberId'], ['appendConcierge', 'ConciergeRequests', 'conciergeId'], ['appendProposal', 'Proposals', 'proposalId']]) {
      await s[method]({ [id]: 'X-1' });
      assert.equal(calls.at(-1).url, `${BASE}/values/'${prefix}'!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`);
    }
    assert.deepEqual((await s.listMembers('CSG-1')).map((m) => m.memberId), ['CSM-AAAAAAAA', 'CSM-BBBBBBBB']);
    assert.equal((await s.getMember('CSM-CCCCCCCC')).name, 'Other');
    assert.equal((await s.getProposalForMember('CSM-AAAAAAAA')).version, 1);
    assert.equal(await s.getProposalForMember('CSM-BBBBBBBB'), null);
    assert.deepEqual(await s.listSettings(), [{ key: 'currency', value: 'EUR', note: '' }]);
  });
});

describe('lib/settings.js', () => {
  test('defaults fill missing, blank or non-numeric values; currency upper-cased', () => {
    assert.deepEqual(SETTINGS_DEFAULTS, { depositPerPerson: 300, depositPerGroup: 3000, balanceDueDaysBefore: 60, depositDueDays: 7, currency: 'USD' });
    assert.deepEqual(settingsFromRows([]), SETTINGS_DEFAULTS);
    assert.deepEqual(settingsFromRows([
      { key: 'deposit_per_person', value: '$450' }, { key: 'deposit_per_group', value: 'tbd' }, { key: 'balance_due_days_before', value: '' },
      { key: ' DEPOSIT_DUE_DAYS ', value: '10' }, { key: 'currency', value: 'eur' }, { key: 'unknown', value: '1' },
    ]), { depositPerPerson: 450, depositPerGroup: 3000, balanceDueDaysBefore: 60, depositDueDays: 10, currency: 'EUR' });
    assert.equal(settingsFromRows([{ key: 'deposit_per_person', value: '-5' }]).depositPerPerson, 300);
  });

  test('getSettings reads the store once per 60 seconds; _resetSettingsCache forces a read', async () => {
    assert.equal(SETTINGS_CACHE_TTL_MS, 60_000);
    const t0 = 1_000_000;
    assert.equal((await getSettings(t0)).depositPerPerson, 300);
    const data = mock.readMockData();
    data.settings[0].value = 500;
    fs.writeFileSync(process.env.MOCK_DATA_PATH, JSON.stringify(data));
    assert.equal((await getSettings(t0 + 59_000)).depositPerPerson, 300, 'cached');
    assert.equal((await getSettings(t0 + 60_000)).depositPerPerson, 500, 'expired');
    data.settings[0].value = 600;
    fs.writeFileSync(process.env.MOCK_DATA_PATH, JSON.stringify(data));
    _resetSettingsCache();
    assert.equal((await getSettings(t0 + 61_000)).depositPerPerson, 600);
  });
});
