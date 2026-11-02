#!/usr/bin/env node
// Web sizes for the 2027 season cards on the homepage (redesign v2, s05).
//   node scripts/make-season-images.js
// Reads the Unsplash originals in public/images/s05/<name>.jpg (credits in CREDITS.md there), cuts each to
// the aspect its card shows (centre crop, the same window object-fit: cover picks in the mockup) and writes
// <name>-<width>.webp and .jpg at 720, 1200 and 1400 wide, metadata stripped (sharp drops EXIF/XMP by default).
// 720 serves 1x desktops, 1200 serves 2x and 3x phones (a 390px phone at 3x needs 1170px), 1400 serves 2x
// desktops. Never wider than 1600px. Originals are left alone. Safe to run again.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import sharp from 'sharp';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'images', 's05');
const WIDTHS = [720, 1200, 1400];
// aspect: [w, h] of the card's photo box (s05-cards mockup: feature and 7-col cards 16/10, 5-col cards 4/3).
const CARDS = [
  { name: 'spain', aspect: [16, 10] },
  { name: 'charleston', aspect: [16, 10] },
  { name: 'geneva', aspect: [4, 3] },
  { name: 'mallorca', aspect: [4, 3] },
  { name: 'newyork', aspect: [16, 10] },
  { name: 'la', aspect: [16, 10] },
  { name: 'clay', aspect: [4, 3] },
];

const manifest = {};
for (const { name, aspect: [aw, ah] } of CARDS) {
  const src = join(DIR, `${name}.jpg`);
  const meta = await sharp(src).metadata();
  manifest[name] = { original: { width: meta.width, height: meta.height }, variants: [] };
  for (const width of WIDTHS) {
    if (width > meta.width) continue;
    const height = Math.round((width * ah) / aw);
    const base = sharp(src).resize({ width, height, fit: 'cover', position: 'centre' });
    for (const [ext, make] of [['webp', (s) => s.webp({ quality: 78 })], ['jpg', (s) => s.jpeg({ quality: 80, mozjpeg: true })]]) {
      const file = join(DIR, `${name}-${width}.${ext}`);
      const info = await make(base.clone()).toFile(file);
      manifest[name].variants.push({ file: `/images/s05/${name}-${width}.${ext}`, width: info.width, height: info.height, bytes: info.size });
      console.log(`${name}-${width}.${ext}  ${info.width}×${info.height}  ${(info.size / 1024).toFixed(0)} KB`);
    }
  }
}
writeFileSync(join(DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
