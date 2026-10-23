// public/js/pros-page.js — renders /pros from public/js/pros.js and public/js/trips.js (Phase 2 plan 4.2; polish).
//
// The page is committed with the full markup for every profile so it reads with no JS. This module
// is the single renderer for that markup: the browser re-renders the two regions from the data on
// load (progressive enhancement; the data file is the source of truth), and Node checks that the
// committed markup is exactly what the renderer produces, so the two cannot drift:
//
//   node public/js/pros-page.js --check   # non-zero exit if pros.html drifts from the data (or IMAGES from the manifest)
//   node public/js/pros-page.js --write   # regenerate the regions between <!-- pros:start --> … <!-- pros:end -->
//                                         # and <!-- pros-jump:start --> … <!-- pros-jump:end -->
//
// Placeholders (polish brief, section 4): a row flagged `placeholder: true` (role, base, a fact, the bio,
// an on-court line) is not rendered; an all-placeholder facts row or panel pair renders nothing.
// A trip renders its full card under its first host only; every other host gets one line that links
// to the trip, so no sentence repeats on the page.
//
// No DOM libraries, no dependencies beyond node:fs in the check. Markup conventions follow
// public/index.html: alphabetical attributes, one element per line inside <picture>, literal UTF-8.

import { PROS } from './pros.js';
import { TRIPS, tripsFor } from './trips.js';

// The responsive variants per image key, copied from public/assets/derived/manifest.json so the
// browser needs no fetch. `--check` verifies this table against the manifest; files are
// /assets/derived/<key>-<w>.<webp|ext>. The <img> carries the largest variant's size.
export const IMAGES = Object.freeze({
  'katie-portrait-34': { ext: 'jpg', variants: [{ w: 480, h: 640 }, { w: 499, h: 665 }] },
  'eva-portrait-34': { ext: 'jpg', variants: [{ w: 403, h: 537 }] },
  'spain-card-43': { ext: 'jpg', variants: [{ w: 480, h: 360 }, { w: 960, h: 720 }] },
  'play-katie-eva-clay': { ext: 'jpg', variants: [{ w: 480, h: 1021 }, { w: 960, h: 2042 }] },
  'life-eva-paella': { ext: 'jpg', variants: [{ w: 480, h: 640 }, { w: 768, h: 1024 }] },
  'katie-eva-coast': { ext: 'jpg', variants: [{ w: 480, h: 640 }, { w: 768, h: 1024 }] },
});

// How wide each image is drawn, for `sizes` (see the layout rules at the end of marketing.css).
const PORTRAIT_SIZES = '(min-width:1050px) 32vw, (min-width:700px) 480px, 100vw';
const JUMP_SIZES = '(min-width:1050px) 88px, (min-width:700px) 176px, 30vw'; // the intro's portrait links
const TRIP_SIZES = '(min-width:1050px) 30vw, (min-width:700px) 45vw, 100vw';

const STATUS_TAG = Object.freeze({ invitation: 'Invitation only', waitlist: 'Waitlist', announced: 'Announced' });
const STATUS_LINK = Object.freeze({ invitation: 'Enter with your invitation', announced: 'See the trip' });

export const escapeHtml = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const capitalize = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

const file = (key, w, ext) => `/assets/derived/${key}-${w}.${ext}`;

// A text field that may be a plain string or { text, placeholder }. Returns the text, or null when flagged.
const known = (field) => {
  if (field == null) return null;
  if (typeof field === 'string') return field;
  return field.placeholder ? null : field.text;
};

// <picture> with WebP first, then the original format, width/height from the largest variant.
export function renderPicture({ key, alt, position = null, sizes, eager = false, style = '' }) {
  const image = IMAGES[key];
  if (!image) throw new Error(`pros-page: no image variants for "${key}" (add it to IMAGES from manifest.json)`);
  const largest = image.variants[image.variants.length - 1];
  const srcset = (ext) => image.variants.map(({ w }) => `${file(key, w, ext)} ${w}w`).join(', ');
  const styles = [position ? `object-position:${position}` : '', style].filter(Boolean).join(';');
  const loading = eager ? 'fetchpriority="high" ' : '';
  return [
    '<picture>',
    `<source sizes="${sizes}" srcset="${srcset('webp')}" type="image/webp"/>`,
    `<img alt="${escapeHtml(alt)}" decoding="async" ${loading}height="${largest.h}" loading="${eager ? 'eager' : 'lazy'}" sizes="${sizes}" src="${file(key, largest.w, image.ext)}" srcset="${srcset(image.ext)}"${styles ? ` style="${styles}"` : ''} width="${largest.w}"/>`,
    '</picture>',
  ].join('\n');
}

