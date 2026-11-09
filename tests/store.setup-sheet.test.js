// tests/store.setup-sheet.test.js
// scripts/setup-sheet.js against an in-memory fake spreadsheet (stubbed fetch, stubbed token).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runSetup, loadDotEnv, EXAMPLE_INVITE } from '../scripts/setup-sheet.js';
import { createSheetsClient, SHEETS_API } from '../lib/store.sheets.client.js';
import { TAB_HEADERS, TAB_NAMES, DROPDOWNS, WAVE2_TABS } from '../lib/store.columns.js';

const SEED = JSON.parse(fs.readFileSync(new URL('./fixtures/seed.json', import.meta.url), 'utf8'));
const BASE = `${SHEETS_API}/SHEET123`;

// A tiny fake of the parts of the Sheets API the script uses.
function fakeSpreadsheet(initialTabs = { Sheet1: [] }) {
  const tabs = new Map();
  let nextId = 0;
  for (const [title, values] of Object.entries(initialTabs)) tabs.set(title, { sheetId: nextId++, values: values.map((r) => [...r]) });
  const validations = [];
  const calls = [];

  function tabOf(url) {
    const m = url.match(/\/values\/'([^']+)'!/);
    return m ? tabs.get(m[1]) : null;
  }

  async function fetch(url, init = {}) {
    url = decodeURIComponent(String(url));
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body });
    const reply = (json, status = 200) => new Response(JSON.stringify(json), { status });

    if (method === 'GET' && url.startsWith(`${BASE}?fields=`)) {
      return reply({ sheets: [...tabs].map(([title, t]) => ({ properties: { sheetId: t.sheetId, title } })) });
    }
    if (method === 'POST' && url === `${BASE}:batchUpdate`) {
      const replies = [];
      for (const req of body.requests) {
        if (req.addSheet) {
          const { title } = req.addSheet.properties;
          if (tabs.has(title)) return reply({ error: { code: 400, message: `A sheet with the name "${title}" already exists.` } }, 400);
          tabs.set(title, { sheetId: nextId++, values: [] });
          replies.push({ addSheet: { properties: { sheetId: tabs.get(title).sheetId, title } } });
        } else if (req.setDataValidation) {
          validations.push(req.setDataValidation);
          replies.push({});
        } else {
          return reply({ error: { code: 400, message: `unexpected request ${Object.keys(req)}` } }, 400);
        }
      }
      return reply({ replies });
    }
    const tab = tabOf(url);
    if (!tab) return reply({ error: { code: 404, message: `no tab for ${url}` } }, 404);
    if (method === 'GET') return reply(tab.values.length ? { values: tab.values } : {});
    if (method === 'PUT') {
      body.values.forEach((row, i) => { tab.values[i] = [...row]; });
      return reply({ updatedRows: body.values.length });
    }
    if (method === 'POST' && url.includes(':append')) {
      for (const row of body.values) tab.values.push([...row]);
      return reply({ updates: { updatedRows: body.values.length } });
    }
    return reply({ error: { code: 400, message: `unexpected ${method} ${url}` } }, 400);
  }

  const client = createSheetsClient({ sheetId: 'SHEET123', fetch, getToken: async () => 'stub-token' });
  return { tabs, validations, calls, client };
}

function run(sheet) {
  const lines = [];
  return runSetup({ client: sheet.client, seed: SEED, log: (line) => lines.push(String(line)) }).then(() => lines);
}

