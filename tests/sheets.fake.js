// tests/sheets.fake.js
// An in-memory stand-in for the raw Sheets client (lib/store.sheets.client.js createSheetsClient) that
// counts every request, for the quota tests. Not a test file itself (the npm test glob is
// tests/*.test.js). Cells come back as text, as values.get returns them; a range naming a tab the
// fake does not have fails with 400 like Google's "Unable to parse range".

import fs from 'node:fs';
import { TAB_HEADERS } from '../lib/store.columns.js';
import { SEED_PATH } from '../lib/store.mock.js';

// Every tab the store knows, and the seed.json section that fills it.
const SEEDED = { Trips: 'trips', Weeks: 'weeks', Invites: 'invites', Settings: 'settings' };

const RANGE = /^'((?:[^']|'')+)'!([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/;

function colIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function parseRange(range) {
  const m = RANGE.exec(range);
  if (!m) throw Object.assign(new Error(`fake sheets: bad range ${range}`), { status: 400 });
  return { tab: m[1].replace(/''/g, "'"), col: colIndex(m[2]), row: m[3] ? Number(m[3]) : 1 };
}

const cell = (v) => (v === undefined || v === null ? '' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v));

export function createFakeSheets({ tabs: only } = {}) {
  const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  const tabs = new Map();
  for (const [tab, headers] of Object.entries(TAB_HEADERS)) {
    if (only && !only.includes(tab)) continue;
    const rows = (seed[SEEDED[tab]] || []).map((r) => headers.map((h) => cell(r[h])));
    tabs.set(tab, [[...headers], ...rows]);
  }
  const log = [];
  // An optional hook run inside every read, after it is counted and before it answers (to make reads
  // slow, or to interleave other work).
  let onRead = null;

  function sheet(tab) {
    if (!tabs.has(tab)) throw Object.assign(new Error(`fake sheets: Unable to parse range: ${tab}`), { status: 400 });
    return tabs.get(tab);
  }
  const snapshot = (tab) => sheet(tab).map((r) => {
    const out = r.map(cell);
    while (out.length && out[out.length - 1] === '') out.pop(); // values.get drops trailing blanks
    return out;
  });
  function write(range, rows) {
    const { tab, col, row } = parseRange(range);
    const data = sheet(tab);
    rows.forEach((values, i) => {
      const r = row - 1 + i;
      while (data.length <= r) data.push([]);
      values.forEach((v, j) => { data[r][col + j] = cell(v); });
    });
  }

  const client = {
    sheetId: 'FAKE',
    async getValues(range) {
      log.push({ kind: 'get', ranges: [range] });
      if (onRead) await onRead('get', [range]);
      return { range, majorDimension: 'ROWS', values: snapshot(parseRange(range).tab) };
    },
    async batchGetValues(ranges) {
      log.push({ kind: 'batchGet', ranges: [...ranges] });
      if (onRead) await onRead('batchGet', ranges);
      const valueRanges = ranges.map((range) => ({ range, majorDimension: 'ROWS', values: snapshot(parseRange(range).tab) }));
      return { valueRanges };
    },
    async appendValues(range, rows) {
      log.push({ kind: 'append', ranges: [range] });
      const data = sheet(parseRange(range).tab);
      for (const values of rows) data.push(values.map(cell));
      return { updates: { updatedRows: rows.length } };
    },
    async updateValues(range, rows) {
      log.push({ kind: 'update', ranges: [range] });
      write(range, rows);
      return {};
    },
    async batchUpdateValues(data) {
      log.push({ kind: 'batchUpdateValues', ranges: data.map((d) => d.range) });
      for (const d of data) write(d.range, d.values);
      return {};
    },
    async getSpreadsheet() {
      log.push({ kind: 'spreadsheet', ranges: [] });
      return { sheets: [...tabs.keys()].map((title) => ({ properties: { title } })) };
    },
    async batchUpdate() {
      log.push({ kind: 'structure', ranges: [] });
      return {};
    },
  };

  const isRead = (e) => e.kind === 'get' || e.kind === 'batchGet' || e.kind === 'spreadsheet';
  return {
    client,
    tabs,
    log,
    set onRead(fn) { onRead = fn; },
    reads: () => log.filter(isRead).length,
    writes: () => log.filter((e) => !isRead(e)).length,
    reset: () => { log.length = 0; },
    // The data rows of a tab (header row excluded) as objects keyed by header.
    rows(tab) {
      const [headers, ...rest] = sheet(tab);
      return rest.map((r) => Object.fromEntries(headers.map((h, i) => [h, cell(r[i])])));
    },
  };
}
