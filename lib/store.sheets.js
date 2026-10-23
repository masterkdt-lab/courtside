// lib/store.sheets.js
// Google Sheets implementation of the store interface (plan 4.1).
//
// Reads use values.get on '<Tab>'!A1:ZZ and map the header row to objects, so column order in
// the Sheet does not matter as long as the headers match 4.2. Writes are values:append on
// Requests, Waitlist and Log, and one values:batchUpdate that touches exactly two cells of one
// Invites row (uses, last_used_at). Nothing else in the Sheet is ever edited.
//
// createSheetsStore({ sheetId, fetch, getToken, now }) builds an instance with injected pieces
// for unit tests (no network, no credentials). The named exports delegate to one default
// instance that reads SHEET_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY on first
// use; importing this module with those unset never throws, calling a method does, clearly.

import {
  TAB_HEADERS, parseSheetValues, toTrip, toWeek, toInvite, normalizeCode, recordToValues, str,
} from './store.columns.js';
import { createSheetsClient, tabRange, cellRange } from './store.sheets.client.js';

export function createSheetsStore(options = {}) {
  const client = options.client || createSheetsClient(options);
  const now = options.now || (() => new Date().toISOString());

  async function readTab(tab) {
    const res = await client.getValues(tabRange(tab));
    return parseSheetValues(res.values || []);
  }

  function findInviteRow(rows, code) {
    const wanted = normalizeCode(code);
    if (!wanted) return null;
    return rows.find((r) => normalizeCode(r.record.code) === wanted) || null;
  }

  async function findInvite(code) {
    if (!normalizeCode(code)) return null;
    const { rows } = await readTab('Invites');
    const hit = findInviteRow(rows, code);
    return hit ? toInvite(hit.record) : null;
  }

  // uses += 1, last_used_at = now, written to those two cells of the matching row only.
  // Returns the updated invite, or null when the code is unknown (nothing written).
  async function recordInviteUse(code) {
    if (!normalizeCode(code)) return null;
    const { headers, rows } = await readTab('Invites');
    const hit = findInviteRow(rows, code);
    if (!hit) return null;
    const usesCol = headers.indexOf('uses');
    const lastCol = headers.indexOf('last_used_at');
    if (usesCol < 0 || lastCol < 0) {
      throw new Error('Invites tab has no "uses" / "last_used_at" header row; run npm run setup-sheet');
    }
    const uses = (Number(str(hit.record.uses).trim()) || 0) + 1;
    const stamp = now();
    await client.batchUpdateValues([
      { range: cellRange('Invites', usesCol, hit.rowNumber), values: [[uses]] },
      { range: cellRange('Invites', lastCol, hit.rowNumber), values: [[stamp]] },
    ]);
    return toInvite({ ...hit.record, uses, last_used_at: stamp });
  }

  async function logAttempt({ code, result, ipHash } = {}) {
    const values = recordToValues(TAB_HEADERS.Log, { time: now(), code: str(code).trim(), result, ipHash });
    await client.appendValues(tabRange('Log', 'A1'), [values]);
  }

  async function listTrips() {
    const { rows } = await readTab('Trips');
    return rows.map((r) => toTrip(r.record));
  }

  async function listWeeks() {
    const { rows } = await readTab('Weeks');
    return rows.map((r) => toWeek(r.record));
  }

  // row: camelCase keys matching the Requests headers; the caller supplies requestId and
  // submittedAt. Written in exact 4.2 column order, "" for missing keys.
  async function appendRequest(row = {}) {
    const requestId = str(row.requestId).trim();
    if (!requestId) throw new Error('appendRequest: row.requestId is required (the API route generates it)');
    await client.appendValues(tabRange('Requests', 'A1'), [recordToValues(TAB_HEADERS.Requests, row)]);
    return { requestId };
  }

  // row: camelCase keys matching the Waitlist headers (timestamp, email, name, trip, source);
  // the caller supplies the timestamp and the trip's display name. Written in header order.
  async function appendWaitlist(row = {}) {
    const email = str(row.email).trim();
    if (!email) throw new Error('appendWaitlist: row.email is required (the API route validates it)');
    await client.appendValues(tabRange('Waitlist', 'A1'), [recordToValues(TAB_HEADERS.Waitlist, row)]);
    return { email, trip: str(row.trip) };
  }

  return { findInvite, recordInviteUse, logAttempt, listTrips, listWeeks, appendRequest, appendWaitlist };
}

let defaultStore = null;
function store() {
  if (!defaultStore) defaultStore = createSheetsStore();
  return defaultStore;
}

export const findInvite = (code) => store().findInvite(code);
export const recordInviteUse = (code) => store().recordInviteUse(code);
export const logAttempt = (attempt) => store().logAttempt(attempt);
export const listTrips = () => store().listTrips();
export const listWeeks = () => store().listWeeks();
export const appendRequest = (row) => store().appendRequest(row);
export const appendWaitlist = (row) => store().appendWaitlist(row);
