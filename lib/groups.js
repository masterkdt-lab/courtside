// lib/groups.js
// Shared, pure helpers for the Wave 2 routes (CONCEPT02_WAVE2_PLAN.md section 6): the fixed values
// (roles, stages, payment modes, base prices, the inclusions text), the trimmed response shapes
// members who are not the organizer may see, the personal and shared links, week labels, date
// arithmetic and the proposal pricing rules. No I/O here; the routes read the store and pass rows in.

import { TRIP_ID } from './catalog.js';

export { TRIP_ID };
export const FLEXIBLE = 'flexible'; // the Groups.chosen_week value when no week is chosen (= validate.js INQUIRY_FLEXIBLE)
export const FLEXIBLE_LABEL = 'Flexible';

export const STAGES = Object.freeze(['Inquiry', 'Planning', 'Proposal sent', 'Confirmed']);
export const PAYMENT_MODES = Object.freeze(['Individual travelers', 'Organizer requests group payment']);
export const [PAYMENT_MODE_INDIVIDUAL, PAYMENT_MODE_GROUP] = PAYMENT_MODES;

export const ROLES = Object.freeze({
  organizerPlayer: 'Organizer + player',
  organizerPartner: 'Organizer + partner',
  player: 'Player',
  partner: 'Non-playing partner',
});
export const INVITE_STATUSES = Object.freeze(['Not invited', 'Link shared', 'Responded', 'Invitation canceled']);
export const PARTICIPATIONS = Object.freeze(['Interested', 'Still deciding', 'Not attending']);
export const PROPOSAL_STATUSES = Object.freeze(['draft', 'sent', 'accepted', 'declined']);
export const CONCIERGE_STATUSES = Object.freeze(['Received', 'Checking options', 'Approval needed', 'Approved', 'Declined', 'Unavailable', 'Confirmed', 'Canceled']);

// The member columns the site keeps as its own status words (shown on the group page).
export const MEMBER_PROPOSAL_STATUS = Object.freeze({ draft: 'Draft', reviewRequested: 'Review requested', paymentPending: 'Payment pending' });
export const MEMBER_PAYMENT_STATUS = Object.freeze({ notDue: 'Not due', depositPending: 'Deposit pending' });

// Concept pricing per traveler (the SPA's figures), and the fixed package text.
export const BASE_PRICES = Object.freeze({ player: 2995, partner: 1995 });
export const INCLUSIONS = 'Six-night resort stay; Four tennis mornings; Daily breakfast; Scheduled club transfers; Welcome + farewell dinners; Courtside trip support';
export const ADDONS_SEPARATOR = ', ';
export const HISTORY_SEPARATOR = ' · ';

export const isPartnerRole = (role) => role === ROLES.partner || role === ROLES.organizerPartner;
export const basePriceFor = (role) => (isPartnerRole(role) ? BASE_PRICES.partner : BASE_PRICES.player);

// A member's chosen role on the preferences form (Player | Non-playing partner) -> the stored role,
// which keeps the Organizer prefix for the organizer.
export function roleFor(choice, { isOrganizer }) {
  if (!isOrganizer) return choice;
  return choice === ROLES.partner ? ROLES.organizerPartner : ROLES.organizerPlayer;
}

// Links the organizer copies and sends (hash routes of the SPA).
export const memberLink = (memberId) => `/#/join/${memberId}`;
export const groupLink = (groupId) => `/#/join-group/${groupId}`;

// "Ana Guest" -> "Ana’s Spain group" (U+2019, as the SPA writes it).
export function groupNameFor(fullName) {
  const first = String(fullName ?? '').trim().split(/\s+/)[0] || 'Your';
  return `${first}’s Spain group`;
}

// New rows ---------------------------------------------------------------------------------

export const FLAG = Object.freeze({ yes: 'TRUE', no: 'FALSE' }); // how the booleans are written
export const flag = (bool) => (bool ? FLAG.yes : FLAG.no);

// The Groups row the group path of POST /api/inquiry creates.
export function newGroupRow({ groupId, requestId, organizerName, organizerEmail, weeks, chosenWeek, players, partners, tennis, notes, now }) {
  return {
    groupId,
    requestId,
    tripId: TRIP_ID,
    name: groupNameFor(organizerName),
    organizerName,
    organizerEmail,
    weeks,
    chosenWeek,
    players,
    partners,
    tennis,
    paymentMode: PAYMENT_MODE_INDIVIDUAL,
    notes,
    stage: STAGES[0],
    reviewNeeded: FLAG.no,
    createdAt: now,
    updatedAt: now,
  };
}