function renderPortrait(pro, eager) {
  if (!pro.portrait) {
    return `<div aria-hidden="true" class="media-card pro-portrait monogram"><span>${escapeHtml(pro.monogram)}</span></div>`;
  }
  return [
    '<div class="media-card pro-portrait">',
    renderPicture({ ...pro.portrait, sizes: PORTRAIT_SIZES, eager }),
    '</div>',
  ].join('\n');
}

// Only the known facts; nothing at all when none is known.
function renderFacts(pro) {
  const facts = pro.facts.filter((fact) => !fact.placeholder);
  if (!facts.length) return '';
  const items = facts
    .map(({ label, value }) => `<div class="quickfact"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`)
    .join('\n');
  return `<section aria-label="${escapeHtml(pro.name)} at a glance" class="quickfacts trust profile-facts">\n${items}\n</section>`;
}

function renderBase(pro) {
  const base = known(pro.base);
  return base ? `<p class="profile-base"><span class="profile-base-label">Home base</span><span>${escapeHtml(base)}</span></p>` : '';
}

function renderLinks(links) {
  const entries = Object.entries(links || {}).filter(([, href]) => href);
  if (!entries.length) return '';
  const items = entries
    .map(([key, href]) => `<a href="${escapeHtml(href)}" rel="noreferrer">${escapeHtml(capitalize(key))} ↗</a>`)
    .join('');
  return `<p class="profile-links">${items}</p>`;
}

// The About and On court panels, each only when it has something known to say.
function renderPanels(pro) {
  const panels = [];
  const bio = known(pro.bio);
  if (bio) panels.push(`<div class="panel"><h3 class="profile-label">About</h3><p>${escapeHtml(bio)}</p></div>`);
  const lines = pro.onCourt.filter((line) => !line.placeholder).map(({ text }) => `<li>${escapeHtml(text)}</li>`).join('');
  if (lines) panels.push(`<div class="panel"><h3 class="profile-label">On court</h3><ul class="on-court">${lines}</ul></div>`);
  return panels.length ? `<div class="profile-panels">\n${panels.join('\n')}\n</div>` : '';
}

const firstName = (pro) => pro.name.split(' ')[0];

// The full card: under the trip's first host. The art carries the timing in italic, the heading the
// name, the meta line the place, so nothing is said twice.
export function renderTrip(trip, pro) {
  const tag = STATUS_TAG[trip.status] || capitalize(trip.status);
  const art = trip.photo
    ? [
        '<div class="trip-art has-photo">',
        renderPicture({ ...trip.photo, sizes: TRIP_SIZES }),
        `<span aria-hidden="true">${escapeHtml(trip.timing)}</span>`,
        '</div>',
      ].join('\n')
    : `<div aria-hidden="true" class="trip-art"><span>${escapeHtml(trip.timing)}</span></div>`;
  const body = [
    `<div class="caps trip-tag">${escapeHtml(tag)}</div>`,
    `<h3>${escapeHtml(trip.name)}</h3>`,
    `<p class="trip-meta">${escapeHtml(trip.place)} · ${escapeHtml(trip.timing)}</p>`,
    trip.blurb ? `<p>${escapeHtml(capitalize(trip.blurb))}</p>` : '',
    trip.price ? `<p class="trip-meta">${escapeHtml(trip.price)}</p>` : '',
  ];
  if (trip.link) {
    body.push(`<a class="secondary" href="${escapeHtml(trip.link)}">${STATUS_LINK[trip.status] || 'See the trip'}</a>`);
  }
  return [
    `<article class="trip-card" id="${escapeHtml(pro.id)}-trip-${escapeHtml(trip.id)}">`,
    art,
    '<div class="trip-body">',
    ...body.filter(Boolean),
    '</div>',
    '</article>',
  ].join('\n');
}

// One line for a co-host: "Co-hosts The Spanish Offseason with Katie", linking to the trip.
export function renderTripLine(trip, pro) {
  const lead = PROS.find((p) => p.id === trip.hostIds[0]);
  const text = `Co-hosts ${trip.name}${lead ? ` with ${firstName(lead)}` : ''}`;
  const inner = trip.link ? `<a href="${escapeHtml(trip.link)}">${escapeHtml(text)}</a>` : escapeHtml(text);
  return `<p class="profile-trip-line" id="${escapeHtml(pro.id)}-trip-${escapeHtml(trip.id)}">${inner}</p>`;
}

