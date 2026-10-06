// lib/catalog.js
// Server copy of the builder catalog (plan section 2): the ids and values POST /api/request
// accepts, and the display names it writes into the Requests tab. The names are the exact
// strings from js/site.js (roomData, tennisData) and site.html (<strong> add-on names, vetted
// options); tests/api.catalog.test.js checks them against those files. Do not add, rename or
// reprice; pricing stays client side (plan section 3).

const freezeAll = (list) => Object.freeze(list.map((item) => (typeof item === 'object' ? Object.freeze(item) : item)));

export const TRIP_ID = 'spain';
export const REQUEST_TYPES = Object.freeze(['private', 'vetted']);

export const WEEKS = freezeAll([
  { id: 'w1', label: 'Jan 10–16' },
  { id: 'w2', label: 'Jan 17–23' },
  { id: 'w3', label: 'Jan 24–30' },
  { id: 'w4', label: 'Jan 31–Feb 6' },
  { id: 'w5', label: 'Feb 7–13' },
  { id: 'w6', label: 'Feb 14–20' },
  { id: 'w7', label: 'Feb 21–27' },
]);
export const WEEK_IDS = Object.freeze(WEEKS.map((w) => w.id));

export const ROOMS = freezeAll([
  { id: 'deluxe', name: 'Deluxe' },
  { id: 'club', name: 'Club View' },
  { id: 'terrace', name: 'Superior Terrace' },
  { id: 'junior', name: 'Junior Suite' },
  { id: 'royal', name: 'Royal Suite' },
]);

export const TENNIS = freezeAll([
  { id: 'light', name: '2–3 mornings' },
  { id: 'core', name: '4 mornings + Eva' },
  { id: 'daily', name: 'Daily tennis' },
  { id: 'custom', name: 'Custom tennis' },
]);

// type: player = per selected player (qty), guest = per guest (qty), group = one per group,
// none = no cost. driver and free carry no qty (plan 10.7).
export const ADDON_TYPES = Object.freeze(['player', 'guest', 'group', 'none']);
export const ADDONS = freezeAll([
  { id: 'eva', name: 'Extra session with Eva', type: 'player' },
  { id: 'padel', name: 'Padel', type: 'player' },
  { id: 'massage', name: 'Massage', type: 'guest' },
  { id: 'golf', name: 'Round of golf', type: 'guest' },
  { id: 'alicante', name: 'Alicante day', type: 'guest' },
  { id: 'cartagena', name: 'Cartagena day', type: 'guest' },
  { id: 'food', name: 'Food / winery experience', type: 'guest' },
  { id: 'dinner', name: 'Extra curated dinner', type: 'guest' },
  { id: 'driver', name: 'Private 6-hour driver / excursion', type: 'group' },
  { id: 'free', name: 'Please do not overschedule me.', type: 'none' },
]);

export const PARTY_TYPES = Object.freeze(['Solo', 'Couple', '2–3 friends']);
export const LEVELS = Object.freeze(['2.5', '3.0', '3.5', '4.0', '4.5', '5.0+', 'Mixed / not sure']);
export const TENNIS_STYLES = Object.freeze(['Social + fun', 'Balanced', 'Competitive / serious', 'Mostly here for the trip']);
export const TRAVEL_STYLES = Object.freeze(['Very social', 'Balanced', 'Independent']);
export const PRIORITIES = Object.freeze(['Great tennis', 'Food + long lunches', 'Wellness + spa', 'Golf', 'Exploring', 'Downtime']);

// Players 4–12, partners 0–12, single rooms 0 to players + partners.
export const RANGES = Object.freeze({
  players: Object.freeze({ min: 4, max: 12 }),
  partners: Object.freeze({ min: 0, max: 12 }),
  singleRooms: Object.freeze({ min: 0 }),
});

// Character limits (plan 4.4).
export const LIMITS = Object.freeze({ note: 2000, brief: 5000, estimate: 60 });

const index = (list) => new Map(list.map((item) => [item.id, item]));
const ROOM_BY_ID = index(ROOMS);
const TENNIS_BY_ID = index(TENNIS);
const ADDON_BY_ID = index(ADDONS);
const WEEK_BY_ID = index(WEEKS);

export const isWeekId = (id) => WEEK_BY_ID.has(id);
export const roomById = (id) => ROOM_BY_ID.get(id) || null;
export const tennisById = (id) => TENNIS_BY_ID.get(id) || null;
export const addonById = (id) => ADDON_BY_ID.get(id) || null;
export const roomName = (id) => roomById(id)?.name ?? '';
export const tennisName = (id) => tennisById(id)?.name ?? '';
