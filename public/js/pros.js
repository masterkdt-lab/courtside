// public/js/pros.js — the pros shown on /pros (Phase 2 plan 4.2, decision 4) and teased on /.
// Source of truth for /pros: public/js/pros-page.js renders every profile section and the intro's
// portrait links from this file, and the markup committed between <!-- pros:start --> / <!-- pros:end -->
// and <!-- pros-jump:start --> / <!-- pros-jump:end --> in public/pros.html must be exactly what it
// renders (`node public/js/pros-page.js --check` fails on drift; `--write` regenerates both). A pro's
// trips come from public/js/trips.js via each trip's hostIds.
//
// Decision 7, polish brief section 4: nothing here is invented, and nothing flagged `placeholder: true`
// is rendered. The placeholder rows stay in the file so Katie's facts drop in without a rewrite; until
// then the page shows only what is known (Nelson: name, monogram, "Trips to be announced").
// No numbers, levels, years, ratings or prices belong in this file.
//
// Photos: who is in which photo, and which crop shows whom, is in public/assets/PHOTOS.md. The
// portrait `key` is a crop or image name from public/assets/derived/manifest.json.
//
// Field by field, see the commented template entry at the end of the array.

export const PROS = Object.freeze([
  {
    id: 'katie',
    name: 'Katie Delich',
    role: 'Founder + host, Courtside Travel Co.',
    base: null,
    portrait: {
      key: 'katie-portrait-34',
      alt: 'Katie on a clay court in Spain',
      position: null,
    },
    monogram: 'KD',
    facts: [
      { label: 'Club de Tenis · home court', value: 'Almoradí', placeholder: false },
      { label: 'hosts The Spanish Offseason', value: 'Spain', placeholder: false },
      { label: 'playing level', value: 'To come', placeholder: true },
      { label: 'coaching', value: 'To come', placeholder: true },
    ],
    bio: { text: 'Bio to come.', placeholder: true },
    onCourt: [
      { text: 'Club de Tenis Almoradí is her tennis home in Spain.', placeholder: false },
      { text: 'Co-hosts The Spanish Offseason with Eva.', placeholder: false },
      { text: 'Playing level: details to come.', placeholder: true },
      { text: 'Coaching: details to come.', placeholder: true },
    ],
    links: {},
  },
  {
    id: 'eva',
    name: 'Eva',
    role: 'Co-host, The Spanish Offseason · Club de Tenis Almoradí',
    base: null,
    portrait: {
      key: 'eva-portrait-34',
      alt: 'Eva on a clay court in Spain',
      position: null,
    },
    monogram: 'E',
    facts: [
      { label: 'Club de Tenis · home club', value: 'Almoradí', placeholder: false },
      { label: 'co-hosts The Spanish Offseason', value: 'Spain', placeholder: false },
      { label: 'playing level', value: 'To come', placeholder: true },
      { label: 'coaching', value: 'To come', placeholder: true },
    ],
    bio: { text: 'Bio to come.', placeholder: true },
    onCourt: [
      { text: 'Club de Tenis Almoradí is her home club.', placeholder: false },
      { text: 'Co-hosts The Spanish Offseason with Katie.', placeholder: false },
      { text: 'Playing level: details to come.', placeholder: true },
      { text: 'Coaching: details to come.', placeholder: true },
    ],
    links: {},
  },
  {
    id: 'nelson',
    name: 'Nelson Ramos',
    role: { text: 'Role to come', placeholder: true },
    base: null,
    portrait: null,
    monogram: 'NR',
    facts: [
      { label: 'home court', value: 'To come', placeholder: true },
      { label: 'hosts', value: 'To come', placeholder: true },
      { label: 'playing level', value: 'To come', placeholder: true },
      { label: 'coaching', value: 'To come', placeholder: true },
    ],
    bio: { text: 'Bio to come.', placeholder: true },
    onCourt: [
      { text: 'Home court: details to come.', placeholder: true },
      { text: 'Playing level: details to come.', placeholder: true },
      { text: 'Coaching: details to come.', placeholder: true },
    ],
    links: {},
  },
  // Template for the next pro. Copy it above this comment, fill it in, then run
  // `node public/js/pros-page.js --write` and `--check`, and add the card to the homepage teaser.
  // {
  //   id: 'firstname',            // URL anchor (/pros#firstname) and the id trips.js hostIds point at; lowercase, unique
  //   name: 'First Last',         // shown as the section heading, exactly as the pro spells it
  //   role: 'Co-host, …',         // one line over the name; { text: 'Role to come', placeholder: true } until KC gives it (not rendered)
  //   base: null,                 // home base as a short string ('Napa, California') or null (the line is not rendered)
  //   portrait: {                 // null renders the brand monogram panel instead of a photo
  //     key: 'katie-portrait-34', //   a crop or image in public/assets/derived/manifest.json (add crops in scripts/make-images.js, then `npm run images`)
  //     alt: 'Who, where',        //   alt text that says who is in the photo and where (check public/assets/PHOTOS.md)
  //     position: null,           //   CSS object-position like '50% 30%', or null for the .pro-portrait default
  //   },
  //   monogram: 'FL',             // one or two initials for the monogram panel (used when portrait is null)
  //   facts: [                    // four facts for the .quickfacts row; placeholders are skipped, an all-placeholder row is not rendered
  //     { label: 'home court', value: 'To come', placeholder: true },   // label is the small caps line, value the big serif
  //     { label: 'hosts', value: 'To come', placeholder: true },
  //     { label: 'playing level', value: 'To come', placeholder: true },
  //     { label: 'coaching', value: 'To come', placeholder: true },
  //   ],
  //   bio: { text: 'Bio to come.', placeholder: true },   // the "About" paragraph; placeholder: false once KC supplies the bio
  //   onCourt: [                                           // the "On court" list, one line each, known lines first; placeholders are skipped
  //     { text: 'Home court: details to come.', placeholder: true },
  //     { text: 'Playing level: details to come.', placeholder: true },
  //     { text: 'Coaching: details to come.', placeholder: true },
  //   ],
  //   links: {},                  // optional public profiles, e.g. { instagram: 'https://www.instagram.com/handle' }; rendered as plain links
  // },
]);

// Lookup by id, for the homepage teaser or anything else that needs one pro.
export const proById = (id) => PROS.find((pro) => pro.id === id) || null;
