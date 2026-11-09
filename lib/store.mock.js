// lib/store.mock.js
// JSON-file implementation of the store interface (plan 4.1) for local dev and tests.
//
// The file mirrors the Sheet one-to-one: { trips, weeks, invites, requests, log, waitlist,
// host_applications, groups, group_members, concierge_requests, proposals, payments, settings },
// each an array of rows keyed by the snake_case headers from plan 4.2 and CONCEPT02_WAVE2_PLAN.md (so a
// Requests row has request_id, submitted_at, ... and a Log row has time, code, result, ip_hash). It is created from
// tests/fixtures/seed.json on first use and lives at .data/mock.json (git-ignored) unless
// MOCK_DATA_PATH points elsewhere; tests give every test its own temp file that way. A file written
// before a section existed gains it, empty, on the next read (Settings then falls back to the
// defaults in lib/settings.js).
//
// Every method reads the file fresh and writes it back with synchronous fs calls (atomic
// rename), so there is no in-memory cache and a dev server and a test never see stale state.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TAB_HEADERS, ID_COLUMNS, WAVE2_MAPPERS, requestRowToValues, waitlistRowToValues, hostApplicationRowToValues, recordToValues, valuesToRecord,
  toTrip, toWeek, toInvite, normalizeCode, applyPatch, str,
} from './store.columns.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SEED_PATH = path.join(ROOT, 'tests', 'fixtures', 'seed.json');
// Wave 2 tabs and the snake_case section each one lives under in the mock file.
export const WAVE2_SECTIONS = Object.freeze({
  Groups: 'groups',
  GroupMembers: 'group_members',
  ConciergeRequests: 'concierge_requests',
  Proposals: 'proposals',
  Payments: 'payments',
  Settings: 'settings',
});
const SECTIONS = ['trips', 'weeks', 'invites', 'requests', 'log', 'waitlist', 'host_applications', ...Object.values(WAVE2_SECTIONS)];

// Resolved on every call so tests can point each test at a fresh file via process.env.
export function mockDataPath(env = process.env) {
  const custom = str(env.MOCK_DATA_PATH).trim();
  return custom ? path.resolve(custom) : path.join(ROOT, '.data', 'mock.json');
}

function readSeed() {
  return JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
}

