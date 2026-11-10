// lib/store.sheets.js
// Google Sheets implementation of the store interface (plan 4.1).
//
// Reads use values.get on '<Tab>'!A1:ZZ (inside an API request: one values:batchGet of
// SNAPSHOT_TABS, see readTab below) and map the header row to objects, so column order in
// the Sheet does not matter as long as the headers match 4.2. Writes are values:append on
// Requests, Waitlist, HostApplications, Log and the Wave 2 tabs, one values:batchUpdate that touches
// exactly two cells of one Invites row (uses, last_used_at), and one values.update per Wave 2
// update-by-id that rewrites exactly one row of Groups, GroupMembers, ConciergeRequests or
// Proposals. Nothing else in the Sheet is ever edited and nothing is ever deleted.
//
// createSheetsStore({ sheetId, fetch, getToken, now }) builds an instance with injected pieces
// for unit tests (no network, no credentials). The named exports delegate to one default
// instance that reads SHEET_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY on first
// use; importing this module with those unset never throws, calling a method does, clearly.

import {
  TAB_HEADERS, ID_COLUMNS, NUMERIC_COLUMNS, WAVE2_MAPPERS, parseSheetValues, toTrip, toWeek, toInvite, normalizeCode, recordToValues,
  applyPatch, str,
} from './store.columns.js';
import { createSheetsClient, tabRange, tabOfRange, cellRange, columnLetter } from './store.sheets.client.js';
import { currentScope } from './request-scope.js';

// The tabs the store reads, fetched together in one values:batchGet the first time a request (a
// lib/request-scope.js scope) reads any of them. The append-only Requests, Waitlist, HostApplications
// and Log tabs are never read by the site and stay out.
export const SNAPSHOT_TABS = Object.freeze([
  'Trips', 'Weeks', 'Settings', 'Invites', 'Groups', 'GroupMembers', 'ConciergeRequests', 'Proposals', 'Payments',
]);

