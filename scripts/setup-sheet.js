#!/usr/bin/env node
// scripts/setup-sheet.js
// Prepares Katie's Google Sheet (plan 4.2; polish brief section 3 adds the Waitlist tab;
// CONCEPT02_PLAN.md adds the HostApplications tab). Idempotent: run it as often as needed, including
// on a Sheet set up before the Waitlist or HostApplications tab existed; it adds the missing tab
// with its headers and changes nothing else.
//
//   1. adds any missing tabs: Trips, Weeks, Requests, Invites, Log, Waitlist, HostApplications
//   2. writes the exact header row (row 1) on each tab
//   3. sets dropdown validation (strict, one of list) on Trips.status, Weeks.status,
//      Requests.status, Requests.request_type and Invites.status (none on Waitlist or HostApplications)
//   4. seeds Trips and Weeks from tests/fixtures/seed.json, only when those tabs have no data rows
//   5. never seeds Invites; prints an example Invites row for Katie instead
//   6. never seeds Waitlist; the site fills it through POST /api/waitlist
//   7. never seeds HostApplications; the #/application form fills it through POST /api/application
//
// Needs SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY, from .env or the shell,
// and the Sheet shared with the service account as Editor.
//
//   npm run setup-sheet

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TAB_HEADERS, TAB_NAMES, DROPDOWNS, toCellValue, str } from '../lib/store.columns.js';
import { createSheetsClient, missingEnv, tabRange } from '../lib/store.sheets.client.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED_PATH = path.join(ROOT, 'tests', 'fixtures', 'seed.json');

export const EXAMPLE_INVITE = Object.freeze([
  'GUEST1', 'Ana Guest', 'ana.guest@example.com', '+1 555 0100', 'Katie', '', 0, 'active', '2026-10-05T00:00:00Z', '',
]);

// Minimal .env loader (no dotenv): sets keys that are not already in the environment.
// Handles KEY=value, optional "export ", surrounding quotes and # comment lines.
export function loadDotEnv(file = path.join(ROOT, '.env'), env = process.env) {
  if (!fs.existsSync(file)) return false;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    if (env[match[1]] === undefined) env[match[1]] = value;
  }
  return true;
}

function dataRows(values) {
  return values.slice(1).filter((cells) => cells && cells.some((v) => str(v).trim() !== ''));
}

function sameHeaders(current, expected) {
  const trimmed = current.map((h) => str(h).trim());
  while (trimmed.length && trimmed[trimmed.length - 1] === '') trimmed.pop();
  return trimmed.length === expected.length && expected.every((h, i) => trimmed[i] === h);
}

async function listSheetIds(client) {
  const meta = await client.getSpreadsheet('sheets.properties(sheetId,title)');
  return new Map((meta.sheets || []).map((s) => [s.properties.title, s.properties.sheetId]));
}