function writeFile(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function load() {
  const file = mockDataPath();
  if (!fs.existsSync(file)) {
    const seed = readSeed();
    const fresh = {};
    for (const section of SECTIONS) fresh[section] = Array.isArray(seed[section]) ? seed[section] : [];
    writeFile(file, fresh);
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const section of SECTIONS) if (!Array.isArray(data[section])) data[section] = [];
  return data;
}

function save(data) {
  writeFile(mockDataPath(), data);
}

function findInviteRow(invites, code) {
  const wanted = normalizeCode(code);
  if (!wanted) return null;
  return invites.find((row) => normalizeCode(row.code) === wanted) || null;
}

// Store interface ---------------------------------------------------------------------------

export async function findInvite(code) {
  const row = findInviteRow(load().invites, code);
  return row ? toInvite(row) : null;
}

// uses += 1, last_used_at = now. Returns the updated invite, or null when the code is unknown.
export async function recordInviteUse(code) {
  const data = load();
  const row = findInviteRow(data.invites, code);
  if (!row) return null;
  row.uses = (Number(str(row.uses).trim()) || 0) + 1;
  row.last_used_at = new Date().toISOString();
  save(data);
  return toInvite(row);
}

export async function logAttempt({ code, result, ipHash } = {}) {
  const data = load();
  const values = recordToValues(TAB_HEADERS.Log, {
    time: new Date().toISOString(),
    code: str(code).trim(),
    result,
    ipHash,
  });
  data.log.push(valuesToRecord(TAB_HEADERS.Log, values));
  save(data);
}

export async function listTrips() {
  return load().trips.map(toTrip);
}

export async function listWeeks() {
  return load().weeks.map(toWeek);
}

// row: camelCase keys matching the Requests headers (requestId, submittedAt, tripId, ...).
// The caller supplies requestId and submittedAt. Missing keys are written as "".
export async function appendRequest(row = {}) {
  const requestId = str(row.requestId).trim();
  if (!requestId) throw new Error('appendRequest: row.requestId is required (the API route generates it)');
  const data = load();
  data.requests.push(valuesToRecord(TAB_HEADERS.Requests, requestRowToValues(row)));
  save(data);
  return { requestId };
}

// row: camelCase keys matching the Waitlist headers (timestamp, email, name, trip, source). The
// caller (api/waitlist.js) supplies the timestamp and the trip's display name. Missing keys are "".
export async function appendWaitlist(row = {}) {
  const email = str(row.email).trim();
  if (!email) throw new Error('appendWaitlist: row.email is required (the API route validates it)');
  const data = load();
  data.waitlist.push(valuesToRecord(TAB_HEADERS.Waitlist, waitlistRowToValues(row)));
  save(data);
  return { email, trip: str(row.trip) };
}

// row: camelCase keys matching the HostApplications headers (timestamp, name, email, club,
// referral, background, community, destination). The caller (api/application.js) supplies the
// timestamp. Missing keys are "".
export async function appendHostApplication(row = {}) {
  const email = str(row.email).trim();
  if (!email) throw new Error('appendHostApplication: row.email is required (the API route validates it)');
  const data = load();
  data.host_applications.push(valuesToRecord(TAB_HEADERS.HostApplications, hostApplicationRowToValues(row)));
  save(data);
  return { email };
}

// Wave 2 (CONCEPT02_WAVE2_PLAN.md section 6 "Store") ---------------------------------------
// Rows are stored under their snake_case headers like every other section; the mappers in
// store.columns.js turn them into the camelCase objects the routes use. Appends require the id;
// updates find the row by its id column, change only the patched columns plus updated_at (where
// the tab has it) and return the updated row, or null when the id is unknown (nothing written).

function appendRow(tab, row, idKey) {
  const id = str(row[idKey]).trim();
  if (!id) throw new Error(`append${tab}: row.${idKey} is required (the API route generates it)`);
  const data = load();
  const record = valuesToRecord(TAB_HEADERS[tab], recordToValues(TAB_HEADERS[tab], row));
  data[WAVE2_SECTIONS[tab]].push(record);
  save(data);
  return WAVE2_MAPPERS[tab](record);
}

function findRow(rows, tab, id) {
  const wanted = str(id).trim();
  if (!wanted) return null;
  return rows.find((row) => str(row[ID_COLUMNS[tab]]).trim() === wanted) || null;
}

function updateRow(tab, id, patch) {
  const data = load();
  const rows = data[WAVE2_SECTIONS[tab]];
  const index = rows.indexOf(findRow(rows, tab, id));
  if (index < 0) return null;
  rows[index] = applyPatch(tab, rows[index], patch);
  save(data);
  return WAVE2_MAPPERS[tab](rows[index]);
}

function getRow(tab, id) {
  const row = findRow(load()[WAVE2_SECTIONS[tab]], tab, id);
  return row ? WAVE2_MAPPERS[tab](row) : null;
}

function listRows(tab, column, value) {
  const wanted = str(value).trim();
  const rows = load()[WAVE2_SECTIONS[tab]];
  return (wanted ? rows.filter((row) => str(row[column]).trim() === wanted) : rows).map(WAVE2_MAPPERS[tab]);
}

export async function getGroup(groupId) { return getRow('Groups', groupId); }
export async function appendGroup(row = {}) { return appendRow('Groups', row, 'groupId'); }
export async function updateGroup(groupId, patch = {}) { return updateRow('Groups', groupId, patch); }

// Every member of the group, removed ones included (the routes filter).
export async function listMembers(groupId) { return str(groupId).trim() ? listRows('GroupMembers', 'group_id', groupId) : []; }
export async function getMember(memberId) { return getRow('GroupMembers', memberId); }
export async function appendMember(row = {}) { return appendRow('GroupMembers', row, 'memberId'); }
export async function updateMember(memberId, patch = {}) { return updateRow('GroupMembers', memberId, patch); }

export async function listConcierge(groupId) { return str(groupId).trim() ? listRows('ConciergeRequests', 'group_id', groupId) : []; }
export async function getConcierge(conciergeId) { return getRow('ConciergeRequests', conciergeId); }
export async function appendConcierge(row = {}) { return appendRow('ConciergeRequests', row, 'conciergeId'); }
export async function updateConcierge(conciergeId, patch = {}) { return updateRow('ConciergeRequests', conciergeId, patch); }

// The member's proposal (one per traveler; the first row wins should there ever be two), or null.
export async function getProposalForMember(memberId) {
  if (!str(memberId).trim()) return null;
  return listRows('Proposals', 'member_id', memberId)[0] || null;
}
export async function appendProposal(row = {}) { return appendRow('Proposals', row, 'proposalId'); }
export async function updateProposal(proposalId, patch = {}) { return updateRow('Proposals', proposalId, patch); }

export async function listPayments(groupId) { return str(groupId).trim() ? listRows('Payments', 'group_id', groupId) : []; }
export async function appendPayment(row = {}) { return appendRow('Payments', row, 'paymentId'); }

export async function listSettings() { return listRows('Settings'); }

// Extras (not part of the 4.1 interface) ----------------------------------------------------

// The whole mock file as an object, for tests and the QA walk-through.
export function readMockData() {
  return load();
}

// Delete the mock file so the next call reseeds from tests/fixtures/seed.json.
export async function resetMockStore() {
  fs.rmSync(mockDataPath(), { force: true });
}