describe('runSetup on a fresh spreadsheet', () => {
  test('adds the six tabs, writes exact headers, sets dropdowns, seeds Trips, Weeks and Settings only', async () => {
    const sheet = fakeSpreadsheet();
    const lines = await run(sheet);

    assert.deepEqual([...sheet.tabs.keys()], ['Sheet1', ...TAB_NAMES]);
    for (const tab of TAB_NAMES) assert.deepEqual(sheet.tabs.get(tab).values[0], [...TAB_HEADERS[tab]], `${tab} headers`);

    assert.equal(sheet.tabs.get('Trips').values.length, 2);
    assert.deepEqual(sheet.tabs.get('Trips').values[1], ['spain', 'The Spanish Offseason', 'open', 'Requests for The Spanish Offseason are closed.']);
    assert.equal(sheet.tabs.get('Weeks').values.length, 8);
    assert.deepEqual(sheet.tabs.get('Weeks').values[1], ['w1', 'spain', 'Jan 10–16', '2027-01-10', '2027-01-16', 'open', 'Requests for this week are closed.']);
    assert.deepEqual(sheet.tabs.get('Weeks').values[7], ['w7', 'spain', 'Feb 21–27', '2027-02-21', '2027-02-27', 'open', 'Requests for this week are closed.']);
    assert.equal(sheet.tabs.get('Invites').values.length, 1, 'Invites is never seeded');
    assert.equal(sheet.tabs.get('Requests').values.length, 1);
    assert.equal(sheet.tabs.get('Log').values.length, 1);
    assert.deepEqual(sheet.tabs.get('Waitlist').values, [['timestamp', 'email', 'name', 'trip', 'source']], 'Waitlist is headers only');
    assert.deepEqual(
      sheet.tabs.get('HostApplications').values,
      [['timestamp', 'name', 'email', 'club', 'referral', 'background', 'community', 'destination']],
      'HostApplications is headers only',
    );

    assert.equal(sheet.validations.length, DROPDOWNS.length);
    assert.ok(DROPDOWNS.every((d) => d.tab !== 'Waitlist' && d.tab !== 'HostApplications'), 'no dropdowns on Waitlist or HostApplications');
    assert.ok(sheet.validations.every((v) => v.range.sheetId !== sheet.tabs.get('Waitlist').sheetId), 'no validation touches Waitlist');
    assert.ok(sheet.validations.every((v) => v.range.sheetId !== sheet.tabs.get('HostApplications').sheetId), 'no validation touches HostApplications');
    DROPDOWNS.forEach(({ tab, column, values }, i) => {
      const v = sheet.validations[i];
      const col = TAB_HEADERS[tab].indexOf(column);
      assert.deepEqual(v.range, { sheetId: sheet.tabs.get(tab).sheetId, startRowIndex: 1, startColumnIndex: col, endColumnIndex: col + 1 });
      assert.equal(v.rule.condition.type, 'ONE_OF_LIST');
      assert.deepEqual(v.rule.condition.values.map((x) => x.userEnteredValue), values);
      assert.equal(v.rule.strict, true);
    });
    const requestsStatus = sheet.validations[2];
    assert.deepEqual(requestsStatus.rule.condition.values.map((x) => x.userEnteredValue), ['New', 'In conversation', 'Confirmed', 'Waitlist', 'Declined']);

    const text = lines.join('\n');
    assert.match(text, /Added tabs: Trips, Weeks, Requests, Invites, Log, Waitlist, HostApplications, Groups, GroupMembers, ConciergeRequests, Proposals, Payments, Settings\n/);
    assert.match(text, /Waitlist: wrote headers/);
    assert.match(text, /Waitlist \(timestamp, email, name, trip, source\) is filled by the site's waitlist forms/);
    assert.match(text, /HostApplications: wrote headers/);
    assert.match(text, /HostApplications \(timestamp, name, email, club, referral, background, community, destination\) is filled by the #\/application host form/);
    assert.match(text, /Trips: seeded 1 row\n/);
    assert.match(text, /Weeks: seeded 7 rows/);
    assert.ok(text.includes(TAB_HEADERS.Invites.join('\t')), 'prints the Invites headers');
    assert.ok(text.includes(EXAMPLE_INVITE.map(String).join('\t')), 'prints the example Invites row');
    assert.ok(text.includes('GUEST1\tAna Guest\tana.guest@example.com'));

    const appendCalls = sheet.calls.filter((c) => c.url.includes(':append'));
    assert.deepEqual(appendCalls.map((c) => c.url), [
      `${BASE}/values/'Trips'!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      `${BASE}/values/'Weeks'!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      `${BASE}/values/'Settings'!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    ]);
  });
});

describe('runSetup is idempotent', () => {
  test('a second run adds nothing, seeds nothing and keeps Katie\'s rows', async () => {
    const sheet = fakeSpreadsheet();
    await run(sheet);
    sheet.tabs.get('Invites').values.push(['GUEST1', 'Ana Guest', 'ana.guest@example.com', '+1 555 0100', 'Katie', '', 0, 'active', '2026-10-05T00:00:00Z', '']);
    sheet.tabs.get('Weeks').values[5][5] = 'closed';
    const before = JSON.stringify([...sheet.tabs]);
    const callsBefore = sheet.calls.length;

    const lines = await run(sheet);

    assert.equal(JSON.stringify([...sheet.tabs]), before, 'no tab content changed');
    const newCalls = sheet.calls.slice(callsBefore);
    assert.equal(newCalls.filter((c) => c.url.includes(':append')).length, 0, 'no appends');
    assert.equal(newCalls.filter((c) => c.method === 'PUT').length, 0, 'no header rewrites');
    const batchUpdates = newCalls.filter((c) => c.url === `${BASE}:batchUpdate`);
    assert.equal(batchUpdates.length, 1, 'only the validation batchUpdate');
    assert.ok(batchUpdates[0].body.requests.every((r) => r.setDataValidation));
    assert.equal(sheet.validations.length, DROPDOWNS.length * 2);

    const text = lines.join('\n');
    assert.match(text, /Tabs present: Trips, Weeks, Requests, Invites, Log, Waitlist, HostApplications, Groups, GroupMembers, ConciergeRequests, Proposals, Payments, Settings\n/);
    assert.match(text, /Trips: already has data, not seeded/);
    assert.match(text, /Weeks: already has data, not seeded/);
    assert.match(text, /Settings: already has data, not seeded/);
    for (const tab of TAB_NAMES) assert.match(text, new RegExp(`${tab}: headers ok`));
  });

  test('a tab that exists with the wrong headers gets row 1 replaced and the rest left alone', async () => {
    const sheet = fakeSpreadsheet({
      Sheet1: [],
      Trips: [['id', 'name'], ['spain', 'The Spanish Offseason', 'open', 'x']],
      Invites: [[], ['GUEST1', 'Ana Guest']],
    });
    const lines = await run(sheet);
    assert.deepEqual(sheet.tabs.get('Trips').values, [
      [...TAB_HEADERS.Trips],
      ['spain', 'The Spanish Offseason', 'open', 'x'],
    ]);
    assert.deepEqual(sheet.tabs.get('Invites').values, [[...TAB_HEADERS.Invites], ['GUEST1', 'Ana Guest']]);
    const text = lines.join('\n');
    assert.match(text, /Trips: row 1 was \[id, name\]; replacing it/);
    assert.match(text, /Trips: wrote headers/);
    assert.match(text, /Trips: already has data, not seeded/);
    assert.match(text, /Invites: wrote headers/);
    assert.match(text, /Added tabs: Weeks, Requests, Log, Waitlist, HostApplications, Groups, GroupMembers, ConciergeRequests, Proposals, Payments, Settings\n/);
  });

  test('a Sheet set up before the Waitlist tab existed gains Waitlist with headers only; nothing else changes', async () => {
    const phase1 = {
      Trips: [[...TAB_HEADERS.Trips], ['spain', 'The Spanish Offseason', 'open', 'x']],
      Weeks: [[...TAB_HEADERS.Weeks], ['w1', 'spain', 'Jan 10–16', '2027-01-10', '2027-01-16', 'closed', 'y']],
      Requests: [[...TAB_HEADERS.Requests]],
      Invites: [[...TAB_HEADERS.Invites], ['GUEST1', 'Ana Guest', 'ana.guest@example.com', '+1 555 0100', 'Katie', '', 0, 'active', '2026-10-05T00:00:00Z', '']],
      Log: [[...TAB_HEADERS.Log], ['2026-10-05T00:00:00Z', 'GUEST1', 'ok', 'deadbeefdeadbeef']],
    };
    const sheet = fakeSpreadsheet(phase1);
    const before = JSON.stringify([...sheet.tabs]);
    const lines = await run(sheet);
    assert.deepEqual([...sheet.tabs.keys()], [...Object.keys(phase1), 'Waitlist', 'HostApplications', ...WAVE2_TABS]);
    assert.deepEqual(sheet.tabs.get('Waitlist').values, [[...TAB_HEADERS.Waitlist]]);
    assert.deepEqual(sheet.tabs.get('HostApplications').values, [[...TAB_HEADERS.HostApplications]]);
    const after = new Map(sheet.tabs);
    after.delete('Waitlist');
    after.delete('HostApplications');
    for (const tab of WAVE2_TABS) after.delete(tab);
    assert.equal(JSON.stringify([...after]), before, 'the five Phase 1 tabs are untouched');
    assert.equal(sheet.calls.filter((c) => c.url.includes(':append')).length, 1, 'only Settings is seeded');
    assert.equal(sheet.calls.filter((c) => c.method === 'PUT').length, 8, 'header writes for Waitlist, HostApplications and the six Wave 2 tabs');
    const text = lines.join('\n');
    assert.match(text, /Added tabs: Waitlist, HostApplications, Groups, GroupMembers, ConciergeRequests, Proposals, Payments, Settings\n/);
    assert.match(text, /Waitlist: wrote headers/);
    assert.match(text, /HostApplications: wrote headers/);
    for (const tab of Object.keys(phase1)) assert.match(text, new RegExp(`${tab}: headers ok`));
  });

  test('a Sheet set up before the HostApplications tab existed (the live TGL COURTSIDE Sheet) gains it with headers only; nothing else changes', async () => {
    const live = {
      Trips: [[...TAB_HEADERS.Trips], ['spain', 'The Spanish Offseason', 'open', 'x']],
      Weeks: [[...TAB_HEADERS.Weeks], ['w1', 'spain', 'Jan 10–16', '2027-01-10', '2027-01-16', 'open', 'y']],
      Requests: [[...TAB_HEADERS.Requests], ['CS-TEST0001', '2026-10-22T12:00:00.000Z', 'spain', 'private', 'Feb 7–13']],
      Invites: [[...TAB_HEADERS.Invites], ['GUEST1', 'Ana Guest', 'ana.guest@example.com', '+1 555 0100', 'Katie', '', 3, 'active', '2026-10-05T00:00:00Z', '2026-10-22T12:00:00.000Z']],
      Log: [[...TAB_HEADERS.Log], ['2026-10-05T00:00:00Z', 'GUEST1', 'ok', 'deadbeefdeadbeef']],
      Waitlist: [[...TAB_HEADERS.Waitlist], ['2026-10-22T12:00:00.000Z', 'ana.guest@example.com', 'Ana Guest', 'Charleston', 'card']],
    };
    const sheet = fakeSpreadsheet(live);
    const before = JSON.stringify([...sheet.tabs]);
    const lines = await run(sheet);
    assert.deepEqual([...sheet.tabs.keys()], [...Object.keys(live), 'HostApplications', ...WAVE2_TABS]);
    assert.deepEqual(sheet.tabs.get('HostApplications').values, [[...TAB_HEADERS.HostApplications]]);
    const after = new Map(sheet.tabs);
    after.delete('HostApplications');
    for (const tab of WAVE2_TABS) after.delete(tab);
    assert.equal(JSON.stringify([...after]), before, 'the six existing tabs and their rows are untouched');
    assert.equal(sheet.calls.filter((c) => c.url.includes(':append')).length, 1, 'only Settings is seeded');
    assert.equal(sheet.calls.filter((c) => c.method === 'PUT').length, 7, 'header writes for HostApplications and the six Wave 2 tabs');
    const text = lines.join('\n');
    assert.match(text, /Added tabs: HostApplications, Groups, GroupMembers, ConciergeRequests, Proposals, Payments, Settings\n/);
    assert.match(text, /HostApplications: wrote headers/);
    for (const tab of Object.keys(live)) assert.match(text, new RegExp(`${tab}: headers ok`));

    // And a second run on that Sheet is a no-op.
    const callsBefore = sheet.calls.length;
    await run(sheet);
    const newCalls = sheet.calls.slice(callsBefore);
    assert.equal(newCalls.filter((c) => c.url.includes(':append') || c.method === 'PUT').length, 0);
    assert.equal(newCalls.filter((c) => c.body && c.body.requests && c.body.requests.some((r) => r.addSheet)).length, 0, 'no addSheet');
  });

  test('a tab with headers only is seeded', async () => {
    const sheet = fakeSpreadsheet({ Trips: [[...TAB_HEADERS.Trips]], Weeks: [[...TAB_HEADERS.Weeks], ['', '', '']] });
    await run(sheet);
    assert.equal(sheet.tabs.get('Trips').values.length, 2);
    assert.equal(sheet.tabs.get('Weeks').values.length, 2 + 7, 'a blank row does not count as data');
  });
});

describe('Wave 2 tabs (CONCEPT02_WAVE2_PLAN.md sections 2 and 5)', () => {
  const live = () => ({
    Trips: [[...TAB_HEADERS.Trips], ['spain', 'The Spanish Offseason', 'open', 'x']],
    Weeks: [[...TAB_HEADERS.Weeks], ['w1', 'spain', 'Jan 10–16', '2027-01-10', '2027-01-16', 'open', 'y']],
    Requests: [[...TAB_HEADERS.Requests], ['CS-TEST0001', '2026-10-22T12:00:00.000Z', 'spain', 'private', 'Feb 7–13']],
    Invites: [[...TAB_HEADERS.Invites], ['GUEST1', 'Ana Guest', '', '', 'Katie', '', 3, 'active', '', '']],
    Log: [[...TAB_HEADERS.Log], ['2026-10-05T00:00:00Z', 'GUEST1', 'ok', 'deadbeefdeadbeef']],
    Waitlist: [[...TAB_HEADERS.Waitlist]],
    HostApplications: [[...TAB_HEADERS.HostApplications], ['2026-11-08T12:00:00.000Z', 'Sam', 'sam@example.com']],
  });

  test('the exact headers from the plan', () => {
    assert.deepEqual(WAVE2_TABS, ['Groups', 'GroupMembers', 'ConciergeRequests', 'Proposals', 'Payments', 'Settings']);
    assert.equal(TAB_HEADERS.Groups.join(','), 'group_id,request_id,trip_id,name,organizer_name,organizer_email,weeks,chosen_week,players,partners,tennis,payment_mode,notes,stage,review_needed,created_at,updated_at');
    assert.equal(TAB_HEADERS.GroupMembers.join(','), 'member_id,group_id,name,email,role,invite_status,participation,planning_complete,level,tennis,room,roommate,interests,care_notes,proposal_status,payment_status,arrival_airport,arrival_date,arrival_flight,arrival_time,invited_at,joined_at,updated_at,removed');
    assert.equal(TAB_HEADERS.ConciergeRequests.join(','), 'concierge_id,group_id,member_id,requester_name,category,subject,details,preferred_timing,status,offer,cost,assigned_to,history,created_at,updated_at');
    assert.equal(TAB_HEADERS.Proposals.join(','), 'proposal_id,group_id,member_id,request_id,trip_id,week,role,room,players,partners,inclusions,addons,base_price,extras_total,package_total,currency,deposit_amount,balance_due_date,status,version,created_at,sent_at,accepted_at');
    assert.equal(TAB_HEADERS.Payments.join(','), 'payment_id,proposal_id,group_id,member_id,payer_name,payer_email,type,amount,currency,method,provider_ref,status,due_date,paid_at,notes,created_at');
    assert.deepEqual(TAB_HEADERS.Settings, ['key', 'value', 'note']);
  });

  test('the live Sheet gains the six tabs, their dropdowns and the five Settings rows; existing tabs are untouched', async () => {
    const sheet = fakeSpreadsheet(live());
    const before = JSON.stringify([...sheet.tabs].filter(([t]) => !WAVE2_TABS.includes(t)));
    const lines = await run(sheet);
    assert.equal(JSON.stringify([...sheet.tabs].filter(([t]) => !WAVE2_TABS.includes(t))), before);
    for (const tab of WAVE2_TABS) assert.deepEqual(sheet.tabs.get(tab).values[0], [...TAB_HEADERS[tab]], tab);
    for (const tab of WAVE2_TABS.filter((t) => t !== 'Settings')) assert.equal(sheet.tabs.get(tab).values.length, 1, `${tab} is headers only`);
    assert.deepEqual(sheet.tabs.get('Settings').values.slice(1), [
      ['deposit_per_person', 300, 'Deposit per traveler when travelers pay individually (USD)'],
      ['deposit_per_group', 3000, 'Deposit when the organizer requests group payment (USD)'],
      ['balance_due_days_before', 60, 'Balance due this many days before the chosen week starts'],
      ['deposit_due_days', 7, 'Days after acceptance by which the deposit is due'],
      ['currency', 'USD', 'Ledger currency'],
    ]);
    const expected = {
      'Groups.stage': ['Inquiry', 'Planning', 'Proposal sent', 'Confirmed'],
      'GroupMembers.participation': ['Interested', 'Still deciding', 'Not attending'],
      'GroupMembers.invite_status': ['Not invited', 'Link shared', 'Responded', 'Invitation canceled'],
      'ConciergeRequests.status': ['Received', 'Checking options', 'Approval needed', 'Approved', 'Declined', 'Unavailable', 'Confirmed', 'Canceled'],
      'Proposals.status': ['draft', 'sent', 'accepted', 'declined'],
      'Payments.type': ['deposit', 'balance', 'refund'],
      'Payments.status': ['pending', 'paid', 'refunded', 'failed'],
    };
    for (const [name, values] of Object.entries(expected)) {
      const [tab, column] = name.split('.');
      const v = sheet.validations.find((x) => x.range.sheetId === sheet.tabs.get(tab).sheetId && x.range.startColumnIndex === TAB_HEADERS[tab].indexOf(column));
      assert.ok(v, name);
      assert.deepEqual(v.rule.condition.values.map((x) => x.userEnteredValue), values, name);
    }
    assert.ok(sheet.validations.every((v) => v.range.sheetId !== sheet.tabs.get('Settings').sheetId), 'no dropdowns on Settings');
    const text = lines.join('\n');
    assert.match(text, /Added tabs: Groups, GroupMembers, ConciergeRequests, Proposals, Payments, Settings\n/);
    assert.match(text, /Settings: seeded 5 rows/);
    for (const tab of WAVE2_TABS) assert.match(text, new RegExp(`\\n${tab} \\(${TAB_HEADERS[tab][0]}, `), `${tab} in the summary`);
  });

  test('Settings is seeded once: an edited value survives a second run, and a non-empty tab is never reseeded', async () => {
    const sheet = fakeSpreadsheet(live());
    await run(sheet);
    sheet.tabs.get('Settings').values[1][1] = 450;
    const lines = await run(sheet);
    assert.equal(sheet.tabs.get('Settings').values.length, 6);
    assert.equal(sheet.tabs.get('Settings').values[1][1], 450);
    assert.match(lines.join('\n'), /Settings: already has data, not seeded/);
  });
});

describe('loadDotEnv', () => {
  test('parses KEY=value lines, strips quotes, skips comments, never overrides existing env', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'courtside-env-'));
    try {
      const file = path.join(dir, '.env');
      fs.writeFileSync(file, [
        '# comment',
        'SHEET_ID=abc123',
        'export GOOGLE_SERVICE_ACCOUNT_EMAIL="sa@x.iam.gserviceaccount.com"',
        "GOOGLE_PRIVATE_KEY='-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n'",
        'EMPTY=',
        'ALREADY=from-file',
        'not a line',
        '',
      ].join('\n'));
      const env = { ALREADY: 'from-shell' };
      assert.equal(loadDotEnv(file, env), true);
      assert.equal(env.SHEET_ID, 'abc123');
      assert.equal(env.GOOGLE_SERVICE_ACCOUNT_EMAIL, 'sa@x.iam.gserviceaccount.com');
      assert.equal(env.GOOGLE_PRIVATE_KEY, '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n');
      assert.equal(env.EMPTY, '');
      assert.equal(env.ALREADY, 'from-shell');
      assert.equal('not' in env, false);
      assert.equal(loadDotEnv(path.join(dir, 'missing'), env), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
