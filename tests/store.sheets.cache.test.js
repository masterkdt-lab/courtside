// tests/store.sheets.cache.test.js
// The Sheets read cache (lib/store.sheets.js) and the 429 backoff (lib/store.sheets.client.js),
// added after the Wave 2 preview hit Google's 60-reads-a-minute quota.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSheetsStore } from '../lib/store.sheets.js';
import { createSheetsClient } from '../lib/store.sheets.client.js';

const WEEKS = [['week_id', 'trip_id', 'label', 'start_date', 'end_date', 'status', 'closed_message'], ['w1', 'spain', 'Jan 10–16', '2027-01-10', '2027-01-16', 'open', '']];

const MEMBERS = [['member_id', 'group_id', 'name', 'removed'], ['CSM-1', 'CSG-1', 'Sam', 'FALSE']];
const GROUPS = [['group_id', 'name'], ['CSG-1', 'Test group']];

function fakeClient() {
  const calls = { get: 0, append: 0 };
  return {
    calls,
    async getValues() { calls.get += 1; return { values: WEEKS }; },
    async appendValues() { calls.append += 1; return {}; },
    async updateValues() { return {}; },
    async batchUpdateValues() { return {}; },
    async batchGetValues(ranges) { calls.batch = (calls.batch || 0) + 1; return { valueRanges: ranges.map((r) => ({ values: r.includes('GroupMembers') ? MEMBERS : GROUPS })) }; },
    async getSpreadsheet() { return { sheets: [] }; },
    async batchUpdate() { return {}; },
  };
}

test('Weeks (edited only by Courtside) is reused for a few seconds, also across guest writes', async () => {
  const raw = fakeClient();
  const store = createSheetsStore({ client: raw, readCacheMs: 60_000 });
  await Promise.all([store.listWeeks(), store.listWeeks(), store.listWeeks()]);
  await store.listWeeks();
  assert.equal(raw.calls.get, 1, 'concurrent and repeated reads collapse to one');
  await store.logAttempt({ code: 'X', result: 'ok', ipHash: 'h' });
  await store.listWeeks();
  assert.equal(raw.calls.get, 1, 'a guest write does not drop the Weeks cache');
});

test('the cache is off for injected clients unless asked, so other unit tests see every read', async () => {
  const raw = fakeClient();
  const store = createSheetsStore({ client: raw });
  await store.listWeeks();
  await store.listWeeks();
  assert.equal(raw.calls.get, 2);
});

test('a failed read is not cached', async () => {
  let n = 0;
  const raw = { ...fakeClient(), async getValues() { n += 1; if (n === 1) throw new Error('boom'); return { values: WEEKS }; } };
  const store = createSheetsStore({ client: raw, readCacheMs: 60_000 });
  await assert.rejects(store.listWeeks());
  assert.equal((await store.listWeeks()).length, 1);
});

test('the client retries a 429 with backoff and then succeeds; other errors are not retried', async () => {
  let n = 0;
  const fetch = async () => { n += 1; return n < 3 ? new Response(JSON.stringify({ error: { message: 'Quota exceeded' } }), { status: 429 }) : new Response(JSON.stringify({ values: WEEKS }), { status: 200 }); };
  const client = createSheetsClient({ sheetId: 'id', getToken: async () => 't', fetch, retryDelays: [1, 1, 1] });
  const res = await client.getValues("'Weeks'!A1:ZZ");
  assert.equal(n, 3);
  assert.equal(res.values.length, 2);

  let m = 0;
  const fetch500 = async () => { m += 1; return new Response('nope', { status: 500 }); };
  const c2 = createSheetsClient({ sheetId: 'id', getToken: async () => 't', fetch: fetch500, retryDelays: [1, 1, 1] });
  await assert.rejects(c2.getValues("'Weeks'!A1:ZZ"), (err) => err.status === 500);
  assert.equal(m, 1);
});

test('the client gives up after the last delay and surfaces the 429', async () => {
  let n = 0;
  const fetch = async () => { n += 1; return new Response('{}', { status: 429 }); };
  const client = createSheetsClient({ sheetId: 'id', getToken: async () => 't', fetch, retryDelays: [1, 1] });
  await assert.rejects(client.getValues("'Weeks'!A1:ZZ"), (err) => err.status === 429);
  assert.equal(n, 3);
});

test('guest tabs are never reused across requests: sequential reads hit the Sheet each time, concurrent ones share', async () => {
  const raw = { ...fakeClient(), calls: { get: 0 } };
  raw.getValues = async () => { raw.calls.get += 1; return { values: MEMBERS }; };
  const store = createSheetsStore({ client: raw, readCacheMs: 60_000 });
  await store.getMember('CSM-1');
  await store.getMember('CSM-1');
  assert.equal(raw.calls.get, 2, 'no TTL reuse for GroupMembers');
  await Promise.all([store.getMember('CSM-1'), store.getMember('CSM-1')]);
  assert.equal(raw.calls.get, 3, 'two concurrent reads share one request');
});

test('getMemberAndGroup reads both rows in one batchGet', async () => {
  const raw = fakeClient();
  const store = createSheetsStore({ client: raw });
  const { member, group } = await store.getMemberAndGroup('CSM-1', 'CSG-1');
  assert.equal(member.name, 'Sam');
  assert.equal(group.name, 'Test group');
  assert.equal(raw.calls.batch, 1);
  assert.equal(raw.calls.get, 0);
  assert.deepEqual(await store.getMemberAndGroup('', 'CSG-1'), { member: null, group: null });
});
