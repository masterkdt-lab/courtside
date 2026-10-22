// public/js/pros-page.js — renders /pros from public/js/pros.js and public/js/trips.js (Phase 2 plan 4.2).
//
// The page is committed with the full markup for every profile so it reads with no JS. This module
// is the single renderer for that markup: the browser re-renders #prosRoot from the data on load
// (progressive enhancement; the data file is the source of truth), and Node checks that the
// committed markup is exactly what the renderer produces, so the two cannot drift:
//
//   node public/js/pros-page.js --check   # non-zero exit if pros.html drifts from the data (or IMAGES from the manifest)
//   node public/js/pros-page.js --write   # regenerate the region between <!-- pros:start --> and <!-- pros:end -->
//
// No DOM libraries, no dependencies beyond node:fs in the check. Markup conventions follow
// public/index.html: alphabetical attributes, one element per line inside <picture>, literal UTF-8.

import { PROS } from './pros.js';
import { tripsFor } from './trips.js';

// The responsive variants per image key, copied from public/assets/derived/manifest.json so the
// browser needs no fetch. `--check` verifies this table against the manifest; files are
// /assets/derived/<key>-<w>.<webp|ext>. The <img> carries the largest variant's size.
export const IMAGES = Object.freeze({
  'play-katie-eva-clay': { ext: 'jpg', variants: [{ w: 480, h: 1021 }, { w: 960, h: 2042 }] },
  'life-eva-paella': { ext: 'jpg', variants: [{ w: 480, h: 640 }, { w: 768, h: 1024 }] },
  'katie-eva-coast': { ext: 'jpg', variants: [{ w: 480, h: 640 }, { w: 768, h: 1024 }] },
  'life-friends-court': { ext: 'jpg', variants: [{ w: 480, h: 360 }, { w: 960, h: 720 }, { w: 1024, h: 768 }] },
  'life-friends-family': { ext: 'jpg', variants: [{ w: 480, h: 300 }, { w: 960, h: 600 }, { w: 1120, h: 700 }] },
});

// How wide each image is drawn, for `sizes` (see the layout rules at the end of marketing.css).
const PORTRAIT_SIZES = '(min-width:1050px) 32vw, (min-width:700px) 480px, 100vw';
const PORTRAIT_SIZES_CROP = '(min-width:1050px) 64vw, (min-width:700px) 960px, 200vw'; // .crop-right draws the image at 200%
const TRIP_SIZES = '(min-width:1050px) 30vw, (min-width:700px) 45vw, 100vw';

const STATUS_TAG = Object.freeze({ invitation: 'Invitation only', waitlist: 'Waitlist', announced: 'Announced' });
const STATUS_LINK = Object.freeze({ invitation: 'Enter with your invitation', announced: 'See the trip' });
const WAITLIST_NOTE = 'Waitlist opens soon. Invitations go out first; check back or ask Katie.';

export const escapeHtml = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const capitalize = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

const file = (key, w, ext) => `/assets/derived/${key}-${w}.${ext}`;

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
    return [
      `<div aria-hidden="true" class="media-card pro-portrait monogram"><span>${escapeHtml(pro.monogram)}</span></div>`,
      '<p class="placeholder">Photo to come.</p>',
    ].join('\n');
  }
  const crop = pro.portrait.crop === 'right';
  return [
    `<div class="media-card pro-portrait${crop ? ' crop-right' : ''}">`,
    renderPicture({ ...pro.portrait, sizes: crop ? PORTRAIT_SIZES_CROP : PORTRAIT_SIZES, eager }),
    '</div>',
  ].join('\n');
}

function renderFacts(pro) {
  const facts = pro.facts
    .map(({ label, value, placeholder }) =>
      `<div class="quickfact"><strong${placeholder ? ' class="placeholder"' : ''}>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`)
    .join('\n');
  return `<section aria-label="${escapeHtml(pro.name)} at a glance" class="quickfacts trust profile-facts">\n${facts}\n</section>`;
}

function renderBase(pro) {
  const value = pro.base ? escapeHtml(pro.base) : '<span class="placeholder">Details to come</span>';
  return `<p class="profile-base"><span class="profile-base-label">Home base</span>${pro.base ? `<span>${value}</span>` : value}</p>`;
}

