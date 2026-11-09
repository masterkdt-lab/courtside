// lib/validate.js
// Body validation for the POST routes. Each validator returns { ok: true, value } with trimmed and
// coerced values, or { ok: false, errors: { field: message } }. Messages are short complete
// sentences the pages can show as they are. Unknown fields are ignored.
//   validateRequest(body)   POST /api/request (plan 4.4, 10.5–10.7); the identity fields never come
//                           from the body (plan 4.7)
//   validateWaitlist(body)  POST /api/waitlist (polish brief section 3; Concept 02 sources from CONCEPT02_PLAN.md)
//   validateEvent(body)     POST /api/event (polish brief section 3)
//   validateInquiry(body)   POST /api/inquiry (CONCEPT02_PLAN.md): the #/request final step. Week ids
//                           are checked for shape here and against the live lineup in the route.
//   validateApplication(body) POST /api/application (CONCEPT02_PLAN.md): the #/application form
//   isHoneypotFilled(body)  the shared honeypot rule: `website` must be "" (or absent)
//   Wave 2 (CONCEPT02_WAVE2_PLAN.md section 6; option strings are the Concept 02 SPA's exactly):
//   validateGroupUpdate(body, weekIds)  POST /api/group { action:"update", name, chosenWeek, tennis, paymentMode }
//   validateMember(body)                POST /api/member, dispatching on `action`
//   validateConcierge(body)             POST /api/concierge, dispatching on `action`
//   validateProposal(body)              POST /api/proposal { action:"accept", proposalId }

import {
  ADDONS, LEVELS, LIMITS, PARTY_TYPES, PRIORITIES, RANGES, REQUEST_TYPES, ROOMS, TENNIS,
  TENNIS_STYLES, TRAVEL_STYLES, WEEK_IDS, addonById,
} from './catalog.js';
import { PARTICIPATIONS, PAYMENT_MODES, ROLES } from './groups.js';
import { interestTripId, isInterest, isTripId, isWaitlistTripId, normalizeInterest } from './lineup.js';