export function createSheetsStore(options = {}) {
  const raw = options.client || createSheetsClient(options);
  const now = options.now || (() => new Date().toISOString());

  // Reads and Google's quota (60 reads a minute for the service account).
  //
  // Inside a request scope (lib/request-scope.js, which wraps every api GET/POST) the first readTab
  // of any SNAPSHOT_TABS tab fetches all of them in ONE values:batchGet, and every later read in that
  // request is served from that snapshot; a tab outside the set is read singly and kept too. A write
  // to a tab drops it from the snapshot (before and after the write), so a later read in the same
  // request fetches that tab fresh: update-by-id always finds row numbers in data that reflects the
  // request's earlier writes. The snapshot lives and dies with the request, so nothing is ever served
  // to another request; concurrent requests each get their own.
  //
  // Outside a scope (scripts, tests calling the store directly) nothing changed: each API route runs
  // as its own function with its own memory, so a cache in one route can never be cleared by a write
  // in another, and guest data is therefore never cached across requests. Only reads already in
  // flight are shared, and a write drops those too. Weeks and Trips, which only Courtside edits in the
  // Sheet, are reused for a few seconds. Off for injected clients (unit tests) unless asked.
  const cacheMs = options.readCacheMs ?? (options.client || options.fetch ? 0 : 3000);
  const CACHEABLE = new Set(['Weeks', 'Trips']);
  const cache = new Map();
  const clearCache = () => { for (const [tab] of cache) if (!CACHEABLE.has(tab)) cache.delete(tab); };

  const scopeKey = {}; // this instance's slot in a request scope (tests build several instances)
  function snapshot() {
    const scope = currentScope();
    if (!scope) return null;
    let snap = scope.sheets.get(scopeKey);
    if (!snap) {
      snap = { tabs: new Map(), bundle: null, bundleFailed: false, written: new Set() };
      scope.sheets.set(scopeKey, snap);
    }
    return snap;
  }
  // tabs: the tabs a write touches, or null when it may touch any (a structural batchUpdate).
  function forget(tabs) {
    const snap = snapshot();
    if (!snap) return;
    for (const tab of tabs || [...SNAPSHOT_TABS, ...snap.tabs.keys()]) {
      snap.tabs.delete(tab);
      snap.written.add(tab);
    }
  }
  const wrapWrite = (fn, tabsOf) => async (...a) => {
    const tabs = tabsOf(...a);
    clearCache();
    forget(tabs);
    try { return await fn(...a); } finally { clearCache(); forget(tabs); }
  };
  const tabsOfRange = (range) => { const tab = tabOfRange(range); return tab ? [tab] : null; };
  const tabsOfData = (data = []) => { const tabs = data.map((d) => tabOfRange(d.range)); return tabs.includes(null) ? null : tabs; };
  const client = {
    get sheetId() { return raw.sheetId; },
    getValues: (...a) => raw.getValues(...a),
    batchGetValues: (...a) => raw.batchGetValues(...a),
    getSpreadsheet: (...a) => raw.getSpreadsheet(...a),
    batchUpdate: wrapWrite((...a) => raw.batchUpdate(...a), () => null),
    appendValues: wrapWrite((...a) => raw.appendValues(...a), tabsOfRange),
    updateValues: wrapWrite((...a) => raw.updateValues(...a), tabsOfRange),
    batchUpdateValues: wrapWrite((...a) => raw.batchUpdateValues(...a), tabsOfData),
  };

  const parseRange = (vr) => parseSheetValues((vr && vr.values) || []);
  const readSingle = (tab) => client.getValues(tabRange(tab)).then(parseRange);

  function keep(snap, tab, promise) {
    snap.tabs.set(tab, promise);
    promise.catch(() => { if (snap.tabs.get(tab) === promise) snap.tabs.delete(tab); });
    return promise;
  }

  function readScoped(snap, tab) {
    const hit = snap.tabs.get(tab);
    if (hit) return hit;
    const index = SNAPSHOT_TABS.indexOf(tab);
    // Written in this request (or the batchGet is unusable): this tab alone, fresh.
    if (index < 0 || snap.written.has(tab) || snap.bundleFailed) return keep(snap, tab, readSingle(tab));
    if (!snap.bundle) {
      snap.bundle = client.batchGetValues(SNAPSHOT_TABS.map((t) => tabRange(t)));
      snap.bundle.catch(() => {});
    }
    const bundle = snap.bundle;
    return keep(snap, tab, bundle.then(
      (res) => parseRange((res.valueRanges || [])[index]),
      (err) => {
        if (snap.bundle === bundle) snap.bundle = null; // a later read in this request may try again
        // 400 is Google's "Unable to parse range": a tab of the set is missing from this Sheet. Fall
        // back to single reads for this request rather than failing routes that never needed it.
        if (err && err.status === 400) { snap.bundleFailed = true; return readSingle(tab); }
        throw err;
      },
    ));
  }

  async function readTab(tab) {
    const snap = snapshot();
    if (snap) return readScoped(snap, tab);
    if (!cacheMs) return parseSheetValues((await client.getValues(tabRange(tab))).values || []);
    const hit = cache.get(tab);
    if (hit && (hit.pending || Date.now() - hit.at < cacheMs)) return hit.promise;
    const entry = { at: Date.now(), pending: true };
    entry.promise = client.getValues(tabRange(tab)).then((res) => parseSheetValues(res.values || []));
    cache.set(tab, entry);
    entry.promise.then(
      () => { entry.pending = false; entry.at = Date.now(); if (!CACHEABLE.has(tab) && cache.get(tab) === entry) cache.delete(tab); },
      () => { if (cache.get(tab) === entry) cache.delete(tab); },
    );
    return entry.promise;
  }

  // The member check behind every protected route. In a request scope both tabs come from the
  // request's snapshot; outside one, the member row and the group row in one values:batchGet, so it
  // costs one read against the quota instead of two.
  async function getMemberAndGroup(memberId, groupId) {
    if (!str(memberId).trim() || !str(groupId).trim()) return { member: null, group: null };
    let m;
    let g;
    if (snapshot()) {
      [m, g] = await Promise.all([readTab('GroupMembers'), readTab('Groups')]);
    } else {
      const res = await client.batchGetValues([tabRange('GroupMembers'), tabRange('Groups')]);
      [m, g] = (res.valueRanges || []).map(parseRange);
    }
    const mHit = m && findRowById('GroupMembers', m.headers, m.rows, memberId);
    const gHit = g && findRowById('Groups', g.headers, g.rows, groupId);
    return {
      member: mHit ? WAVE2_MAPPERS.GroupMembers(mHit.record) : null,
      group: gHit ? WAVE2_MAPPERS.Groups(gHit.record) : null,
    };
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

  // row: camelCase keys matching the HostApplications headers; the caller supplies the timestamp.
  // Written in header order, "" for missing keys.
  async function appendHostApplication(row = {}) {
    const email = str(row.email).trim();
    if (!email) throw new Error('appendHostApplication: row.email is required (the API route validates it)');
    await client.appendValues(tabRange('HostApplications', 'A1'), [recordToValues(TAB_HEADERS.HostApplications, row)]);
    return { email };
  }

  // Wave 2 (CONCEPT02_WAVE2_PLAN.md section 6 "Store") -------------------------------------
  // Appends are values:append in header order. An update reads the tab, finds the one row whose id
  // column holds the id, and values.update()s exactly that row's range (A<row>:<last><row>) with the
  // existing cells plus the patched columns (and updated_at where the tab has it). The Sheet's own
  // header row decides column positions, so a reordered column is fine; a missing id header is a
  // clear setup-sheet error. Other rows are never touched and nothing is ever deleted.

  async function appendRow(tab, row, idKey) {
    const id = str(row[idKey]).trim();
    if (!id) throw new Error(`append${tab}: row.${idKey} is required (the API route generates it)`);
    const values = recordToValues(TAB_HEADERS[tab], row);
    await client.appendValues(tabRange(tab, 'A1'), [values]);
    return WAVE2_MAPPERS[tab](Object.fromEntries(TAB_HEADERS[tab].map((h, i) => [h, values[i]])));
  }

  function findRowById(tab, headers, rows, id) {
    const column = ID_COLUMNS[tab];
    if (!headers.includes(column)) throw new Error(`${tab} tab has no "${column}" header row; run npm run setup-sheet`);
    const wanted = str(id).trim();
    if (!wanted) return null;
    return rows.find((r) => str(r.record[column]).trim() === wanted) || null;
  }

  async function getRow(tab, id) {
    if (!str(id).trim()) return null;
    const { headers, rows } = await readTab(tab);
    const hit = findRowById(tab, headers, rows, id);
    return hit ? WAVE2_MAPPERS[tab](hit.record) : null;
  }

  // Cells the Sheet returned as text, back to numbers in the numeric columns, so a rewritten row
  // keeps 2995 a number rather than the text "2995".
  function cellForWrite(tab, header, value) {
    if (NUMERIC_COLUMNS[tab]?.includes(header) && typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value);
    return value;
  }

  async function updateRow(tab, id, patch) {
    if (!str(id).trim()) return null;
    const { headers, rows } = await readTab(tab);
    const hit = findRowById(tab, headers, rows, id);
    if (!hit) return null;
    const merged = applyPatch(tab, hit.record, patch, now());
    const values = headers.map((h) => cellForWrite(tab, h, merged[h] === undefined || merged[h] === null ? '' : merged[h]));
    const range = `${tabRange(tab, `A${hit.rowNumber}`)}:${columnLetter(headers.length - 1)}${hit.rowNumber}`;
    await client.updateValues(range, [values]);
    return WAVE2_MAPPERS[tab](merged);
  }

  async function listRows(tab, column, value) {
    const wanted = str(value).trim();
    const { rows } = await readTab(tab);
    const hits = column ? rows.filter((r) => str(r.record[column]).trim() === wanted) : rows;
    return hits.map((r) => WAVE2_MAPPERS[tab](r.record));
  }

  const getGroup = (groupId) => getRow('Groups', groupId);
  const appendGroup = (row = {}) => appendRow('Groups', row, 'groupId');
  const updateGroup = (groupId, patch = {}) => updateRow('Groups', groupId, patch);
  const listMembers = async (groupId) => (str(groupId).trim() ? listRows('GroupMembers', 'group_id', groupId) : []);
  const getMember = (memberId) => getRow('GroupMembers', memberId);
  const appendMember = (row = {}) => appendRow('GroupMembers', row, 'memberId');
  const updateMember = (memberId, patch = {}) => updateRow('GroupMembers', memberId, patch);
  const listConcierge = async (groupId) => (str(groupId).trim() ? listRows('ConciergeRequests', 'group_id', groupId) : []);
  const getConcierge = (conciergeId) => getRow('ConciergeRequests', conciergeId);
  const appendConcierge = (row = {}) => appendRow('ConciergeRequests', row, 'conciergeId');
  const updateConcierge = (conciergeId, patch = {}) => updateRow('ConciergeRequests', conciergeId, patch);
  const getProposalForMember = async (memberId) => (str(memberId).trim() ? (await listRows('Proposals', 'member_id', memberId))[0] || null : null);
  const appendProposal = (row = {}) => appendRow('Proposals', row, 'proposalId');
  const updateProposal = (proposalId, patch = {}) => updateRow('Proposals', proposalId, patch);
  const listPayments = async (groupId) => (str(groupId).trim() ? listRows('Payments', 'group_id', groupId) : []);
  const appendPayment = (row = {}) => appendRow('Payments', row, 'paymentId');
  const listSettings = () => listRows('Settings');

  return {
    findInvite, recordInviteUse, logAttempt, listTrips, listWeeks, appendRequest, appendWaitlist, appendHostApplication,
    getGroup, appendGroup, updateGroup, listMembers, getMember, getMemberAndGroup, appendMember, updateMember,
    listConcierge, getConcierge, appendConcierge, updateConcierge, getProposalForMember, appendProposal, updateProposal,
    listPayments, appendPayment, listSettings,
  };
}

let defaultStore = null;
function store() {
  if (!defaultStore) defaultStore = createSheetsStore();
  return defaultStore;
}

// Tests only: route the named exports (what lib/store.js calls with DATA_BACKEND=sheets) through an
// instance built with an injected client; null goes back to the env-configured default.
export function _setDefaultSheetsStore(instance) {
  defaultStore = instance || null;
}

export const findInvite = (code) => store().findInvite(code);
export const recordInviteUse = (code) => store().recordInviteUse(code);
export const logAttempt = (attempt) => store().logAttempt(attempt);
export const listTrips = () => store().listTrips();
export const listWeeks = () => store().listWeeks();
export const appendRequest = (row) => store().appendRequest(row);
export const appendWaitlist = (row) => store().appendWaitlist(row);
export const appendHostApplication = (row) => store().appendHostApplication(row);
export const getGroup = (groupId) => store().getGroup(groupId);
export const appendGroup = (row) => store().appendGroup(row);
export const updateGroup = (groupId, patch) => store().updateGroup(groupId, patch);
export const listMembers = (groupId) => store().listMembers(groupId);
export const getMember = (memberId) => store().getMember(memberId);
export const getMemberAndGroup = (memberId, groupId) => store().getMemberAndGroup(memberId, groupId);
export const appendMember = (row) => store().appendMember(row);
export const updateMember = (memberId, patch) => store().updateMember(memberId, patch);
export const listConcierge = (groupId) => store().listConcierge(groupId);
export const getConcierge = (conciergeId) => store().getConcierge(conciergeId);
export const appendConcierge = (row) => store().appendConcierge(row);
export const updateConcierge = (conciergeId, patch) => store().updateConcierge(conciergeId, patch);
export const getProposalForMember = (memberId) => store().getProposalForMember(memberId);
export const appendProposal = (row) => store().appendProposal(row);
export const updateProposal = (proposalId, patch) => store().updateProposal(proposalId, patch);
export const listPayments = (groupId) => store().listPayments(groupId);
export const appendPayment = (row) => store().appendPayment(row);
export const listSettings = () => store().listSettings();