// A GroupMembers row with every column present: the organizer (from the request), a member the
// organizer adds (Not invited, no participation yet) or one who joins (Responded, Interested).
export function newMemberRow({ memberId, groupId, name, email, role, inviteStatus, participation = '', tennis = '', joinedAt = '', now }) {
  return {
    memberId,
    groupId,
    name,
    email,
    role,
    inviteStatus,
    participation,
    planningComplete: FLAG.no,
    level: '',
    tennis,
    room: '',
    roommate: '',
    interests: '',
    careNotes: '',
    proposalStatus: MEMBER_PROPOSAL_STATUS.draft,
    paymentStatus: MEMBER_PAYMENT_STATUS.notDue,
    arrivalAirport: '',
    arrivalDate: '',
    arrivalFlight: '',
    arrivalTime: '',
    invitedAt: '',
    joinedAt,
    updatedAt: now,
    removed: FLAG.no,
  };
}

// Weeks ----------------------------------------------------------------------------------

export const spainWeeks = (weeks) => weeks.filter((w) => w.tripId === TRIP_ID);
export const weeksById = (weeks) => new Map(spainWeeks(weeks).map((w) => [w.weekId, w]));
export const weekLabels = (weeks) => Object.fromEntries(spainWeeks(weeks).map((w) => [w.weekId, w.label]));

// The label for a group's chosen week: Flexible, the lineup label, or the stored weeks text.
export function weekLabelFor(group, byId) {
  if (!group.chosenWeek || group.chosenWeek === FLEXIBLE) return FLEXIBLE_LABEL;
  return byId.get(group.chosenWeek)?.label || group.weeks || group.chosenWeek;
}

// Response shapes --------------------------------------------------------------------------

// What every member may see of the group (open, join, and the non-organizer group read).
export function publicGroup(group, byId) {
  return {
    groupId: group.groupId,
    name: group.name,
    organizerName: group.organizerName,
    chosenWeek: group.chosenWeek,
    weekLabel: weekLabelFor(group, byId),
    tennis: group.tennis,
    stage: group.stage,
  };
}

// What a member sees of the other members.
export function publicMember(member) {
  return {
    memberId: member.memberId,
    name: member.name,
    role: member.role,
    participation: member.participation,
    planningComplete: member.planningComplete,
  };
}

// A concierge row for a response: history as lines.
export const splitHistory = (text) => String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
export const conciergeView = (row) => ({ ...row, history: splitHistory(row.history) });
export const historyLine = (text, at) => `${text}${HISTORY_SEPARATOR}${at}`;
export const appendHistory = (history, line) => (history ? `${history}\n${line}` : line);

// Dates ------------------------------------------------------------------------------------

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

// "2027-02-07" + (-60) -> "2026-12-09". UTC arithmetic; '' when the input is not YYYY-MM-DD.
export function addDays(ymd, days) {
  const m = YMD.exec(String(ymd ?? '').trim());
  if (!m) return '';
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

export const todayYmd = (now = new Date()) => now.toISOString().slice(0, 10);

// Proposal pricing (CONCEPT02_WAVE2_PLAN.md "GET /api/proposal") -----------------------------

// The approved concierge rows that belong to a member.
export const approvedExtras = (requests, memberId) => requests.filter((r) => r.memberId === memberId && r.status === 'Approved');

// The columns the pricing rules decide: everything but ids, status, version and timestamps.
export function priceProposal({ member, group, extras, settings, byId, isOrganizer }) {
  const week = weekLabelFor(group, byId);
  const chosen = group.chosenWeek && group.chosenWeek !== FLEXIBLE ? byId.get(group.chosenWeek) : null;
  const basePrice = basePriceFor(member.role);
  const extrasTotal = extras.reduce((sum, r) => sum + (Number.isFinite(r.cost) ? r.cost : 0), 0);
  let depositAmount = settings.depositPerPerson;
  if (group.paymentMode === PAYMENT_MODE_GROUP) depositAmount = isOrganizer ? settings.depositPerGroup : 0;
  return {
    week,
    role: member.role,
    room: member.room,
    players: group.players,
    partners: group.partners,
    inclusions: INCLUSIONS,
    addons: extras.map((r) => r.subject).join(ADDONS_SEPARATOR),
    basePrice,
    extrasTotal,
    packageTotal: basePrice + extrasTotal,
    currency: settings.currency,
    depositAmount,
    balanceDueDate: chosen ? addDays(chosen.start, -settings.balanceDueDaysBefore) : '',
  };
}

// While a proposal is still a draft, a later read refreshes these from live data (the extras first
// of all) and bumps the version when something changed. basePrice is left alone so a figure Courtside
// typed into the Sheet survives; packageTotal is then the stored base plus the live extras.
export const DRAFT_REFRESH_KEYS = Object.freeze(['week', 'room', 'players', 'partners', 'addons', 'extrasTotal', 'packageTotal', 'currency', 'depositAmount', 'balanceDueDate']);

export function draftChanges(stored, priced) {
  const patch = {};
  const fresh = { ...priced, packageTotal: stored.basePrice + priced.extrasTotal };
  for (const key of DRAFT_REFRESH_KEYS) {
    if (String(stored[key] ?? '') !== String(fresh[key] ?? '')) patch[key] = fresh[key];
  }
  return patch;
}
