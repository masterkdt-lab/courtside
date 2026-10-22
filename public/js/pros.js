// public/js/pros.js — the pros shown on /pros (Phase 2 plan 4.2, decision 4) and teased on /.
// Source of truth for /pros: public/js/pros-page.js renders every profile section from this file,
// and the markup committed between <!-- pros:start --> and <!-- pros:end --> in public/pros.html
// must be exactly what it renders (`node public/js/pros-page.js --check` fails on drift;
// `--write` regenerates it). A pro's trips come from public/js/trips.js via each trip's hostIds.
//
// Decision 7: nothing here is invented. Anything KC has not given is a visible placeholder
// (`placeholder: true`, shown in the .placeholder style with honest text such as "Details to come"),
// never a guess. No numbers, levels, years, ratings or prices belong in this file.
//
// Field by field, see the commented template entry at the end of the array.

export const PROS = Object.freeze([
  {
    id: 'katie',
    name: 'Katie Delich',
    role: 'Founder + host, Courtside Travel Co.',
    base: null,
    portrait: {
      key: 'play-katie-eva-clay',
      alt: 'Katie on a clay court in Spain',
      crop: 'right',
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
      key: 'life-eva-paella',
      alt: 'Eva with paella by the water',
      crop: null,
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
    role: 'Role to come',
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
  //   role: 'Role to come',       // one line under the eyebrow, e.g. 'Co-host, The Spanish Offseason'; 'Role to come' until KC gives it
  //   base: null,                 // home base as a short string ('Napa, California') or null, which renders "Details to come"
  //   portrait: {                 // null renders the brand monogram panel instead of a photo
  //     key: 'life-eva-paella',   //   an entry in public/assets/derived/manifest.json (run `npm run images` after adding a photo)
  //     alt: 'Who, where',        //   alt text that says who is in the photo and where
  //     crop: null,               //   'right' shows the right half of a two-person photo (.crop-right); null shows the whole frame
  //     position: null,           //   CSS object-position like '50% 30%', or null for the .pro-portrait default (50% 25%)
  //   },
  //   monogram: 'FL',             // one or two initials for the monogram panel (used when portrait is null)
  //   facts: [                    // four facts for the .quickfacts row (2 columns on phones, 4 above 700px)
  //     { label: 'home court', value: 'To come', placeholder: true },   // label is the small caps line, value the big serif
  //     { label: 'hosts', value: 'To come', placeholder: true },        // placeholder: true renders the value in the .placeholder style
  //     { label: 'playing level', value: 'To come', placeholder: true },
  //     { label: 'coaching', value: 'To come', placeholder: true },
  //   ],
  //   bio: { text: 'Bio to come.', placeholder: true },   // the "About" paragraph; placeholder: false once KC supplies the bio
  //   onCourt: [                                           // the "On court" list, one line each, known lines first
  //     { text: 'Home court: details to come.', placeholder: true },
  //     { text: 'Playing level: details to come.', placeholder: true },
  //     { text: 'Coaching: details to come.', placeholder: true },
  //   ],
  //   links: {},                  // optional public profiles, e.g. { instagram: 'https://www.instagram.com/handle' }; rendered as plain links
  // },
]);

// Lookup by id, for the homepage teaser or anything else that needs one pro.
export const proById = (id) => PROS.find((pro) => pro.id === id) || null;