function renderTrips(pro) {
  const trips = tripsFor(pro.id);
  if (!trips.length) {
    return '<div class="profile-trips">\n<h3 class="profile-label">Trips</h3>\n<p class="placeholder">Trips to be announced.</p>\n</div>';
  }
  const cards = trips.filter((trip) => trip.hostIds[0] === pro.id);
  const lines = trips.filter((trip) => trip.hostIds[0] !== pro.id);
  const parts = [];
  if (cards.length) parts.push(`<div class="trip-grid">\n${cards.map((trip) => renderTrip(trip, pro)).join('\n')}\n</div>`);
  parts.push(...lines.map((trip) => renderTripLine(trip, pro)));
  return `<div class="profile-trips">\n<h3 class="profile-label">Trips</h3>\n${parts.join('\n')}\n</div>`;
}

// One profile section. `eager` loads the portrait first (the first profile on the page);
// `band` is 'paper' for the alternate background.
export function renderPro(pro, { eager = false, band = 'cream' } = {}) {
  const role = known(pro.role);
  return [
    `<section aria-labelledby="${escapeHtml(pro.id)}Name" class="section${band === 'paper' ? ' band-paper' : ''} profile-section" id="${escapeHtml(pro.id)}">`,
    '<div class="section-inner profile">',
    '<div class="profile-media">',
    renderPortrait(pro, eager),
    '</div>',
    '<div class="profile-body">',
    role ? `<div class="eyebrow">${escapeHtml(role)}</div>` : '',
    `<h2 id="${escapeHtml(pro.id)}Name">${escapeHtml(pro.name)}</h2>`,
    renderBase(pro),
    renderLinks(pro.links),
    renderFacts(pro),
    renderPanels(pro),
    renderTrips(pro),
    '<div class="section-cta"><a class="primary" href="/invite">Enter invite code</a></div>',
    '</div>',
    '</div>',
    '</section>',
  ].filter(Boolean).join('\n');
}

// The intro's portrait links: one per pro, in page order (a row of three on phones, a column from 1050px).
export function renderJump() {
  const links = PROS.map((pro) => {
    const portrait = pro.portrait
      ? `<span class="pro-portrait">\n${renderPicture({ ...pro.portrait, sizes: JUMP_SIZES })}\n</span>`
      : `<span aria-hidden="true" class="pro-portrait monogram"><span>${escapeHtml(pro.monogram)}</span></span>`;
    return `<a href="#${escapeHtml(pro.id)}">\n${portrait}\n<span class="pros-jump-name">${escapeHtml(pro.name)}</span>\n</a>`;
  }).join('\n');
  return `<nav aria-label="Pros on this page" class="pros-jump">\n${links}\n</nav>`;
}

// Everything inside #prosRoot: one section per pro, backgrounds alternating cream / paper, the first portrait eager.
export function renderAll() {
  return PROS.map((pro, i) => renderPro(pro, { eager: i === 0, band: i % 2 ? 'paper' : 'cream' })).join('\n');
}

export const START = '<!-- pros:start -->';
export const END = '<!-- pros:end -->';
export const JUMP_START = '<!-- pros-jump:start -->';
export const JUMP_END = '<!-- pros-jump:end -->';

const REGIONS = [
  { id: 'prosJump', start: JUMP_START, end: JUMP_END, render: renderJump },
  { id: 'prosRoot', start: START, end: END, render: renderAll },
];

// Browser: re-render from the data so pros.js is what the reader sees even if pros.html lags.
// The rendered markup is parsed into a template and compared with the live DOM through the same
// serializer, so when the committed page already matches (the normal case) nothing is touched: no
// image re-requests, and a fresh load of /pros#eva keeps the element the browser scrolled to. When
// a region is stale it is swapped and the hash target is scrolled to again.
if (typeof document !== 'undefined') {
  let swapped = false;
  for (const region of REGIONS) {
    const root = document.getElementById(region.id);
    if (!root) continue;
    const next = document.createElement('template');
    next.innerHTML = `${region.start}\n${region.render()}\n${region.end}`;
    // Compare with whitespace collapsed: the committed region is pretty-printed, the rendered one is
    // not, and that difference alone must not force a DOM swap (QA finding, Phase 2).
    const norm = (html) => html.replace(/\s+/g, ' ').trim();
    if (norm(next.innerHTML) !== norm(root.innerHTML)) { root.replaceChildren(next.content); swapped = true; }
  }
  // Land on the fragment again once layout is final. The browser's own jump happens before the eager
  // portrait and the fonts settle, which can leave the target well below the header on a phone.
  const landOnHash = () => {
    const target = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (target) target.scrollIntoView({ behavior: 'instant', block: 'start' });
  };
  if (location.hash && document.getElementById('prosRoot')) {
    if (swapped) landOnHash();
    addEventListener('load', landOnHash, { once: true });
  }
}

