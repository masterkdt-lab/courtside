// lib/lineup.js
// The public trip lineup as the server sees it (polish brief section 3). The one place api/ reads
// public/js/trips.js, so the ids POST /api/waitlist and POST /api/event accept and the trip names
// written to the Waitlist tab come from the same file the Concept 02 SPA's waitlist interests map
// to. trips.js is a plain ES module with no DOM access at import, so importing it here is safe on
// Vercel and in node --test. (The SPA itself does not load trips.js; it stays for this file.)

import { TRIPS } from '../public/js/trips.js';

// The "no particular trip" choice: the bottom-of-page "Join the waitlist" button.
export const GENERAL_TRIP_ID = 'general';
export const GENERAL_TRIP_NAME = 'General';

export const TRIP_IDS = Object.freeze(TRIPS.map((trip) => trip.id));
export const WAITLIST_TRIP_IDS = Object.freeze([...TRIP_IDS, GENERAL_TRIP_ID]);

const NAME_BY_ID = new Map(TRIPS.map((trip) => [trip.id, trip.name]));

export const isTripId = (id) => NAME_BY_ID.has(id);
export const isWaitlistTripId = (id) => id === GENERAL_TRIP_ID || NAME_BY_ID.has(id);

// The display name the Waitlist tab stores: the trip's `name` from trips.js, or "General".
// Unknown ids return '' (the validators refuse them first).
export function tripName(id) {
  if (id === GENERAL_TRIP_ID) return GENERAL_TRIP_NAME;
  return NAME_BY_ID.get(id) ?? '';
}

// Concept 02 waitlist (CONCEPT02_PLAN.md): the "I'm interested in" select on #/waitlist. Three of
// the five map to a trip in trips.js (the Waitlist row gets that trip's name); the other two are
// written as the interest text itself. The apostrophe in "Katie’s" is U+2019, as in the SPA.
export const INTERESTS = Object.freeze([
  'Spain with Katie + Eva',
  'Katie’s future trips',
  'Future Courtside experiences',
  'Mallorca · future idea',
  'Charleston · future idea',
]);
const TRIP_ID_BY_INTEREST = new Map([
  ['Spain with Katie + Eva', 'spain'],
  ['Mallorca · future idea', 'mallorca'],
  ['Charleston · future idea', 'charleston'],
]);

// A typed straight apostrophe counts as the curly one; everything else must match exactly.
export const normalizeInterest = (text) => String(text ?? '').replace(/'/g, '’');
export const isInterest = (text) => INTERESTS.includes(text);

// The trips.js id behind an interest, or '' for the two that name no trip.
export function interestTripId(interest) {
  return TRIP_ID_BY_INTEREST.get(interest) ?? '';
}

// What the Waitlist `trip` column holds for an interest: the trip's name, or the interest text.
export function interestTripName(interest) {
  const id = interestTripId(interest);
  return id ? tripName(id) : String(interest ?? '');
}
