#!/usr/bin/env node
// Composes the share images and the touch icon for the public pages (polish brief, section B "Head").
//   node scripts/make-og.js
// Writes public/assets/og/{home,pros,invite}.jpg (1200×630: the lockup on a cream panel beside the
// clay-court crop) and public/assets/icons/apple-touch-icon.png (180×180, rendered from
// public/favicon.svg). Only the brand tokens from public/style.css plus --gold-ink, the existing
// lockup and the existing photo crop (scripts/make-images.js must have run first). Safe to re-run.
import { mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const DERIVED = join(PUBLIC, 'assets', 'derived');
const OG = join(PUBLIC, 'assets', 'og');
const ICONS = join(PUBLIC, 'assets', 'icons');

const CREAM = '#f4efe5';
const GOLD_INK = '#8a6d3c';
const LINE = 'rgba(57,38,29,0.18)';
const W = 1200;
const H = 630;
const PANEL = 600; // cream panel width; the photo takes the rest

// One caps line per page, in the voice of the eyebrows.
const PAGES = [
  { file: 'home', line: 'Tennis travel hosted by a pro' },
  { file: 'pros', line: 'Meet the pros' },
  { file: 'invite', line: 'Enter your invitation' },
];

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

// The caps line and the hairline above it, as an SVG layer the size of the panel.
const captionSvg = (text) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${PANEL}" height="${H}">
  <rect x="80" y="372" width="440" height="1" fill="${LINE}"/>
  <text x="80" y="412" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="19" font-weight="700" letter-spacing="3.4" fill="${GOLD_INK}">${escape(text.toUpperCase())}</text>
</svg>`);

mkdirSync(OG, { recursive: true });
mkdirSync(ICONS, { recursive: true });

// The photo column: the 3:2 hero crop scaled to the full height, then the window around the two
// players (their centre sits at about 61% of the crop width).
const photoSrc = sharp(join(DERIVED, 'hero-clay-32-960.jpg')).resize({ height: H });
const { width: scaledW } = await photoSrc.clone().toBuffer({ resolveWithObject: true }).then((r) => r.info);
const photoW = W - PANEL;
const left = Math.max(0, Math.min(scaledW - photoW, Math.round(0.61 * scaledW - photoW / 2)));
const photo = await photoSrc.extract({ left, top: 0, width: photoW, height: H }).toBuffer();

const lockup = await sharp(join(DERIVED, 'courtside-lockup-880.png')).resize({ width: 440 }).toBuffer({ resolveWithObject: true });
const lockupTop = Math.round(340 - lockup.info.height) - 24;

for (const page of PAGES) {
  const out = join(OG, `${page.file}.jpg`);
  await sharp({ create: { width: W, height: H, channels: 3, background: CREAM } })
    .composite([
      { input: photo, left: PANEL, top: 0 },
      { input: lockup.data, left: 80, top: lockupTop },
      { input: captionSvg(page.line), left: 0, top: 0 },
    ])
    .jpeg({ quality: 84, mozjpeg: true })
    .toFile(out);
  console.log(`wrote ${out.replace(ROOT, '')}`);
}

// Touch icon from the favicon, on the espresso square the SVG already draws.
const favicon = readFileSync(join(PUBLIC, 'favicon.svg'));
await sharp(favicon, { density: 384 }).resize(180, 180).png({ compressionLevel: 9 }).toFile(join(ICONS, 'apple-touch-icon.png'));
console.log('wrote /public/assets/icons/apple-touch-icon.png');
