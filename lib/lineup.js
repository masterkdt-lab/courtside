// lib/lineup.js
// The public trip lineup as the server sees it (polish brief section 3). The one place api/ reads
// public/js/trips.js, so the ids POST /api/waitlist and POST /api/event accept and the trip names
// written to the Waitlist tab come from the same file the homepage renders. trips.js is a plain
// ES module with no DOM access at import, so importing it here is safe on Vercel and in node --test.

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
