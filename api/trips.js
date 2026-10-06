// api/trips.js — GET /api/trips (plan 4.4; cookie required, else 401)
//   200 { trips:[{ tripId, name, status, closedMessage }],
//         weeks:[{ weekId, tripId, label, start, end, status, closedMessage }] }
// Module-level cache with a 60-second TTL, so a Sheet edit shows within a minute (plan 4.3).
// POST /api/request never uses this cache.

import * as store from '../lib/store.js';
import { getSecret } from '../lib/env.js';
import { isAllowed } from '../lib/guard.js';
import { json } from '../lib/http.js';

export const TRIPS_CACHE_TTL_MS = 60 * 1000;

let cache = null; // { at, data: { trips, weeks } }

export function _resetTripsCache() {
  cache = null;
}

export async function GET(request) {
  if (!(await isAllowed(request, getSecret()))) return json(401, { ok: false, reason: 'unauthorized' });
  try {
    const now = Date.now();
    if (!cache || now - cache.at >= TRIPS_CACHE_TTL_MS) {
      const [trips, weeks] = await Promise.all([store.listTrips(), store.listWeeks()]);
      cache = { at: now, data: { trips, weeks } };
    }
    return json(200, cache.data);
  } catch (err) {
    console.error('[api/trips]', err);
    return json(500, { ok: false, reason: 'server_error' });
  }
}
