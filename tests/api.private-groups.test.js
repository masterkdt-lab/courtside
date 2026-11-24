// Private groups: the three-step save, the daily reminder to guests who stop partway, and the resume link
// (lib/private-groups.js, served from api/lineup.js through rewrites).
import { test, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GET, POST } from '../api/lineup.js';
import { _resetDoubleSubmit, dueForReminder, pacificTimestampFor, parsePacific, runReminders } from './private-groups.helpers.js';
import { _reset as resetRateLimit } from '../lib/ratelimit.js';
import { sentLog, _resetSentLog } from '../lib/email.js';
import { freshMockPath, getRequest, jsonRequest, readMock, tempDir, useMockEnv } from './api.helpers.js';

let dir;
let quiet;
before(() => { dir = tempDir('courtside-pg-'); useMockEnv(); quiet = mock.method(console, 'log', () => {}); });
after(() => { quiet.mock.restore(); fs.rmSync(dir, { recursive: true, force: true }); });
beforeEach(() => { freshMockPath(dir); resetRateLimit(); _resetDoubleSubmit(); _resetSentLog(); useMockEnv(); });

const step = async (body) => (await POST(jsonRequest('/api/private-groups', body))).json();
const rows = () => readMock().private_groups;
const setUpdated = (id, text) => {
  const data = readMock();
  const r = data.private_groups.find((x) => x['Request ID'] === id);
  r['Last updated (PT)'] = text;
  fs.writeFileSync(process.env.MOCK_DATA_PATH, JSON.stringify(data));
};

test('the three steps write one row, Started → Trip details → Complete, and email the team only at the end', async () => {
  const a = await step({ step: 1, name: 'Ana Guest', email: 'ana@example.com', where: 'Punta Mita', when: 'March' });
  assert.equal(a.ok, true);
  assert.match(a.requestId, /^PG-[0-9A-Z]{8}$/);
  assert.equal(rows().length, 1);
  assert.equal(rows()[0].Stage, 'Started');
  await step({ step: 2, requestId: a.requestId, name: 'Ana Guest', email: 'ana@example.com', where: 'Punta Mita', when: 'March', players: '5–7 players', focus: ['Doubles strategy'] });
  assert.equal(rows().length, 1);
  assert.deepEqual([rows()[0].Stage, rows()[0]['3. Tennis players'], rows()[0]['6. Focus']], ['Trip details', '5–7 players', 'Doubles strategy']);
  assert.equal(sentLog.length, 0);
  await step({ step: 3, requestId: a.requestId, name: 'Ana Guest', email: 'ana@example.com', where: 'Punta Mita', notes: 'Eight of us' });
  assert.equal(rows()[0].Stage, 'Complete');
  assert.equal(sentLog.filter((m) => /Private group request/.test(m.subject)).length, 1);
});

test('reminders: one email to a guest who stopped 12+ hours ago, never to finished, recent, old or already-reminded rows', async () => {
  const now = new Date('2026-11-26T18:00:00Z');
  const stuck = (await step({ step: 1, name: 'Stuck Guest', email: 'stuck@example.com', where: 'Mallorca' })).requestId;
  const recent = (await step({ step: 2, name: 'Recent Guest', email: 'recent@example.com' })).requestId;
  const done = (await step({ step: 3, name: 'Done Guest', email: 'done@example.com' })).requestId;
  const stale = (await step({ step: 1, name: 'Old Guest', email: 'old@example.com' })).requestId;
  setUpdated(stuck, pacificTimestampFor(new Date(now.getTime() - 20 * 3600e3)));
  setUpdated(recent, pacificTimestampFor(new Date(now.getTime() - 2 * 3600e3)));
  setUpdated(done, pacificTimestampFor(new Date(now.getTime() - 48 * 3600e3)));
  setUpdated(stale, pacificTimestampFor(new Date(now.getTime() - 20 * 24 * 3600e3)));
  _resetSentLog();
  const first = await runReminders({ now });
  assert.deepEqual([first.due, first.sent], [1, 1]);
  assert.equal(sentLog.length, 1);
  assert.equal(sentLog[0].to?.[0] ?? sentLog[0].to, 'stuck@example.com');
  assert.match(sentLog[0].subject, /almost ready to plan/);
  assert.match(sentLog[0].text, /You started planning your tennis camp to Mallorca\./);
  assert.match(sentLog[0].text, new RegExp(`/#/build-your-camp\\?r=${stuck}`));
  assert.notEqual(rows().find((r) => r['Request ID'] === stuck)['Reminder sent (PT)'], '');
  const second = await runReminders({ now });
  assert.equal(second.sent, 0, 'one reminder per guest');
});

test('parsePacific reads back what the site writes, in winter and summer', () => {
  for (const iso of ['2026-11-24T22:48:00Z', '2027-07-04T16:05:00Z']) {
    const d = new Date(iso);
    assert.equal(parsePacific(pacificTimestampFor(d)).toISOString(), d.toISOString());
  }
  assert.equal(dueForReminder({ Stage: 'Started', Email: 'a@b.co', 'Last updated (PT)': 'nonsense' }), false);
});

test('the reminder job needs the cron secret; the resume link returns the saved answers', async () => {
  process.env.CRON_SECRET = 'test-secret';
  assert.equal((await GET(getRequest('/api/private-groups-reminders'))).status, 401);
  assert.equal((await GET(getRequest('/api/private-groups-reminders', { authorization: 'Bearer test-secret' }))).status, 200);
  delete process.env.CRON_SECRET;
  const id = (await step({ step: 2, name: 'Res Guest', email: 'res@example.com', where: 'Charleston', players: '2–4 players', focus: ['Live-ball drills'] })).requestId;
  const res = await (await GET(getRequest(`/api/private-groups?r=${id}`))).json();
  assert.equal(res.ok, true);
  assert.equal(res.step, 3);
  assert.deepEqual([res.answers.where, res.answers.players, res.answers.focus], ['Charleston', '2–4 players', ['Live-ball drills']]);
  assert.equal((await GET(getRequest('/api/private-groups?r=PG-00000000'))).status, 404);
  assert.equal((await GET(getRequest('/api/lineup'))).status, 200, '/api/lineup itself unchanged');
});