// Node: `--check` compares the committed regions with the renderer, `--write` regenerates them.
if (typeof document === 'undefined' && typeof process !== 'undefined' && Array.isArray(process.argv)) {
  const mode = process.argv.includes('--write') ? 'write' : process.argv.includes('--check') ? 'check' : null;
  if (mode) {
    const fs = await import('node:fs');
    const htmlPath = new URL('../pros.html', import.meta.url);
    const manifestPath = new URL('../assets/derived/manifest.json', import.meta.url);
    const problems = [];

    // IMAGES must mirror the manifest (same variants, same sizes, files present).
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const [key, image] of Object.entries(IMAGES)) {
      const entry = manifest[key];
      if (!entry) { problems.push(`IMAGES["${key}"] is not in manifest.json`); continue; }
      for (const { w, h } of image.variants) {
        for (const ext of ['webp', image.ext]) {
          const variant = entry.variants.find((v) => v.file === file(key, w, ext));
          if (!variant) problems.push(`IMAGES["${key}"]: ${file(key, w, ext)} is not in manifest.json`);
          else if (variant.width !== w || variant.height !== h) problems.push(`IMAGES["${key}"] ${w}w: manifest says ${variant.width}×${variant.height}, table says ${w}×${h}`);
          if (!fs.existsSync(new URL(`..${file(key, w, ext)}`, import.meta.url))) problems.push(`${file(key, w, ext)} is missing on disk`);
        }
      }
    }
    // Data sanity: unique ids, portraits with variants, four facts, a monogram for anyone without a photo,
    // a role (known or flagged), trips whose photo keys have variants and whose hosts exist.
    const ids = new Set();
    for (const pro of PROS) {
      if (ids.has(pro.id)) problems.push(`duplicate pro id "${pro.id}"`);
      ids.add(pro.id);
      if (!/^[a-z][a-z0-9-]*$/.test(pro.id)) problems.push(`pro id "${pro.id}" must be lowercase letters, digits and hyphens`);
      if (pro.portrait && !IMAGES[pro.portrait.key]) problems.push(`${pro.id}: portrait key "${pro.portrait.key}" has no IMAGES entry`);
      if (pro.portrait && 'crop' in pro.portrait) problems.push(`${pro.id}: portrait.crop is gone; declare a crop in scripts/make-images.js and use its key`);
      if (!pro.portrait && !pro.monogram) problems.push(`${pro.id}: no portrait and no monogram`);
      if (!Array.isArray(pro.facts) || pro.facts.length !== 4) problems.push(`${pro.id}: the facts row takes exactly four facts`);
      if (!pro.name) problems.push(`${pro.id}: name is required`);
      if (!(typeof pro.role === 'string' ? pro.role : pro.role && pro.role.text)) problems.push(`${pro.id}: role is required (a string, or { text, placeholder: true })`);
    }
    for (const trip of TRIPS) {
      if (trip.photo && !IMAGES[trip.photo.key]) problems.push(`trip ${trip.id}: photo key "${trip.photo.key}" has no IMAGES entry`);
      for (const host of trip.hostIds) if (!ids.has(host)) problems.push(`trip ${trip.id}: host "${host}" is not a pro id`);
    }

    let html = fs.readFileSync(htmlPath, 'utf8');
    let next = html;
    for (const region of REGIONS) {
      const rendered = `${region.start}\n${region.render()}\n${region.end}`;
      const start = next.indexOf(region.start);
      const end = next.indexOf(region.end);
      if (start < 0 || end < 0 || end < start) { problems.push(`pros.html has no ${region.start} … ${region.end} region`); continue; }
      const committed = next.slice(start, end + region.end.length);
      if (mode === 'write') {
        next = next.slice(0, start) + rendered + next.slice(end + region.end.length);
      } else if (committed !== rendered) {
        const a = committed.split('\n');
        const b = rendered.split('\n');
        const line = a.findIndex((text, i) => text !== b[i]);
        problems.push(`pros.html drifts from pros.js in #${region.id} at region line ${line + 1}:\n  committed: ${JSON.stringify(a[line] ?? '<end>')}\n  rendered:  ${JSON.stringify(b[line] ?? '<end>')}\n  run: node public/js/pros-page.js --write`);
      }
    }

    if (mode === 'write' && !problems.length) {
      if (next !== html) fs.writeFileSync(htmlPath, next);
      console.log(`pros-page: ${next === html ? 'pros.html already matches pros.js' : 'wrote the pros regions of pros.html from pros.js'}`);
    }

    if (problems.length) {
      console.error(`pros-page --${mode}: ${problems.length} problem${problems.length === 1 ? '' : 's'}`);
      for (const problem of problems) console.error(`- ${problem}`);
      process.exit(1);
    }
    if (mode === 'check') console.log(`pros-page --check: pros.html matches pros.js (${PROS.length} pros) and IMAGES matches manifest.json`);
  }
}
