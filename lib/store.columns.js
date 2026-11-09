// lib/store.columns.js
// The Sheet's tab layout (plan section 4.2, plus the Waitlist tab from the polish brief section 3,
// the HostApplications tab from CONCEPT02_PLAN.md and the six Wave 2 tabs from CONCEPT02_WAVE2_PLAN.md
// sections 2 and 5) and the pure row <-> object mapping shared by store.mock.js, store.sheets.js and
// scripts/setup-sheet.js. No I/O in this file.

export const TAB_HEADERS = Object.freeze({
  Trips: Object.freeze(['trip_id', 'name', 'status', 'closed_message']),
  Weeks: Object.freeze(['week_id', 'trip_id', 'label', 'start_date', 'end_date', 'status', 'closed_message']),
  Requests: Object.freeze([
    'request_id', 'submitted_at', 'trip_id', 'request_type', 'weeks',
    'guest_name', 'guest_email', 'guest_mobile',
    'players', 'partners', 'room', 'single_rooms', 'tennis', 'addons',
    'party_type', 'level', 'tennis_style', 'travel_style', 'priorities',
    'note', 'player_estimate', 'partner_estimate', 'group_estimate', 'brief',
    'invite_code', 'invited_by', 'status', 'owner', 'internal_notes',
  ]),
  Invites: Object.freeze([
    'code', 'issued_to', 'guest_email', 'guest_mobile', 'invited_by',
    'max_uses', 'uses', 'status', 'created_at', 'last_used_at',
  ]),
  Log: Object.freeze(['time', 'code', 'result', 'ip_hash']),
  // Public-page waitlist sign-ups (POST /api/waitlist). trip is the trip's display name, or
  // "General" for the bottom-of-page button; source is "card" or "footer". No dropdowns, no seed.
  Waitlist: Object.freeze(['timestamp', 'email', 'name', 'trip', 'source']),
  // Host applications from the Concept 02 #/application form (POST /api/application). One row per
  // application, every form field as a column. No dropdowns, no seed.
  HostApplications: Object.freeze(['timestamp', 'name', 'email', 'club', 'referral', 'background', 'community', 'destination']),
  // Concept 02 Wave 2 (CONCEPT02_WAVE2_PLAN.md sections 2 and 5). One Groups row per group request,
  // created by the group path of POST /api/inquiry and edited by the organizer through /api/group.
  Groups: Object.freeze([
    'group_id', 'request_id', 'trip_id', 'name', 'organizer_name', 'organizer_email', 'weeks', 'chosen_week',
    'players', 'partners', 'tennis', 'payment_mode', 'notes', 'stage', 'review_needed', 'created_at', 'updated_at',
  ]),
  // One row per traveler in a group, the organizer included; preferences and arrival details live here
  // too. Rows are never deleted: `removed` becomes TRUE.
  GroupMembers: Object.freeze([
    'member_id', 'group_id', 'name', 'email', 'role', 'invite_status', 'participation', 'planning_complete',
    'level', 'tennis', 'room', 'roommate', 'interests', 'care_notes', 'proposal_status', 'payment_status',
    'arrival_airport', 'arrival_date', 'arrival_flight', 'arrival_time', 'invited_at', 'joined_at', 'updated_at', 'removed',
  ]),
  // Concierge requests. Guests create, cancel, approve and decline; status (other than those), offer,
  // cost, assigned_to and extra history lines are Courtside's, edited in the Sheet.
  ConciergeRequests: Object.freeze([
    'concierge_id', 'group_id', 'member_id', 'requester_name', 'category', 'subject', 'details', 'preferred_timing',
    'status', 'offer', 'cost', 'assigned_to', 'history', 'created_at', 'updated_at',
  ]),
  // One proposal per traveler (base price by role plus that traveler's approved concierge extras).
  Proposals: Object.freeze([
    'proposal_id', 'group_id', 'member_id', 'request_id', 'trip_id', 'week', 'role', 'room', 'players', 'partners',
    'inclusions', 'addons', 'base_price', 'extras_total', 'package_total', 'currency', 'deposit_amount',
    'balance_due_date', 'status', 'version', 'created_at', 'sent_at', 'accepted_at',
  ]),
  // The ledger: the site appends the pending deposit on acceptance; Courtside sets status and paid_at.
  Payments: Object.freeze([
    'payment_id', 'proposal_id', 'group_id', 'member_id', 'payer_name', 'payer_email', 'type', 'amount', 'currency',
    'method', 'provider_ref', 'status', 'due_date', 'paid_at', 'notes', 'created_at',
  ]),
  // Deposit and balance rules (lib/settings.js), seeded once with the five rows from the plan.
  Settings: Object.freeze(['key', 'value', 'note']),
});

