// tests/store.test.js
// lib/store.js backend selection and the interface surface.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../lib/store.js';
import * as mock from '../lib/store.mock.js';

const INTERFACE = ['findInvite', 'recordInviteUse', 'logAttempt', 'listTrips', 'listWeeks', 'appendRequest', 'appendWaitlist', 'appendHostApplication'];
const GOOGLE_ENV = ['SHEET_ID', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY'];

let dir;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'courtside-store-'));
  process.env.MOCK_DATA_PATH = path.join(dir, 'mock.json');
  delete process.env.DATA_BACKEND;
  for (const key of GOOGLE_ENV) delete process.env[key];
});
after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

test('exposes exactly the 4.1 interface plus appendWaitlist and appendHostApplication as functions', () => {
  for (const name of INTERFACE) assert.equal(typeof store[name], 'function', name);
  for (const name of INTERFACE) assert.equal(typeof mock[name], 'function', `mock.${name}`);
});

test('picks the mock backend when DATA_BACKEND is unset', async () => {
  delete process.env.DATA_BACKEND;
  assert.equal(store.backendName(), 'mock');
  const invite = await store.findInvite('guest1');
  assert.equal(invite.issuedTo, 'Ana Guest');
  assert.equal(fs.existsSync(process.env.MOCK_DATA_PATH), true);
});

test('treats blank and mixed-case DATA_BACKEND values sensibly', () => {
  assert.equal(store.backendName({ DATA_BACKEND: '' }), 'mock');
  assert.equal(store.backendName({ DATA_BACKEND: '  Mock ' }), 'mock');
  assert.equal(store.backendName({ DATA_BACKEND: 'SHEETS' }), 'sheets');
  assert.throws(() => store.backendName({ DATA_BACKEND: 'postgres' }), /Unknown DATA_BACKEND "postgres"/);
});

test('DATA_BACKEND=sheets routes to the Sheets store, which fails clearly without credentials', async () => {
  process.env.DATA_BACKEND = 'sheets';
  try {
    assert.equal(store.backendName(), 'sheets');
    await assert.rejects(store.listTrips(), /missing SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY/);
    await assert.rejects(store.findInvite('GUEST1'), /DATA_BACKEND=mock/);
  } finally {
    delete process.env.DATA_BACKEND;
  }
  // and back to mock without re-importing
  assert.equal((await store.listTrips())[0].tripId, 'spain');
});

test('importing lib/store.sheets.js with no Google env vars does not throw', async () => {
  const sheets = await import('../lib/store.sheets.js');
  for (const name of INTERFACE) assert.equal(typeof sheets[name], 'function', name);
  assert.equal(typeof sheets.createSheetsStore, 'function');
});

test('the mock backend round-trips a request through the shared interface', async () => {
  const result = await store.appendRequest({
    requestId: 'CS-ABCDEFGH',
    submittedAt: new Date().toISOString(),
    tripId: 'spain',
    requestType: 'vetted',
    weeks: 'Jan 10–16, Feb 7–13',
    status: 'New',
  });
  assert.deepEqual(result, { requestId: 'CS-ABCDEFGH' });
  const saved = mock.readMockData().requests.find((r) => r.request_id === 'CS-ABCDEFGH');
  assert.equal(saved.request_type, 'vetted');
  assert.equal(saved.status, 'New');
});

test('the mock backend round-trips a waitlist row through the shared interface', async () => {
  const result = await store.appendWaitlist({
    timestamp: new Date().toISOString(), email: 'ana.guest@example.com', name: 'Ana Guest', trip: 'General', source: 'footer',
  });
  assert.deepEqual(result, { email: 'ana.guest@example.com', trip: 'General' });
  const saved = mock.readMockData().waitlist.find((r) => r.email === 'ana.guest@example.com');
  assert.equal(saved.trip, 'General');
  assert.equal(saved.source, 'footer');
});

test('the mock backend round-trips a host application through the shared interface', async () => {
  const result = await store.appendHostApplication({
    timestamp: new Date().toISOString(), name: 'Sam Pro', email: 'sam.pro@example.com', club: 'Club de Tenis, Alicante, Spain',
    referral: '', background: 'Twenty years of coaching.', community: 'A club of 200 members.', destination: 'Mallorca',
  });
  assert.deepEqual(result, { email: 'sam.pro@example.com' });
  const saved = mock.readMockData().host_applications.find((r) => r.email === 'sam.pro@example.com');
  assert.equal(saved.club, 'Club de Tenis, Alicante, Spain');
  assert.equal(saved.referral, '');
  assert.equal(saved.destination, 'Mallorca');
});