// The whole procedure, with the client and seed injected so it can run against a stub.
export async function runSetup({ client, seed, log = console.log }) {
  // 1. tabs
  const sheetIds = await listSheetIds(client);
  const missing = TAB_NAMES.filter((tab) => !sheetIds.has(tab));
  if (missing.length) {
    const res = await client.batchUpdate(missing.map((title) => ({ addSheet: { properties: { title } } })));
    for (const reply of res.replies || []) {
      const props = reply && reply.addSheet && reply.addSheet.properties;
      if (props && props.title) sheetIds.set(props.title, props.sheetId);
    }
    if (TAB_NAMES.some((tab) => sheetIds.get(tab) === undefined)) {
      for (const [title, id] of await listSheetIds(client)) sheetIds.set(title, id);
    }
    log(`Added tabs: ${missing.join(', ')}`);
  } else {
    log(`Tabs present: ${TAB_NAMES.join(', ')}`);
  }

  // 2. headers (and remember which tabs already hold data, for step 4)
  const hasData = {};
  for (const tab of TAB_NAMES) {
    const expected = TAB_HEADERS[tab];
    const values = (await client.getValues(tabRange(tab))).values || [];
    hasData[tab] = dataRows(values).length > 0;
    const current = values[0] || [];
    if (sameHeaders(current, expected)) {
      log(`${tab}: headers ok`);
      continue;
    }
    if (current.some((v) => str(v).trim() !== '')) {
      log(`${tab}: row 1 was [${current.map(str).join(', ')}]; replacing it with the Phase 1 headers`);
    }
    await client.updateValues(tabRange(tab, 'A1'), [[...expected]]);
    log(`${tab}: wrote headers`);
  }

  // 3. dropdowns (rows 2 to the end of each column)
  const validation = DROPDOWNS.map(({ tab, column, values }) => {
    const col = TAB_HEADERS[tab].indexOf(column);
    return {
      setDataValidation: {
        range: { sheetId: sheetIds.get(tab), startRowIndex: 1, startColumnIndex: col, endColumnIndex: col + 1 },
        rule: {
          condition: { type: 'ONE_OF_LIST', values: values.map((v) => ({ userEnteredValue: v })) },
          strict: true,
          showCustomUi: true,
        },
      },
    };
  });
  await client.batchUpdate(validation);
  log(`Dropdowns set: ${DROPDOWNS.map((d) => `${d.tab}.${d.column}`).join(', ')}`);

  // 4. seed Trips and Weeks when empty
  for (const [tab, key] of [['Trips', 'trips'], ['Weeks', 'weeks']]) {
    const rows = Array.isArray(seed[key]) ? seed[key] : [];
    if (hasData[tab]) {
      log(`${tab}: already has data, not seeded`);
      continue;
    }
    if (!rows.length) {
      log(`${tab}: nothing to seed`);
      continue;
    }
    await client.appendValues(tabRange(tab, 'A1'), rows.map((r) => TAB_HEADERS[tab].map((h) => toCellValue(r[h]))));
    log(`${tab}: seeded ${rows.length} row${rows.length === 1 ? '' : 's'}`);
  }

  // 5. example invite
  log('');
  log('Invites is never seeded; Katie adds one row per guest. Example row (tab-separated, paste into row 2):');
  log(TAB_HEADERS.Invites.join('\t'));
  log(EXAMPLE_INVITE.map(str).join('\t'));
  log('max_uses blank = unlimited. status: active, paused or revoked. uses and last_used_at are kept by the site.');

  // 6. the Waitlist tab
  log('');
  log(`Waitlist (${TAB_HEADERS.Waitlist.join(', ')}) is filled by the site's waitlist forms; headers only, nothing to seed, no dropdowns.`);
  log('trip is the trip name from public/js/trips.js, "General", or the interest text; source is card, footer, concept02-waitlist or concept02-home.');

  // 7. the HostApplications tab
  log('');
  log(`HostApplications (${TAB_HEADERS.HostApplications.join(', ')}) is filled by the #/application host form; headers only, nothing to seed, no dropdowns.`);
}

async function main() {
  loadDotEnv();
  const missing = missingEnv();
  if (missing.length) {
    console.error(`setup-sheet: missing ${missing.join(', ')}.`);
    console.error('Add them to .env (copy .env.example) or export them in the shell, then run npm run setup-sheet again.');
    process.exit(1);
  }
  const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  const client = createSheetsClient();
  console.log(`Setting up sheet ${client.sheetId} as ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL.trim()}`);
  await runSetup({ client, seed });
  console.log('');
  console.log('Done. Set DATA_BACKEND=sheets to use the Sheet.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`setup-sheet failed: ${err.message}`);
    if (/ 403\b/.test(err.message)) console.error('403 usually means the Sheet is not shared with GOOGLE_SERVICE_ACCOUNT_EMAIL as Editor.');
    if (/ 404\b/.test(err.message)) console.error('404 usually means SHEET_ID is wrong; it is the long id between /d/ and /edit in the Sheet URL.');
    process.exit(1);
  });
}