export const TAB_NAMES = Object.freeze(Object.keys(TAB_HEADERS));

// The six Wave 2 tabs, in setup order.
export const WAVE2_TABS = Object.freeze(['Groups', 'GroupMembers', 'ConciergeRequests', 'Proposals', 'Payments', 'Settings']);

// The column that identifies a row in each tab the site updates in place (update-by-id).
export const ID_COLUMNS = Object.freeze({
  Groups: 'group_id',
  GroupMembers: 'member_id',
  ConciergeRequests: 'concierge_id',
  Proposals: 'proposal_id',
  Payments: 'payment_id',
});

// Columns that hold numbers. The Sheets store reads cells back as text; when it rewrites a row it
// turns these back into numbers so Katie's numeric cells stay numeric.
export const NUMERIC_COLUMNS = Object.freeze({
  Groups: Object.freeze(['players', 'partners']),
  GroupMembers: Object.freeze([]),
  ConciergeRequests: Object.freeze(['cost']),
  Proposals: Object.freeze(['players', 'partners', 'base_price', 'extras_total', 'package_total', 'deposit_amount', 'version']),
  Payments: Object.freeze(['amount']),
});

// Dropdown validation that scripts/setup-sheet.js applies (section 4.2 rules; Wave 2 adds its own).
export const DROPDOWNS = Object.freeze([
  { tab: 'Trips', column: 'status', values: ['open', 'closed'] },
  { tab: 'Weeks', column: 'status', values: ['open', 'closed'] },
  { tab: 'Requests', column: 'status', values: ['New', 'In conversation', 'Confirmed', 'Waitlist', 'Declined'] },
  { tab: 'Requests', column: 'request_type', values: ['private', 'vetted'] },
  { tab: 'Invites', column: 'status', values: ['active', 'paused', 'revoked'] },
  { tab: 'Groups', column: 'stage', values: ['Inquiry', 'Planning', 'Proposal sent', 'Confirmed'] },
  { tab: 'GroupMembers', column: 'participation', values: ['Interested', 'Still deciding', 'Not attending'] },
  { tab: 'GroupMembers', column: 'invite_status', values: ['Not invited', 'Link shared', 'Responded', 'Invitation canceled'] },
  { tab: 'ConciergeRequests', column: 'status', values: ['Received', 'Checking options', 'Approval needed', 'Approved', 'Declined', 'Unavailable', 'Confirmed', 'Canceled'] },
  { tab: 'Proposals', column: 'status', values: ['draft', 'sent', 'accepted', 'declined'] },
  { tab: 'Payments', column: 'type', values: ['deposit', 'balance', 'refund'] },
  { tab: 'Payments', column: 'status', values: ['pending', 'paid', 'refunded', 'failed'] },
]);

export function str(value) {
  return value === null || value === undefined ? '' : String(value);
}

