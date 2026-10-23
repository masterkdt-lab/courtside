// public/js/trips.js — the trips shown on the public pages (Phase 2 plan 4.1, decision 2).
// Source of truth for /pros ("trips she hosts" is TRIPS filtered by hostIds). The homepage
// writes the same cards out by hand in index.html so it reads with no JS; keep the two in step.
//
// Fields: id, name, place, timing, blurb (one line or ''), status ('invitation' | 'waitlist' |
// 'announced'), price (string or null; only what public/site.html already says), photo
// ({ key, alt, position } — key is a public/assets/derived/manifest.json entry, a named crop from
// scripts/make-images.js where one exists — or null: the waitlist cards use the sage→espresso
// gradient panel with the timing in italic, never a Spain photo), hostIds (ids in
// public/js/pros.js), link (string or null).
// Decision 7: no guest counts, prices, ratings or dates beyond what KC gave.

export const TRIPS = Object.freeze([
  {
    id: 'spain',
    name: 'The Spanish Offseason',
    place: 'Costa Blanca, Spain',
    timing: 'Winter 2027',
    blurb: 'seven Sunday–Saturday weeks, January 10 – February 27, 2027',
    status: 'invitation',
    price: 'from $2,995 per player, six nights',
    photo: {
      key: 'spain-card-43',
      alt: 'Katie and Eva celebrating together on a clay court in Spain',
      position: null,
    },
    hostIds: ['katie', 'eva'],
    link: '/invite',
  },
  {
    id: 'charleston',
    name: 'Charleston',
    place: 'Charleston',
    timing: 'late March + early April 2027',
    blurb: 'A local green-clay week + the Charleston Open.',
    status: 'waitlist',
    price: null,
    photo: null,
    hostIds: [],
    link: null,
  },
  {
    id: 'geneva',
    name: 'Geneva',
    place: 'Geneva',
    timing: 'May 2027',
    blurb: '',
    status: 'waitlist',
    price: null,
    photo: null,
    hostIds: [],
    link: null,
  },
  {
    id: 'mallorca',
    name: 'Mallorca',
    place: 'Mallorca',
    timing: 'June 2027',
    blurb: '',
    status: 'waitlist',
    price: null,
    photo: null,
    hostIds: [],
    link: null,
  },
  {
    id: 'new-york',
    name: 'New York',
    place: 'New York',
    timing: 'the full US Open window, 2027',
    blurb: '',
    status: 'waitlist',
    price: null,
    photo: null,
    hostIds: [],
    link: null,
  },
  {
    id: 'los-angeles',
    name: 'Los Angeles',
    place: 'Los Angeles',
    timing: 'the Laver Cup, September 24–26, 2027',
    blurb: '',
    status: 'waitlist',
    price: null,
    photo: null,
    hostIds: [],
    link: null,
  },
  {
    id: 'fall-residency',
    name: 'Fall offseason residency',
    place: 'To be announced',
    timing: 'October to the week before Thanksgiving, 2027',
    blurb: '',
    status: 'waitlist',
    price: null,
    photo: null,
    hostIds: [],
    link: null,
  },
]);

// The trips a pro hosts, in homepage order. Empty means "Trips to be announced".
export const tripsFor = (hostId) => TRIPS.filter((trip) => trip.hostIds.includes(hostId));

// Kept for anything that still imports it; the public pages no longer show a note under
// "Join the waitlist" (the capture form in public/js/home.js took its place).
export const WAITLIST_NOTE = 'Waitlist opens soon. Invitations go out first; check back or ask Katie.';
