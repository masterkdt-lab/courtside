// api/lineup.js — GET /api/lineup (CONCEPT02_PLAN.md; public, no cookie, read-only)
//   200 { trip: { tripId:"spain", name, status, closedMessage } | null,
//         weeks: [{ weekId, label, start, end, status, closedMessage }] }
// The Spain trip row and its weeks from the Trips and Weeks tabs, for the #/request step 1 week
// options (closed weeks are shown disabled with their closedMessage). Module-level cache with a
// 60-second TTL like /api/trips, so a Sheet edit shows within a minute. A missing trip row is not
// an error: trip is null and the weeks still list. POST /api/inquiry never uses this cache; it
// calls readLineup() for a fresh read.

import * as store from '../lib/store.js';
import { TRIP_ID } from '../lib/catalog.js';
import { json } from '../lib/http.js';
import { withSheetScope } from '../lib/request-scope.js';

export const LINEUP_CACHE_TTL_MS = 60 * 1000;
export const LINEUP_TRIP_ID = TRIP_ID;

let cache = null; // { at, data: { trip, weeks } }

export function _resetLineupCache() {
  cache = null;
}

// A store week -> the public week shape (no tripId: every week here belongs to the one trip).
export function toLineupWeek(week) {
  return {
    weekId: week.weekId,
    label: week.label,
    start: week.start,
    end: week.end,
    status: week.status,
    closedMessage: week.closedMessage,
  };
}

// Fresh from the store (no cache): the Spain trip row (or null) and its weeks in sheet order.
export async function readLineup() {
  const [trips, weeks] = await Promise.all([store.listTrips(), store.listWeeks()]);
  const trip = trips.find((t) => t.tripId === LINEUP_TRIP_ID) || null;
  return {
    trip: trip ? { tripId: trip.tripId, name: trip.name, status: trip.status, closedMessage: trip.closedMessage } : null,
    weeks: weeks.filter((w) => w.tripId === LINEUP_TRIP_ID).map(toLineupWeek),
  };
}

async function handleGet() {
  try {
    const now = Date.now();
    if (!cache || now - cache.at >= LINEUP_CACHE_TTL_MS) cache = { at: now, data: await readLineup() };
    return json(200, cache.data);
  } catch (err) {
    console.error('[api/lineup]', err);
    return json(500, { ok: false, reason: 'server_error' });
  }
}

// One request scope per call: every store read in the request shares one Sheets snapshot
// (lib/request-scope.js, lib/store.sheets.js).
export const GET = withSheetScope(handleGet);