function renderLinks(links) {
  const entries = Object.entries(links || {}).filter(([, href]) => href);
  if (!entries.length) return '';
  const items = entries
    .map(([key, href]) => `<a href="${escapeHtml(href)}" rel="noreferrer">${escapeHtml(capitalize(key))} ↗</a>`)
    .join('');
  return `\n<p class="profile-links">${items}</p>`;
}

export function renderTrip(trip, pro) {
  const tag = STATUS_TAG[trip.status] || capitalize(trip.status);
  const art = trip.photo
    ? [
        '<div class="trip-art has-photo">',
        renderPicture({ ...trip.photo, sizes: TRIP_SIZES }),
        `<span aria-hidden="true">${escapeHtml(trip.place)}</span>`,
        '</div>',
      ].join('\n')
    : `<div aria-hidden="true" class="trip-art"><span>${escapeHtml(trip.place)}</span></div>`;
  const body = [
    `<div class="caps trip-tag">${escapeHtml(tag)}</div>`,
    `<h3>${escapeHtml(trip.name)}</h3>`,
    `<p class="trip-meta">${escapeHtml(trip.place)} · ${escapeHtml(trip.timing)}</p>`,
    trip.blurb ? `<p>${escapeHtml(capitalize(trip.blurb))}</p>` : '',
    trip.price ? `<p class="trip-meta">${escapeHtml(trip.price)}</p>` : '',
  ];
  if (trip.status === 'waitlist') {
    body.push(`<details class="waitlist"><summary class="secondary">Join the waitlist</summary><p class="waitlist-note">${WAITLIST_NOTE}</p></details>`);
  } else if (trip.link) {
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

function renderTrips(pro) {
  const trips = tripsFor(pro.id);
  const inner = trips.length
    ? `<div class="trip-grid">\n${trips.map((trip) => renderTrip(trip, pro)).join('\n')}\n</div>`
    : '<p class="placeholder">Trips to be announced.</p>';
  return `<div class="profile-trips">\n<h3 class="profile-label">Trips</h3>\n${inner}\n</div>`;
}

// One profile section. `eager` loads the portrait first (the first profile on the page);
// `band` is 'paper' for the alternate background.
export function renderPro(pro, { eager = false, band = 'cream' } = {}) {
  const onCourt = pro.onCourt
    .map(({ text, placeholder }) => `<li${placeholder ? ' class="placeholder"' : ''}>${escapeHtml(text)}</li>`)
    .join('');
  const bio = `<p${pro.bio.placeholder ? ' class="placeholder"' : ''}>${escapeHtml(pro.bio.text)}</p>`;
  return [
    `<section aria-labelledby="${escapeHtml(pro.id)}Name" class="section${band === 'paper' ? ' band-paper' : ''} profile-section" id="${escapeHtml(pro.id)}">`,
    '<div class="section-inner profile">',
    '<div class="profile-media">',
    renderPortrait(pro, eager),
    '</div>',
    '<div class="profile-body">',
    `<div class="eyebrow">${escapeHtml(pro.role)}</div>`,
    `<h2 id="${escapeHtml(pro.id)}Name">${escapeHtml(pro.name)}</h2>`,
    renderBase(pro) + renderLinks(pro.links),
    renderFacts(pro),
    '<div class="profile-panels">',
    `<div class="panel"><h3 class="profile-label">About</h3>${bio}</div>`,
    `<div class="panel"><h3 class="profile-label">On court</h3><ul class="on-court">${onCourt}</ul></div>`,
    '</div>',
    renderTrips(pro),
    '<div class="section-cta"><a class="primary" href="/invite">Have an invitation?</a></div>',
    '</div>',
    '</div>',
    '</section>',
  ].join('\n');
}

// The jump row under the intro: one link per pro, in page order.
export function renderJump() {
  const links = PROS.map((pro) => `<a class="secondary" href="#${escapeHtml(pro.id)}">${escapeHtml(pro.name)}</a>`).join('');
  return `<nav aria-label="Pros on this page" class="pros-jump"><div class="section-inner">${links}</div></nav>`;
}

// Everything inside #prosRoot: the jump row, then one section per pro, backgrounds alternating
// cream / paper, the first portrait eager.
export function renderAll() {
  return [renderJump(), ...PROS.map((pro, i) => renderPro(pro, { eager: i === 0, band: i % 2 ? 'paper' : 'cream' }))].join('\n');
}

export const START = '<!-- pros:start -->';
export const END = '<!-- pros:end -->';

// Browser: re-render from the data so pros.js is what the reader sees even if pros.html lags.
// The rendered markup is parsed into a template and compared with the live DOM through the same
// serializer, so when the committed page already matches (the normal case) nothing is touched: no
// image re-requests, and a fresh load of /pros#eva keeps the element the browser scrolled to. When
// the page is stale the root is swapped and the hash target is scrolled to again.
if (typeof document !== 'undefined') {
  const root = document.getElementById('prosRoot');
  if (root) {
    const next = document.createElement('template');
    next.innerHTML = `${START}\n${renderAll()}\n${END}`;
    // Compare with whitespace collapsed: the committed region is pretty-printed, the rendered one is
    // not, and that difference alone must not force a DOM swap (QA finding, Phase 2).
    const norm = (html) => html.replace(/\s+/g, ' ').trim();
    if (norm(next.innerHTML) !== norm(root.innerHTML)) root.replaceChildren(next.content);
    // Land on the fragment again once layout is final. The browser's own jump happens before the eager
    // portrait and the fonts settle, which can leave the target well below the header on a phone.
    const landOnHash = () => {
      const target = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (target) target.scrollIntoView({ behavior: 'instant', block: 'start' });
    };
    if (location.hash) {
      landOnHash();
      addEventListener('load', landOnHash, { once: true });
    }
  }
}

// Node: `--check` compares the committed region with the renderer, `--write` regenerates it.
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
    // Data sanity: unique ids, portraits with variants, four facts, a monogram for anyone without a photo.
    const ids = new Set();
    for (const pro of PROS) {
      if (ids.has(pro.id)) problems.push(`duplicate pro id "${pro.id}"`);
      ids.add(pro.id);
      if (!/^[a-z][a-z0-9-]*$/.test(pro.id)) problems.push(`pro id "${pro.id}" must be lowercase letters, digits and hyphens`);
      if (pro.portrait && !IMAGES[pro.portrait.key]) problems.push(`${pro.id}: portrait key "${pro.portrait.key}" has no IMAGES entry`);
      if (!pro.portrait && !pro.monogram) problems.push(`${pro.id}: no portrait and no monogram`);
      if (!Array.isArray(pro.facts) || pro.facts.length !== 4) problems.push(`${pro.id}: the facts row takes exactly four facts`);
      if (!pro.name || !pro.role) problems.push(`${pro.id}: name and role are required`);
    }

    const rendered = `${START}\n${renderAll()}\n${END}`;
    const html = fs.readFileSync(htmlPath, 'utf8');
    const start = html.indexOf(START);
    const end = html.indexOf(END);
    if (start < 0 || end < 0 || end < start) problems.push(`pros.html has no ${START} … ${END} region`);

    if (mode === 'write' && !problems.length) {
      const next = html.slice(0, start) + rendered + html.slice(end + END.length);
      if (next !== html) fs.writeFileSync(htmlPath, next);
      console.log(`pros-page: ${next === html ? 'pros.html already matches pros.js' : 'wrote the pros region of pros.html from pros.js'}`);
    } else if (!problems.length) {
      const committed = html.slice(start, end + END.length);
      if (committed !== rendered) {
        const a = committed.split('\n');
        const b = rendered.split('\n');
        const line = a.findIndex((text, i) => text !== b[i]);
        problems.push(`pros.html drifts from pros.js at region line ${line + 1}:\n  committed: ${JSON.stringify(a[line] ?? '<end>')}\n  rendered:  ${JSON.stringify(b[line] ?? '<end>')}\n  run: node public/js/pros-page.js --write`);
      }
    }

    if (problems.length) {
      console.error(`pros-page --${mode}: ${problems.length} problem${problems.length === 1 ? '' : 's'}`);
      for (const problem of problems) console.error(`- ${problem}`);
      process.exit(1);
    }
    if (mode === 'check') console.log(`pros-page --check: pros.html matches pros.js (${PROS.length} pros) and IMAGES matches manifest.json`);
  }
}
