// tests/store.sheets.scope.test.js
// The request-scoped Sheets snapshot (lib/request-scope.js + lib/store.sheets.js), added after one
// guest clicking through group -> proposal -> trip home hit Google's 60-reads-a-minute quota. Every
// route here runs against the Sheets store with an in-memory client that counts requests
// (tests/sheets.fake.js): a read-only GET costs one values:batchGet, a write-then-read one more.

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeSheets } from './sheets.fake.js';
import { SNAPSHOT_TABS, _setDefaultSheetsStore, createSheetsStore } from '../lib/store.sheets.js';
import { currentScope, runInScope, withSheetScope } from '../lib/request-scope.js';
import { _resetSettingsCache } from '../lib/settings.js';
import { callRoute, createGroup, freshGroupIp, loginCookie, useMockEnv } from './api.helpers.js';

const kinds = (fake) => fake.log.map((e) => e.kind);
const readKinds = (fake) => kinds(fake).filter((k) => k === 'get' || k === 'batchGet');

describe('API routes on the Sheets store: reads per request', () => {
  const fake = createFakeSheets();
  let quiet;
  // A cold function instance per request (fresh store, no Settings cache), production read cache on.
  const fresh = () => {
    _setDefaultSheetsStore(createSheetsStore({ client: fake.client, readCacheMs: 3000 }));
    _resetSettingsCache();
    fake.reset();
  };
  let organizer;
  let other;
  let proposalId;

  before(async () => {
    useMockEnv();
    process.env.DATA_BACKEND = 'sheets';
    quiet = { log: console.log, info: console.info };
    console.log = () => {};
    console.info = () => {};
    // Someone else's group first, so the rows under test are not row 2.
    fresh();
    other = await createGroup({ name: 'Bea Other' });
  });
  after(() => {
    console.log = quiet.log;
    console.info = quiet.info;
    _setDefaultSheetsStore(null);
    delete process.env.DATA_BACKEND;
  });
  beforeEach(fresh);

  test('POST /api/inquiry (group path): one read (was 2), the Requests, Groups and GroupMembers rows land', async () => {
    organizer = await createGroup({ name: 'Ana Guest' });
    assert.ok(organizer.groupId && organizer.memberId && organizer.cookie);
    assert.deepEqual(readKinds(fake), ['batchGet']);
    assert.equal(fake.rows('Groups').at(-1).group_id, organizer.groupId);
    assert.equal(fake.rows('GroupMembers').at(-1).member_id, organizer.memberId);
    assert.match(fake.rows('Requests').at(-1).brief, /Shown price: From \$2,995 \/ player\nSubmitted from: courtsidetravel\.co trip request$/);
  });

  test('POST /api/member add (organizer) then the others read only once', async () => {
    const res = await callRoute('member', { cookie: organizer.cookie, body: { action: 'add', name: 'Cal Friend', email: 'cal@example.com', role: 'Player' } });
    assert.equal(res.status, 200);
    assert.deepEqual(readKinds(fake), ['batchGet']);
  });

  test('GET /api/group: one batchGet (was 3)', async () => {
    const res = await callRoute('group', { cookie: organizer.cookie });
    assert.equal(res.status, 200);
    assert.equal(res.json.members.length, 2);
    assert.equal(res.json.weekLabels.w5, 'Feb 7–13');
    assert.deepEqual(readKinds(fake), ['batchGet']);
    assert.deepEqual(fake.log[0].ranges.map((r) => r.split('!')[0].slice(1, -1)), [...SNAPSHOT_TABS]);
  });

  test('GET /api/proposal (draft creation): one batchGet (was 5), the draft is appended', async () => {
    const res = await callRoute('proposal', { cookie: organizer.cookie });
    assert.equal(res.status, 200);
    proposalId = res.json.proposal.proposalId;
    assert.equal(res.json.proposal.status, 'draft');
    assert.deepEqual(kinds(fake), ['batchGet', 'append']);
    assert.equal(fake.rows('Proposals').at(-1).proposal_id, proposalId);
  });

  test('GET /api/proposal again (draft unchanged): one batchGet, no write', async () => {
    const res = await callRoute('proposal', { cookie: organizer.cookie });
    assert.equal(res.json.proposal.proposalId, proposalId);
    assert.deepEqual(kinds(fake), ['batchGet']);
  });

  test('GET /api/payments and GET /api/concierge: one batchGet each (were 2)', async () => {
    assert.equal((await callRoute('payments', { cookie: organizer.cookie })).status, 200);
    assert.deepEqual(kinds(fake), ['batchGet']);
    fresh();
    assert.equal((await callRoute('concierge', { cookie: organizer.cookie })).status, 200);
    assert.deepEqual(kinds(fake), ['batchGet']);
  });

  test('POST /api/member preferences: one read (was 2), the organizer row is the one rewritten', async () => {
    const before = fake.rows('GroupMembers');
    const res = await callRoute('member', {
      cookie: organizer.cookie,
      body: { action: 'preferences', participation: 'Interested', role: 'Player', level: '4.0', tennis: 'Daily tennis', room: 'Shared room', roommate: '', interests: [], care: '', complete: true },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(readKinds(fake), ['batchGet']);
    const after = fake.rows('GroupMembers');
    const i = after.findIndex((r) => r.member_id === organizer.memberId);
    assert.equal(after[i].room, 'Shared room');
    assert.equal(after[i].planning_complete, 'TRUE');
    after.forEach((row, j) => { if (j !== i) assert.deepEqual(row, before[j], `row ${j + 2} untouched`); });
  });

  test('POST /api/proposal accept: 2 reads (was 10) when the draft is refreshed first; every write lands in its row', async () => {
    const membersBefore = fake.rows('GroupMembers');
    const groupsBefore = fake.rows('Groups');
    const res = await callRoute('proposal', { cookie: organizer.cookie, body: { action: 'accept', proposalId } });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    // The room change refreshed the draft (update Proposals), so the accept re-reads Proposals alone.
    assert.deepEqual(readKinds(fake), ['batchGet', 'get']);
    assert.match(fake.log.find((e) => e.kind === 'get').ranges[0], /^'Proposals'!/);

    const proposal = fake.rows('Proposals').find((r) => r.proposal_id === proposalId);
    assert.equal(proposal.status, 'accepted');
    assert.equal(proposal.room, 'Shared room');
    assert.equal(proposal.version, '2');
    assert.equal(fake.rows('Proposals').length, 1, 'no duplicate proposal row');

    const members = fake.rows('GroupMembers');
    const i = members.findIndex((r) => r.member_id === organizer.memberId);
    assert.equal(members[i].proposal_status, 'Payment pending');
    assert.equal(members[i].payment_status, 'Deposit pending');
    assert.equal(members[i].room, 'Shared room', 'the earlier preferences write survives');
    members.forEach((row, j) => { if (j !== i) assert.deepEqual(row, membersBefore[j]); });

    const payment = fake.rows('Payments').at(-1);
    assert.equal(payment.proposal_id, proposalId);
    assert.equal(payment.amount, '300');

    const groups = fake.rows('Groups');
    const g = groups.findIndex((r) => r.group_id === organizer.groupId);
    assert.equal(groups[g].stage, 'Proposal sent');
    groups.forEach((row, j) => { if (j !== g) assert.deepEqual(row, groupsBefore[j]); });
  });

  test('GET /api/payments sees the deposit the previous request appended (no stale data across requests)', async () => {
    const res = await callRoute('payments', { cookie: organizer.cookie });
    assert.equal(res.json.payments.length, 1);
    assert.equal(res.json.payments[0].proposalId, proposalId);
    assert.deepEqual(kinds(fake), ['batchGet']);
  });

  test('the other group is untouched and still reads in one batchGet', async () => {
    const res = await callRoute('group', { cookie: other.cookie });
    assert.equal(res.json.group.stage, 'Inquiry');
    assert.deepEqual(readKinds(fake), ['batchGet']);
  });

  test('POST /api/group update and POST /api/concierge create: one read each', async () => {
    const g = await callRoute('group', { cookie: organizer.cookie, body: { action: 'update', name: 'Ana crew', chosenWeek: 'w5', tennis: 'Daily tennis', paymentMode: 'Individual travelers' } });
    assert.equal(g.status, 200);
    assert.deepEqual(readKinds(fake), ['batchGet']);
    assert.equal(fake.rows('Groups').find((r) => r.group_id === organizer.groupId).name, 'Ana crew');
    fresh();
    const c = await callRoute('concierge', { cookie: organizer.cookie, body: { action: 'create', category: 'Activity', subject: 'Dinner', details: 'Table for 6', timing: 'Tue' } });
    assert.equal(c.status, 200);
    assert.deepEqual(readKinds(fake), ['batchGet']);
  });

  test('POST /api/code: one read (was 2), uses lands on the right Invites row', async () => {
    const before = fake.rows('Invites');
    await loginCookie('GUEST1', { 'x-forwarded-for': freshGroupIp() });
    assert.deepEqual(readKinds(fake), ['batchGet']);
    const after = fake.rows('Invites');
    const i = after.findIndex((r) => r.code === 'GUEST1');
    assert.equal(after[i].uses, String(Number(before[i].uses) + 1));
    after.forEach((row, j) => { if (j !== i) assert.deepEqual(row, before[j]); });
  });

  test('routes that only append (waitlist) make no read at all', async () => {
    const res = await callRoute('waitlist', { body: { email: 'w@example.com', interest: 'Future Courtside experiences', source: 'concept02-home', consent: true, website: '' } });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(fake.reads(), 0);
    assert.equal(fake.rows('Waitlist').at(-1).email, 'w@example.com');
  });
});

describe('the snapshot inside one scope', () => {
  const setup = () => {
    const fake = createFakeSheets();
    const store = createSheetsStore({ client: fake.client, now: () => '2026-11-09T00:00:00.000Z' });
    return { fake, store };
  };
  const member = (memberId, name) => ({ memberId, groupId: 'CSG-1', name, email: `${memberId}@example.com`, role: 'Player', removed: 'FALSE' });

  test('every store read in a scope shares one batchGet; getMemberAndGroup included', async () => {
    const { fake, store } = setup();
    await store.appendGroup({ groupId: 'CSG-1', name: 'G' });
    await store.appendMember(member('CSM-1', 'Sam'));
    fake.reset();
    await runInScope(async () => {
      const { member: m, group } = await store.getMemberAndGroup('CSM-1', 'CSG-1');
      assert.equal(m.name, 'Sam');
      assert.equal(group.name, 'G');
      await Promise.all([store.listMembers('CSG-1'), store.listWeeks(), store.listTrips(), store.listSettings(), store.findInvite('GUEST1'), store.listPayments('CSG-1'), store.getProposalForMember('CSM-1'), store.listConcierge('CSG-1')]);
    });
    assert.deepEqual(kinds(fake), ['batchGet']);
  });

  test('write then read in one request sees fresh data, at the cost of one single read', async () => {
    const { fake, store } = setup();
    await store.appendMember(member('CSM-1', 'Sam'));
    await store.appendMember(member('CSM-2', 'Kit'));
    fake.reset();
    await runInScope(async () => {
      assert.equal((await store.getMember('CSM-2')).name, 'Kit');
      await store.updateMember('CSM-2', { name: 'Kit B' });
      assert.equal((await store.getMember('CSM-2')).name, 'Kit B');
      assert.equal((await store.getMember('CSM-1')).name, 'Sam');
    });
    assert.deepEqual(kinds(fake), ['batchGet', 'update', 'get']);
    assert.deepEqual(fake.rows('GroupMembers').map((r) => r.name), ['Sam', 'Kit B']);
  });

  test('append then update on the same tab in one request finds the appended row', async () => {
    const { fake, store } = setup();
    await store.appendProposal({ proposalId: 'CSP-0', memberId: 'CSM-0', status: 'draft', version: 1 });
    fake.reset();
    await runInScope(async () => {
      assert.equal(await store.getProposalForMember('CSM-1'), null);
      await store.appendProposal({ proposalId: 'CSP-1', memberId: 'CSM-1', status: 'draft', version: 1 });
      const updated = await store.updateProposal('CSP-1', { status: 'accepted' });
      assert.equal(updated.status, 'accepted');
      await store.updateProposal('CSP-1', { version: 2 });
    });
    const rows = fake.rows('Proposals');
    assert.deepEqual(rows.map((r) => [r.proposal_id, r.status, r.version]), [['CSP-0', 'draft', '1'], ['CSP-1', 'accepted', '2']]);
    assert.ok(fake.log.filter((e) => e.kind === 'update').every((e) => /'Proposals'!A3:/.test(e.ranges[0])), 'both updates hit row 3');
  });

  test('a write to one tab leaves the rest of the snapshot in place', async () => {
    const { fake, store } = setup();
    await runInScope(async () => {
      await store.listWeeks();
      await store.recordInviteUse('GUEST1'); // writes Invites
      await store.listWeeks();
      await store.listSettings();
      assert.equal((await store.findInvite('GUEST1')).uses, 1);
    });
    assert.deepEqual(readKinds(fake), ['batchGet', 'get']);
  });

  test('two store instances in one scope keep separate snapshots', async () => {
    const fake = createFakeSheets();
    const one = createSheetsStore({ client: fake.client });
    const two = createSheetsStore({ client: fake.client });
    await runInScope(async () => {
      await one.listWeeks();
      await two.listWeeks();
      await one.listTrips();
    });
    assert.deepEqual(readKinds(fake), ['batchGet', 'batchGet']);
  });

  test('concurrent requests get separate snapshots', async () => {
    const { fake, store } = setup();
    await store.appendMember(member('CSM-1', 'Sam'));
    fake.reset();
    let releaseA;
    const gateA = new Promise((r) => { releaseA = r; });
    const a = withSheetScope(async () => {
      const first = (await store.getMember('CSM-1')).name;
      await gateA; // B writes while A is mid-request
      const again = (await store.getMember('CSM-1')).name;
      return [first, again];
    });
    const b = withSheetScope(async () => {
      await store.updateMember('CSM-1', { name: 'Sam B' });
      return (await store.getMember('CSM-1')).name;
    });
    const pa = a();
    await new Promise((r) => setTimeout(r, 5));
    const nameB = await b();
    releaseA();
    const [first, again] = await pa;
    assert.equal(nameB, 'Sam B');
    assert.equal(first, 'Sam');
    assert.equal(again, 'Sam', 'A keeps its own snapshot for the rest of its request');
    assert.equal((await runInScope(() => store.getMember('CSM-1'))).name, 'Sam B', 'the next request reads fresh');
    assert.equal(kinds(fake).filter((k) => k === 'batchGet').length, 3);
  });

  test('outside a scope nothing changed: every read is its own request', async () => {
    const { fake, store } = setup();
    await store.listWeeks();
    await store.listWeeks();
    await store.getMemberAndGroup('CSM-1', 'CSG-1');
    assert.deepEqual(readKinds(fake), ['get', 'get', 'batchGet']);
    assert.equal(fake.log[2].ranges.length, 2);
  });

  test('a Sheet missing a tab of the set (400 from batchGet) falls back to single reads', async () => {
    const fake = createFakeSheets({ tabs: ['Trips', 'Weeks', 'Log'] });
    const store = createSheetsStore({ client: fake.client });
    await runInScope(async () => {
      assert.equal((await store.listWeeks()).length, 7);
      assert.equal((await store.listTrips()).length, 1);
      await store.listWeeks();
    });
    assert.deepEqual(readKinds(fake), ['batchGet', 'get', 'get']);
  });

  test('another batchGet failure surfaces, and a later read in the same request tries again', async () => {
    const fake = createFakeSheets();
    let fail = true;
    const client = { ...fake.client, async batchGetValues(r) { if (fail) { fail = false; throw Object.assign(new Error('boom'), { status: 500 }); } return fake.client.batchGetValues(r); } };
    const store = createSheetsStore({ client });
    await runInScope(async () => {
      await assert.rejects(store.listWeeks(), /boom/);
      assert.equal((await store.listWeeks()).length, 7);
    });
  });

  test('scopes are fresh on every call, nested too, and absent outside', async () => {
    assert.equal(currentScope(), null);
    await runInScope(async () => {
      const outer = currentScope();
      assert.ok(outer);
      await runInScope(async () => assert.notEqual(currentScope(), outer));
      assert.equal(currentScope(), outer);
    });
    const wrapped = withSheetScope(async (x) => [x, currentScope() !== null]);
    assert.deepEqual(await wrapped(7), [7, true]);
    assert.equal(currentScope(), null);
  });
});
