#!/usr/bin/env node
// scripts/setup-soft-launch.js — creates the "Soft Launch" tab (2026-11-23) and the "Private Groups" tab (2026-11-24)
// in the Courtside Sheet.
//   node scripts/setup-soft-launch.js            create both tabs with their header rows if missing (safe to re-run)
//   node scripts/setup-soft-launch.js --counts   print the row count of every tab (to check a test touched only this one)
//   node scripts/setup-soft-launch.js --delete-email <email> [--tab "Private Groups"]
//                                                delete that tab's rows (default Soft Launch) with that exact email (test cleanup only)
// Touches no other tab. Credentials come from .env like scripts/setup-sheet.js (SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL,
// GOOGLE_PRIVATE_KEY).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOFT_LAUNCH_HEADERS, SOFT_LAUNCH_TAB, PRIVATE_GROUPS_HEADERS, PRIVATE_GROUPS_TAB } from '../lib/store.columns.js';

const TABS = [[SOFT_LAUNCH_TAB, SOFT_LAUNCH_HEADERS], [PRIVATE_GROUPS_TAB, PRIVATE_GROUPS_HEADERS]];
import { createSheetsClient, missingEnv, tabRange } from '../lib/store.sheets.client.js';
import { loadDotEnv } from './setup-sheet.js';

async function sheetIds(client) {
  const meta = await client.getSpreadsheet('sheets.properties(sheetId,title)');
  return new Map((meta.sheets || []).map((s) => [s.properties.title, s.properties.sheetId]));
}

async function ensureTab(client, TAB, HEADERS) {
  const ids = await sheetIds(client);
  if (!ids.has(TAB)) {
    await client.batchUpdate([{ addSheet: { properties: { title: TAB, gridProperties: { frozenRowCount: 1 } } } }]);
    console.log(`Added tab "${TAB}".`);
  } else {
    console.log(`Tab "${TAB}" already exists.`);
  }
  const current = await client.getValues(tabRange(TAB, `A1:${String.fromCharCode(64 + HEADERS.length)}1`));
  const header = (current.values && current.values[0]) || [];
  if (header.join('|') !== HEADERS.join('|')) {
    await client.updateValues(tabRange(TAB, `A1:${String.fromCharCode(64 + HEADERS.length)}1`), [HEADERS.slice()]);
    const sheetId = (await sheetIds(client)).get(TAB);
    await client.batchUpdate([{
      repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' },
    }]);
    console.log(`Header row: ${HEADERS.join(' | ')}`);
  }
}

async function counts(client) {
  const ids = await sheetIds(client);
  const out = {};
  for (const title of ids.keys()) {
    const res = await client.getValues(tabRange(title, 'A1:A'));
    out[title] = (res.values || []).length;
  }
  console.log(JSON.stringify(out));
}

async function deleteEmail(client, email, TAB = SOFT_LAUNCH_TAB) {
  const res = await client.getValues(tabRange(TAB, 'A1:Z'));
  const rows = res.values || [];
  const hits = [];
  const col = Math.max(0, (rows[0] || []).indexOf('Email')); // the Email column, found by its header
  rows.forEach((r, i) => { if (i > 0 && String(r[col] || '').trim().toLowerCase() === email.toLowerCase()) hits.push(i); });
  if (!hits.length) { console.log('No rows with that email.'); return; }
  const sheetId = (await sheetIds(client)).get(TAB);
  // bottom-up so earlier indexes stay valid
  await client.batchUpdate(hits.reverse().map((i) => ({ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: i, endIndex: i + 1 } } })));
  console.log(`Deleted ${hits.length} row(s) from "${TAB}".`);
}

async function main() {
  loadDotEnv();
  const missing = missingEnv();
  if (missing.length) {
    console.error(`setup-soft-launch: missing ${missing.join(', ')}.`);
    process.exit(1);
  }
  const client = createSheetsClient();
  const args = process.argv.slice(2);
  if (args[0] === '--counts') return counts(client);
  if (args[0] === '--delete-email') return deleteEmail(client, String(args[1] || ''), args[2] === '--tab' ? String(args[3] || '') : SOFT_LAUNCH_TAB);
  for (const [tab, headers] of TABS) await ensureTab(client, tab, headers);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`setup-soft-launch failed: ${err.message}`);
    process.exit(1);
  });
}