const ROOM_IDS = ROOMS.map((r) => r.id);
const TENNIS_IDS = TENNIS.map((t) => t.id);
const ADDON_IDS = ADDONS.map((a) => a.id);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Strings are trimmed; numbers and booleans are stringified; null/undefined become "";
// anything else (objects, arrays) is null = wrong type.
function asText(v) {
  if (typeof v === 'string') return v.trim();
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

// Integers only; numeric strings such as "6" are accepted. null = not an integer.
function asInteger(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return Number(v.trim());
  return null;
}

function listOf(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : null;
}

function choice(body, field, set, message, fail, value) {
  const text = asText(body[field]);
  if (text === null || !set.includes(text)) {
    fail(field, message);
    return;
  }
  value[field] = text;
}

function estimate(body, field, { required, label }, fail, value) {
  const text = asText(body[field]);
  if (text === null || (required && text === '')) {
    fail(field, `The ${label} estimate is missing.`);
    return;
  }
  if (text.length > LIMITS.estimate) {
    fail(field, `The ${label} estimate is too long.`);
    return;
  }
  value[field] = text;
}

function validateWeeks(body, requestType, fail, value) {
  const oneOrMore = requestType === 'vetted' ? 'Choose at least one week.' : 'Choose one week.';
  const list = listOf(body.weeks);
  if (list === null) {
    fail('weeks', oneOrMore);
    return;
  }
  const weeks = list.map(asText);
  if (weeks.some((w) => w === null || !WEEK_IDS.includes(w))) {
    fail('weeks', 'Choose a week from the list.');
    return;
  }
  if (new Set(weeks).size !== weeks.length) {
    fail('weeks', 'Each week can be chosen once.');
    return;
  }
  if (weeks.length === 0 || (requestType === 'private' && weeks.length !== 1)) {
    fail('weeks', oneOrMore);
    return;
  }
  value.weeks = weeks;
}

function validatePrivate(body, fail, value) {
  const players = asInteger(body.players);
  if (players === null || players < RANGES.players.min || players > RANGES.players.max) {
    fail('players', `Players must be between ${RANGES.players.min} and ${RANGES.players.max}.`);
  } else {
    value.players = players;
  }

  const partners = asInteger(body.partners);
  if (partners === null || partners < RANGES.partners.min || partners > RANGES.partners.max) {
    fail('partners', `Partners must be between ${RANGES.partners.min} and ${RANGES.partners.max}.`);
  } else {
    value.partners = partners;
  }

  const singleRooms = asInteger(body.singleRooms);
  const guestsKnown = value.players !== undefined && value.partners !== undefined;
  const guests = guestsKnown ? value.players + value.partners : null;
  if (singleRooms === null || singleRooms < RANGES.singleRooms.min || (guestsKnown && singleRooms > guests)) {
    fail('singleRooms', guestsKnown ? `Single rooms must be between 0 and ${guests}.` : 'Single rooms must be 0 or more.');
  } else {
    value.singleRooms = singleRooms;
  }

  choice(body, 'room', ROOM_IDS, 'Choose a room.', fail, value);
  choice(body, 'tennis', TENNIS_IDS, 'Choose a tennis option.', fail, value);

  const addonsIn = listOf(body.addons);
  if (addonsIn === null) {
    fail('addons', 'Add-ons must be a list.');
  } else {
    const addons = [];
    const seen = new Set();
    for (const entry of addonsIn) {
      const id = isObject(entry) ? asText(entry.id) : null;
      const addon = id ? addonById(id) : null;
      if (!addon || !ADDON_IDS.includes(id)) {
        fail('addons', 'Choose add-ons from the list.');
        break;
      }
      if (seen.has(id)) {
        fail('addons', 'Each add-on can be chosen once.');
        break;
      }
      seen.add(id);
      if (addon.type === 'player' || addon.type === 'guest') {
        const qty = asInteger(entry.qty);
        if (qty === null || qty < 1) {
          fail('addons', `Enter how many for ${addon.name}`.replace(/\.$/, '') + '.');
          break;
        }
        addons.push({ id, qty });
      } else {
        addons.push({ id }); // group / none: qty is ignored
      }
    }
    if (!('addons' in value) && addons.length === addonsIn.length) value.addons = addons;
  }

  estimate(body, 'playerEstimate', { required: true, label: 'player' }, fail, value);
  estimate(body, 'partnerEstimate', { required: false, label: 'partner' }, fail, value);
  estimate(body, 'groupEstimate', { required: true, label: 'group' }, fail, value);
}

function validateVetted(body, fail, value) {
  choice(body, 'partyType', PARTY_TYPES, 'Choose who you are coming as.', fail, value);
  choice(body, 'level', LEVELS, 'Choose a tennis level.', fail, value);
  choice(body, 'tennisStyle', TENNIS_STYLES, 'Choose your ideal tennis.', fail, value);
  choice(body, 'travelStyle', TRAVEL_STYLES, 'Choose a travel style.', fail, value);

  const list = listOf(body.priorities);
  if (list === null) {
    fail('priorities', 'Priorities must be a list.');
    return;
  }
  const priorities = list.map(asText);
  if (priorities.some((p) => p === null || !PRIORITIES.includes(p))) {
    fail('priorities', 'Choose priorities from the list.');
    return;
  }
  if (new Set(priorities).size !== priorities.length) {
    fail('priorities', 'Each priority can be chosen once.');
    return;
  }
  value.priorities = priorities;
}

export function validateRequest(body) {
  if (!isObject(body)) return { ok: false, errors: { body: 'Send the request as a JSON object.' } };

  const errors = {};
  const value = {};
  const fail = (field, message) => {
    if (!errors[field]) errors[field] = message;
  };

  const requestType = asText(body.requestType);
  if (requestType === null || !REQUEST_TYPES.includes(requestType)) {
    fail('requestType', 'Choose a private group or a vetted group request.');
  } else {
    value.requestType = requestType;
  }

  validateWeeks(body, requestType, fail, value);

  if (body.consent !== true) {
    fail('consent', 'Please agree to the privacy notice to send your request.');
  } else {
    value.consent = true;
  }

  // Honeypot: never an error here; api/request.js decides what to do with a filled one.
  const website = asText(body.website);
  value.website = website === null ? 'filled' : website;

  const note = asText(body.note);
  if (note === null) {
    fail('note', 'Notes must be text.');
  } else if (note.length > LIMITS.note) {
    fail('note', `Keep notes under ${LIMITS.note.toLocaleString('en-US')} characters.`);
  } else {
    value.note = note;
  }

  const brief = asText(body.brief);
  if (brief === null || brief === '') {
    fail('brief', 'The trip brief is missing.');
  } else if (brief.length > LIMITS.brief) {
    fail('brief', 'The trip brief is too long.');
  } else {
    value.brief = brief;
  }

  if (requestType === 'private') validatePrivate(body, fail, value);
  else if (requestType === 'vetted') validateVetted(body, fail, value);

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}

// Honeypot (plan 4.4, polish brief section 3): `website` is a hidden field people never see. It
// counts as filled when it holds anything but "" (a missing field is fine; a non-text value is a
// bot too). The routes answer a filled honeypot with a fake success and write nothing.
export function isHoneypotFilled(body) {
  if (!isObject(body)) return false;
  const website = asText(body.website);
  return website === null || website !== '';
}

// Shared field rules ------------------------------------------------------------------------

// local@domain.tld: no whitespace or second @, a dot in the domain, a TLD of two or more characters.
// Checked after the length cap, so the pattern never sees more than 254 characters.
export const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/;
export const EMAIL_MAX = 254;

// A required email: trimmed, at most 254 characters, shaped, lower-cased into value.email.
function emailField(body, fail, value) {
  const email = asText(body.email);
  if (email === null || email === '') {
    fail('email', 'Enter a valid email address.');
  } else if (email.length > EMAIL_MAX) {
    fail('email', 'That email address is too long.');
  } else if (!EMAIL_SHAPE.test(email)) {
    fail('email', 'Enter a valid email address.');
  } else {
    value.email = email.toLowerCase();
  }
}

// A free-text field: trimmed, text only, at most `max` characters, required when `missing` is given.
function textField(body, field, { max, missing, tooLong, notText }, fail, value) {
  const text = asText(body[field]);
  if (text === null) {
    fail(field, notText);
  } else if (missing && text === '') {
    fail(field, missing);
  } else if (text.length > max) {
    fail(field, tooLong);
  } else {
    value[field] = text;
  }
}

// POST /api/waitlist ------------------------------------------------------------------------

// card / footer: the pre-Concept-02 homepage forms (tripId required). concept02-waitlist /
// concept02-home: the SPA's #/waitlist page and the home "Keep me posted" form (interest required,
// tripId ignored; the trip is derived from the interest, lib/lineup.js).
export const WAITLIST_SOURCES = Object.freeze(['card', 'footer', 'concept02-waitlist', 'concept02-home']);
export const CONCEPT02_WAITLIST_SOURCES = Object.freeze(['concept02-waitlist', 'concept02-home']);
export const WAITLIST_LIMITS = Object.freeze({ email: EMAIL_MAX, name: 120 });

// value: { email, name, source, consent } plus, for card/footer, tripId; for the Concept 02
// sources, interest (the exact option text) and tripId (the trips.js id it maps to, or '').
export function validateWaitlist(body) {
  if (!isObject(body)) return { ok: false, errors: { body: 'Send the request as a JSON object.' } };

  const errors = {};
  const value = {};
  const fail = (field, message) => {
    if (!errors[field]) errors[field] = message;
  };

  emailField(body, fail, value);

  const name = asText(body.name);
  if (name === null) {
    fail('name', 'Enter your name as text.');
  } else if (name.length > WAITLIST_LIMITS.name) {
    fail('name', `Keep your name under ${WAITLIST_LIMITS.name} characters.`);
  } else {
    value.name = name;
  }

  const source = asText(body.source);
  if (source === null || !WAITLIST_SOURCES.includes(source)) {
    fail('source', 'Reload the page and try again.');
  } else {
    value.source = source;
  }

  if (source !== null && CONCEPT02_WAITLIST_SOURCES.includes(source)) {
    const raw = asText(body.interest);
    const interest = raw === null ? null : normalizeInterest(raw);
    if (interest === null || !isInterest(interest)) {
      fail('interest', 'Choose what you are interested in.');
    } else {
      value.interest = interest;
      value.tripId = interestTripId(interest);
    }
  } else {
    const tripId = asText(body.tripId);
    if (tripId === null || !isWaitlistTripId(tripId)) {
      fail('tripId', 'Choose a trip from the lineup.');
    } else {
      value.tripId = tripId;
    }
  }

  if (body.consent !== true) {
    fail('consent', 'Please tick the box so we can keep your email.');
  } else {
    value.consent = true;
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}

// POST /api/inquiry -------------------------------------------------------------------------
// The Concept 02 #/request form (CONCEPT02_PLAN.md). Option strings are the SPA's exactly.

export const INQUIRY_PATHS = Object.freeze(['group', 'match']);
export const INQUIRY_FLEXIBLE = 'flexible';
export const INQUIRY_TENNIS = Object.freeze(['Help us decide', 'A few relaxed mornings', 'Four mornings', 'Daily tennis', 'As much as possible']);
export const INQUIRY_PARTIES = Object.freeze(['Solo', 'Couple', '2–3 friends']);
export const INQUIRY_LEVELS = Object.freeze(['2.5', '3.0', '3.5', '4.0', '4.5', '5.0+']);
export const INQUIRY_RANGES = Object.freeze({
  players: Object.freeze({ min: 4, max: 12 }),
  partners: Object.freeze({ min: 0, max: 6 }),
});
export const INQUIRY_LIMITS = Object.freeze({ name: 120, email: EMAIL_MAX, notes: 2000, weekId: 40 });

// "" (Not sure yet) or an integer in range, as a string or a number. -> '' | number | null (invalid)
function optionalInteger(raw, { min, max }) {
  const text = asText(raw);
  if (text === null) return null;
  if (text === '') return '';
  const n = asInteger(text);
  if (n === null || n < min || n > max) return null;
  return n;
}

// weeks: exactly ["flexible"], or one or more distinct non-empty ids (existence is the route's job).
function inquiryWeeks(body, fail, value) {
  const list = listOf(body.weeks);
  if (list === null || list.length === 0) {
    fail('weeks', 'Choose a week, or tell us you’re flexible.');
    return;
  }
  const weeks = list.map(asText);
  if (weeks.some((w) => w === null || w === '' || w.length > INQUIRY_LIMITS.weekId)) {
    fail('weeks', 'Choose a week from the list.');
    return;
  }
  if (weeks.includes(INQUIRY_FLEXIBLE)) {
    if (weeks.length !== 1) {
      fail('weeks', 'Choose a week from the list.');
      return;
    }
    value.weeks = [INQUIRY_FLEXIBLE];
    value.flexible = true;
    return;
  }
  if (new Set(weeks).size !== weeks.length) {
    fail('weeks', 'Each week can be chosen once.');
    return;
  }
  value.weeks = weeks;
  value.flexible = false;
}

// value: { path, weeks, flexible, players, partners, party, level, tennis, name, email, notes,
// consent }. Fields that belong to the other path are '' (never read from the body).
export function validateInquiry(body) {
  if (!isObject(body)) return { ok: false, errors: { body: 'Send the request as a JSON object.' } };

  const errors = {};
  const value = {};
  const fail = (field, message) => {
    if (!errors[field]) errors[field] = message;
  };

  const path = asText(body.path);
  if (path === null || !INQUIRY_PATHS.includes(path)) {
    fail('path', 'Choose a private group or a group match request.');
  } else {
    value.path = path;
  }

  inquiryWeeks(body, fail, value);

  value.players = '';
  value.partners = '';
  value.party = '';
  value.level = '';
  if (path === 'group') {
    // Both fields must be present; "" is the "Not sure yet" option.
    const { players, partners } = INQUIRY_RANGES;
    const p = body.players === undefined ? null : optionalInteger(body.players, players);
    if (p === null) fail('players', `Players must be a number between ${players.min} and ${players.max}.`);
    else value.players = p;
    const q = body.partners === undefined ? null : optionalInteger(body.partners, partners);
    if (q === null) fail('partners', `Partners must be a number between ${partners.min} and ${partners.max}.`);
    else value.partners = q;
  } else if (path === 'match') {
    const party = asText(body.party);
    if (party === null || !INQUIRY_PARTIES.includes(party)) fail('party', 'Choose who you are coming as.');
    else value.party = party;
    const level = asText(body.level);
    if (level === null || (level !== '' && !INQUIRY_LEVELS.includes(level))) fail('level', 'Choose a tennis level from the list.');
    else value.level = level;
  }

  const tennis = asText(body.tennis);
  if (tennis === null || !INQUIRY_TENNIS.includes(tennis)) {
    fail('tennis', 'Choose a tennis rhythm from the list.');
  } else {
    value.tennis = tennis;
  }

  textField(body, 'name', {
    max: INQUIRY_LIMITS.name, missing: 'Enter your name.', tooLong: `Keep your name under ${INQUIRY_LIMITS.name} characters.`, notText: 'Enter your name as text.',
  }, fail, value);
  emailField(body, fail, value);
  textField(body, 'notes', {
    max: INQUIRY_LIMITS.notes, tooLong: `Keep notes under ${INQUIRY_LIMITS.notes.toLocaleString('en-US')} characters.`, notText: 'Notes must be text.',
  }, fail, value);

  if (body.consent !== true) {
    fail('consent', 'Please tick the box so Courtside can keep these details to prepare a proposal.');
  } else {
    value.consent = true;
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}

// POST /api/application ---------------------------------------------------------------------
// The Concept 02 #/application host form (CONCEPT02_PLAN.md).

export const APPLICATION_LIMITS = Object.freeze({
  name: 120, email: EMAIL_MAX, club: 200, referral: 200, background: 4000, community: 4000, destination: 200,
});

// value: { name, email, club, referral, background, community, destination, consent }.
export function validateApplication(body) {
  if (!isObject(body)) return { ok: false, errors: { body: 'Send the request as a JSON object.' } };

  const errors = {};
  const value = {};
  const fail = (field, message) => {
    if (!errors[field]) errors[field] = message;
  };
  const L = APPLICATION_LIMITS;
  const count = (n) => n.toLocaleString('en-US');

  textField(body, 'name', { max: L.name, missing: 'Enter your name.', tooLong: `Keep your name under ${L.name} characters.`, notText: 'Enter your name as text.' }, fail, value);
  emailField(body, fail, value);
  textField(body, 'club', { max: L.club, missing: 'Tell us where you coach.', tooLong: `Keep the club under ${L.club} characters.`, notText: 'Enter the club as text.' }, fail, value);
  textField(body, 'referral', { max: L.referral, tooLong: `Keep the referral under ${L.referral} characters.`, notText: 'Enter the referral as text.' }, fail, value);
  textField(body, 'background', {
    max: L.background, missing: 'Tell us about your professional background.', tooLong: `Keep your background under ${count(L.background)} characters.`, notText: 'Enter your background as text.',
  }, fail, value);
  textField(body, 'community', {
    max: L.community, missing: 'Tell us about your community.', tooLong: `Keep the community note under ${count(L.community)} characters.`, notText: 'Enter the community note as text.',
  }, fail, value);
  textField(body, 'destination', {
    max: L.destination, missing: 'Tell us where you would love to take them.', tooLong: `Keep the destination under ${L.destination} characters.`, notText: 'Enter the destination as text.',
  }, fail, value);

  if (body.consent !== true) {
    fail('consent', 'Please tick the box so Courtside can keep your application.');
  } else {
    value.consent = true;
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}

// POST /api/event ---------------------------------------------------------------------------

// waitlist_submit is written by /api/waitlist and code attempts by /api/code; the client may only
// send these two.
export const EVENT_NAMES = Object.freeze(['no_code_click', 'trip_card_open']);
export const EVENT_DETAIL_MAX = 80;

export function validateEvent(body) {
  if (!isObject(body)) return { ok: false, errors: { body: 'Send the event as a JSON object.' } };

  const errors = {};
  const value = {};
  const fail = (field, message) => {
    if (!errors[field]) errors[field] = message;
  };

  const name = asText(body.name);
  if (name === null || !EVENT_NAMES.includes(name)) {
    fail('name', 'Unknown event.');
  } else {
    value.name = name;
  }

  const detail = asText(body.detail);
  if (detail === null) {
    fail('detail', 'The event detail must be text.');
  } else if (detail.length > EVENT_DETAIL_MAX) {
    fail('detail', 'The event detail is too long.');
  } else if (value.name === 'trip_card_open' && !isTripId(detail)) {
    fail('detail', 'The event detail must be a trip id.');
  } else {
    value.detail = detail;
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}

// Wave 2: groups, members, concierge, proposals ---------------------------------------------
// CONCEPT02_WAVE2_PLAN.md section 6. Each validator returns { ok:true, value } or
// { ok:false, errors }. Ids are checked for shape only (text, at most 40 characters); the routes
// look them up. The option lists are the Concept 02 SPA's strings.

export const GROUP_LIMITS = Object.freeze({
  name: 120, id: 40, roommate: 120, care: 1000, subject: 160, details: 4000, timing: 60, arrival: 120, arrivalDate: 40,
});
export const GROUP_ACTIONS = Object.freeze(['update']);
export const MEMBER_ACTIONS = Object.freeze(['open', 'join', 'add', 'invite', 'cancel', 'remove', 'respond', 'preferences', 'arrival']);
export const MEMBER_PUBLIC_ACTIONS = Object.freeze(['open', 'join']); // no cookie needed
export const MEMBER_ORGANIZER_ACTIONS = Object.freeze(['add', 'invite', 'cancel', 'remove']);
export const CONCIERGE_ACTIONS = Object.freeze(['create', 'cancel', 'approve', 'decline']);
export const PROPOSAL_ACTIONS = Object.freeze(['accept']);

export const MEMBER_ROLES = Object.freeze([ROLES.player, ROLES.partner]); // what a form may send
export const GROUP_TENNIS = INQUIRY_TENNIS; // the group edit form reuses the request's five rhythms
export const PREF_LEVELS = INQUIRY_LEVELS; // plus "" (Not sure yet)
export const PREF_LEVEL_UNSURE = 'Not sure yet'; // the SPA's select label for "", accepted and stored as ""
export const PREF_TENNIS = Object.freeze(['Help me decide', 'Four mornings', 'Daily tennis', 'Extra tennis', 'A lighter schedule', 'Non-playing partner']);
export const PREF_ROOMS = Object.freeze(['Help me decide', 'Shared room', 'Private room', 'Interested in an upgrade']);
// The plan's seven interests plus the three the SPA's preferences form offers today.
export const PREF_INTERESTS = Object.freeze([
  'Food + wine', 'Golf', 'Extra tennis', 'Spa', 'Exploring', 'More downtime', 'Culture',
  'Spa + massage', 'Coastal exploring', 'Padel',
]);
export const CONCIERGE_CATEGORIES = Object.freeze(['Stay change', 'Activity', 'Transport', 'Proposal question', 'Other']);
export const ACTION_MESSAGE = 'That action is not available.';
export const YMD_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

function validator(body) {
  const errors = {};
  const value = {};
  const fail = (field, message) => {
    if (!errors[field]) errors[field] = message;
  };
  const done = () => (Object.keys(errors).length ? { ok: false, errors } : { ok: true, value });
  return { errors, value, fail, done, body };
}

const NOT_OBJECT = Object.freeze({ ok: false, errors: Object.freeze({ body: 'Send the request as a JSON object.' }) });

// The action word of a Wave 2 POST, or null when it is not one of `actions`.
export function actionOf(body, actions) {
  if (!isObject(body)) return null;
  const action = asText(body.action);
  return action !== null && actions.includes(action) ? action : null;
}

// An id: text, non-empty, at most 40 characters.
function idField(v, field, message, fail, value) {
  const text = asText(v.body[field]);
  if (text === null || text === '' || text.length > GROUP_LIMITS.id) {
    fail(field, message);
    return;
  }
  value[field] = text;
}

// A choice field whose message is a complete sentence; `allowBlank` admits "".
function choiceField(v, field, set, message, { allowBlank = false } = {}) {
  const text = asText(v.body[field]);
  if (text === null || (!(allowBlank && text === '') && !set.includes(text))) {
    v.fail(field, message);
    return;
  }
  v.value[field] = text;
}

export function validateGroupUpdate(body, weekIds = []) {
  if (!isObject(body)) return NOT_OBJECT;
  const v = validator(body);
  if (actionOf(body, GROUP_ACTIONS) !== 'update') v.fail('action', ACTION_MESSAGE);
  textField(body, 'name', {
    max: GROUP_LIMITS.name, missing: 'Enter a group name.', tooLong: `Keep the group name under ${GROUP_LIMITS.name} characters.`, notText: 'Enter the group name as text.',
  }, v.fail, v.value);
  choiceField(v, 'chosenWeek', [...weekIds, INQUIRY_FLEXIBLE], 'Choose a week from the list, or Flexible.');
  choiceField(v, 'tennis', GROUP_TENNIS, 'Choose a tennis rhythm from the list.');
  choiceField(v, 'paymentMode', PAYMENT_MODES, 'Choose how the group will pay.');
  return v.done();
}

// A member's name (own on join, theirs on add).
function memberName(v, { own }) {
  textField(v.body, 'name', {
    max: GROUP_LIMITS.name, missing: own ? 'Enter your name.' : 'Enter their name.',
    tooLong: `Keep the name under ${GROUP_LIMITS.name} characters.`, notText: 'Enter the name as text.',
  }, v.fail, v.value);
}

const memberRole = (v) => choiceField(v, 'role', MEMBER_ROLES, 'Choose Player or Non-playing partner.');
const participation = (v) => choiceField(v, 'participation', PARTICIPATIONS, 'Choose Interested, Still deciding or Not attending.');
const TARGET_MESSAGE = 'Choose a member of your group.';

// value always carries `action`; the other keys depend on it:
//   open { memberId }                              join { groupId, name, email, role }
//   add { name, email, role }                      invite { memberId, email } (email "" when not sent)
//   cancel / remove { memberId }                   respond { participation }
//   preferences { participation, role, level, tennis, room, roommate, interests, care, complete }
//   arrival { airport, date, flight, time }
export function validateMember(body) {
  if (!isObject(body)) return NOT_OBJECT;
  const v = validator(body);
  const action = actionOf(body, MEMBER_ACTIONS);
  if (!action) {
    v.fail('action', ACTION_MESSAGE);
    return v.done();
  }
  v.value.action = action;
  switch (action) {
    case 'open':
      idField(v, 'memberId', 'Open your personal link again.', v.fail, v.value);
      break;
    case 'join':
      idField(v, 'groupId', 'Open the group link again.', v.fail, v.value);
      memberName(v, { own: true });
      emailField(body, v.fail, v.value);
      memberRole(v);
      break;
    case 'add':
      memberName(v, { own: false });
      emailField(body, v.fail, v.value);
      memberRole(v);
      break;
    case 'invite': {
      idField(v, 'memberId', TARGET_MESSAGE, v.fail, v.value);
      const email = asText(body.email);
      if (email === null) v.fail('email', 'Enter a valid email address.');
      else if (email === '') v.value.email = '';
      else emailField(body, v.fail, v.value);
      break;
    }
    case 'cancel':
    case 'remove':
      idField(v, 'memberId', TARGET_MESSAGE, v.fail, v.value);
      break;
    case 'respond':
      participation(v);
      break;
    case 'preferences': {
      participation(v);
      memberRole(v);
      const level = asText(body.level);
      if (level === null || (level !== '' && level !== PREF_LEVEL_UNSURE && !PREF_LEVELS.includes(level))) v.fail('level', 'Choose a tennis level from the list.');
      else v.value.level = level === PREF_LEVEL_UNSURE ? '' : level;
      choiceField(v, 'tennis', PREF_TENNIS, 'Choose a tennis rhythm from the list.');
      choiceField(v, 'room', PREF_ROOMS, 'Choose a room preference from the list.');
      textField(body, 'roommate', {
        max: GROUP_LIMITS.roommate, tooLong: `Keep the roommate name under ${GROUP_LIMITS.roommate} characters.`, notText: 'Enter the roommate as text.',
      }, v.fail, v.value);
      const list = listOf(body.interests);
      if (list === null) {
        v.fail('interests', 'Interests must be a list.');
      } else {
        const interests = list.map(asText);
        if (interests.some((i) => i === null || !PREF_INTERESTS.includes(i))) v.fail('interests', 'Choose interests from the list.');
        else if (new Set(interests).size !== interests.length) v.fail('interests', 'Each interest can be chosen once.');
        else v.value.interests = interests;
      }
      textField(body, 'care', {
        max: GROUP_LIMITS.care, tooLong: `Keep the care notes under ${GROUP_LIMITS.care.toLocaleString('en-US')} characters.`, notText: 'Enter the care notes as text.',
      }, v.fail, v.value);
      if (body.complete === undefined || body.complete === null) v.value.complete = false;
      else if (typeof body.complete !== 'boolean') v.fail('complete', 'Say whether your planning is complete.');
      else v.value.complete = body.complete;
      break;
    }
    case 'arrival': {
      for (const [field, label] of [['airport', 'airport'], ['flight', 'flight'], ['time', 'arrival time']]) {
        textField(body, field, {
          max: GROUP_LIMITS.arrival, tooLong: `Keep the ${label} under ${GROUP_LIMITS.arrival} characters.`, notText: `Enter the ${label} as text.`,
        }, v.fail, v.value);
      }
      const date = asText(body.date);
      if (date === null) v.fail('date', 'Enter the arrival date as text.');
      else if (!YMD_SHAPE.test(date) && date.length > GROUP_LIMITS.arrivalDate) v.fail('date', `Enter the arrival date as YYYY-MM-DD or a note under ${GROUP_LIMITS.arrivalDate} characters.`);
      else v.value.date = date;
      break;
    }
    default:
      v.fail('action', ACTION_MESSAGE);
  }
  return v.done();
}

// value: { action } plus create { category, subject, details, timing } or { conciergeId }.
export function validateConcierge(body) {
  if (!isObject(body)) return NOT_OBJECT;
  const v = validator(body);
  const action = actionOf(body, CONCIERGE_ACTIONS);
  if (!action) {
    v.fail('action', ACTION_MESSAGE);
    return v.done();
  }
  v.value.action = action;
  if (action === 'create') {
    choiceField(v, 'category', CONCIERGE_CATEGORIES, 'Choose a request type from the list.');
    textField(body, 'subject', {
      max: GROUP_LIMITS.subject, missing: 'Give the request a subject.', tooLong: `Keep the subject under ${GROUP_LIMITS.subject} characters.`, notText: 'Enter the subject as text.',
    }, v.fail, v.value);
    textField(body, 'details', {
      max: GROUP_LIMITS.details, missing: 'Tell us what you need.', tooLong: `Keep the details under ${GROUP_LIMITS.details.toLocaleString('en-US')} characters.`, notText: 'Enter the details as text.',
    }, v.fail, v.value);
    textField(body, 'timing', {
      max: GROUP_LIMITS.timing, tooLong: `Keep the timing under ${GROUP_LIMITS.timing} characters.`, notText: 'Enter the timing as text.',
    }, v.fail, v.value);
  } else {
    idField(v, 'conciergeId', 'Choose a request from your list.', v.fail, v.value);
  }
  return v.done();
}

// value: { action:"accept", proposalId }.
export function validateProposal(body) {
  if (!isObject(body)) return NOT_OBJECT;
  const v = validator(body);
  const action = actionOf(body, PROPOSAL_ACTIONS);
  if (!action) {
    v.fail('action', ACTION_MESSAGE);
    return v.done();
  }
  v.value.action = action;
  idField(v, 'proposalId', 'Open your proposal again.', v.fail, v.value);
  return v.done();
}