export function snakeToCamel(name) {
  return str(name).replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

// Codes match case-insensitively and trimmed (section 4.1).
export function normalizeCode(code) {
  return str(code).trim().toUpperCase();
}

function normalizeStatus(value) {
  return str(value).trim().toLowerCase();
}

// One cell. Arrays join with ", " (weeks, priorities), finite numbers stay numbers so the
// Sheet gets numeric cells, everything blank becomes "".
export function toCellValue(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(toCellValue).join(', ');
  if (typeof value === 'number') return Number.isFinite(value) ? value : '';
  return String(value);
}

// camelCase object -> cells in `headers` order. Missing keys write "".
export function recordToValues(headers, record = {}) {
  return headers.map((header) => toCellValue(record[snakeToCamel(header)]));
}

// Cells -> object keyed by the snake_case headers. Short rows are padded with "".
export function valuesToRecord(headers, values = []) {
  const record = {};
  headers.forEach((header, i) => {
    record[header] = values[i] === undefined || values[i] === null ? '' : values[i];
  });
  return record;
}

export function requestRowToValues(row = {}) {
  return recordToValues(TAB_HEADERS.Requests, row);
}

export function waitlistRowToValues(row = {}) {
  return recordToValues(TAB_HEADERS.Waitlist, row);
}

export function hostApplicationRowToValues(row = {}) {
  return recordToValues(TAB_HEADERS.HostApplications, row);
}

function isBlankRow(cells) {
  return !cells || cells.every((v) => str(v).trim() === '');
}

// A values.get result (row 1 = headers) -> { headers, rows: [{ rowNumber, record }] }.
// rowNumber is the 1-based sheet row, so the first data row is 2. Blank rows are skipped but
// still count, so rowNumber always points at the real row in the Sheet.
export function parseSheetValues(values = []) {
  const [headerRow = [], ...dataRows] = values;
  const headers = headerRow.map((h) => str(h).trim());
  const rows = [];
  dataRows.forEach((cells, i) => {
    if (isBlankRow(cells)) return;
    rows.push({ rowNumber: i + 2, record: valuesToRecord(headers, cells) });
  });
  return { headers, rows };
}

export function toTrip(r = {}) {
  return {
    tripId: str(r.trip_id).trim(),
    name: str(r.name).trim(),
    status: normalizeStatus(r.status),
    closedMessage: str(r.closed_message).trim(),
  };
}

export function toWeek(r = {}) {
  return {
    weekId: str(r.week_id).trim(),
    tripId: str(r.trip_id).trim(),
    label: str(r.label).trim(),
    start: str(r.start_date).trim(),
    end: str(r.end_date).trim(),
    status: normalizeStatus(r.status),
    closedMessage: str(r.closed_message).trim(),
  };
}

// Wave 2 mappers ---------------------------------------------------------------------------
// Cells -> camelCase objects. Text cells are trimmed strings; the TRUE/FALSE flags become booleans;
// money, counts and versions become numbers (blank or unreadable -> 0). The Sheet returns every
// cell as text, the mock file keeps numbers as numbers; both arrive here the same.

export function isTrue(value) {
  return str(value).trim().toUpperCase() === 'TRUE';
}

// "2,995", "$150", 2995 -> 2995; "" or "tbd" -> 0.
export function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = str(value).replace(/[^0-9.-]/g, '');
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

// A generic row: every header as a trimmed camelCase string.
function toText(headers, r) {
  const out = {};
  for (const header of headers) out[snakeToCamel(header)] = str(r[header]).trim();
  return out;
}

export function toGroup(r = {}) {
  return { ...toText(TAB_HEADERS.Groups, r), reviewNeeded: isTrue(r.review_needed) };
}

export function toMember(r = {}) {
  return { ...toText(TAB_HEADERS.GroupMembers, r), planningComplete: isTrue(r.planning_complete), removed: isTrue(r.removed) };
}

export function toConcierge(r = {}) {
  return { ...toText(TAB_HEADERS.ConciergeRequests, r), cost: toNumber(r.cost) };
}

export function toProposal(r = {}) {
  const row = toText(TAB_HEADERS.Proposals, r);
  for (const key of ['basePrice', 'extrasTotal', 'packageTotal', 'depositAmount', 'version']) row[key] = toNumber(r[camelToSnake(key)]);
  return row;
}

export function toPayment(r = {}) {
  return { ...toText(TAB_HEADERS.Payments, r), amount: toNumber(r.amount) };
}

export function toSetting(r = {}) {
  return toText(TAB_HEADERS.Settings, r);
}

export const WAVE2_MAPPERS = Object.freeze({
  Groups: toGroup, GroupMembers: toMember, ConciergeRequests: toConcierge, Proposals: toProposal, Payments: toPayment, Settings: toSetting,
});

export function camelToSnake(name) {
  return str(name).replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

// A snake_case record (one row as stored) with a camelCase patch applied: only the patch's keys that
// are headers of `tab` change, `updated_at` is stamped when the tab has it, nothing else moves.
export function applyPatch(tab, record, patch = {}, now = new Date().toISOString()) {
  const headers = TAB_HEADERS[tab];
  const out = { ...record };
  for (const header of headers) {
    if (header === ID_COLUMNS[tab]) continue; // an id never changes
    const camel = snakeToCamel(header);
    if (Object.hasOwn(patch, camel) && camel !== 'updatedAt') out[header] = toCellValue(patch[camel]);
  }
  if (headers.includes('updated_at')) out.updated_at = now;
  return out;
}

// maxUses: blank (or non-numeric) means unlimited -> null. uses is always a number.
export function toInvite(r = {}) {
  const maxRaw = str(r.max_uses).trim();
  const maxNum = Number(maxRaw);
  return {
    code: str(r.code).trim(),
    issuedTo: str(r.issued_to).trim(),
    guestEmail: str(r.guest_email).trim(),
    guestMobile: str(r.guest_mobile).trim(),
    invitedBy: str(r.invited_by).trim(),
    maxUses: maxRaw === '' || !Number.isFinite(maxNum) ? null : maxNum,
    uses: Number(str(r.uses).trim()) || 0,
    status: normalizeStatus(r.status),
    createdAt: str(r.created_at).trim(),
    lastUsedAt: str(r.last_used_at).trim(),
  };
}
