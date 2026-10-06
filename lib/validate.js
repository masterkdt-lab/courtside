// lib/validate.js
// POST /api/request body validation (plan 4.4, 10.5–10.7). validateRequest(body) returns
// { ok: true, value } with trimmed and coerced values, or { ok: false, errors: { field: message } }.
// Messages are short plain English for the request modal's error line. Unknown fields are
// ignored; the identity fields never come from the body (plan 4.7).

import {
  ADDONS, LEVELS, LIMITS, PARTY_TYPES, PRIORITIES, RANGES, REQUEST_TYPES, ROOMS, TENNIS,
  TENNIS_STYLES, TRAVEL_STYLES, WEEK_IDS, addonById,
} from './catalog.js';

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
