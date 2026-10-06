// lib/store.columns.js
// The Sheet's tab layout (plan section 4.2) and the pure row <-> object mapping shared by
// store.mock.js, store.sheets.js and scripts/setup-sheet.js. No I/O in this file.

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
});

export const TAB_NAMES = Object.freeze(Object.keys(TAB_HEADERS));

// Dropdown validation that scripts/setup-sheet.js applies (section 4.2 rules).
export const DROPDOWNS = Object.freeze([
  { tab: 'Trips', column: 'status', values: ['open', 'closed'] },
  { tab: 'Weeks', column: 'status', values: ['open', 'closed'] },
  { tab: 'Requests', column: 'status', values: ['New', 'In conversation', 'Confirmed', 'Waitlist', 'Declined'] },
  { tab: 'Requests', column: 'request_type', values: ['private', 'vetted'] },
  { tab: 'Invites', column: 'status', values: ['active', 'paused', 'revoked'] },
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
