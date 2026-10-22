#!/usr/bin/env node
// Generates responsive image variants for the public pages (plan v2, decision 5).
//   npm run images
// Reads the originals in public/assets/, writes resized WebP + JPEG (or PNG for logos) into
// public/assets/derived/<name>-<width>.<ext>, never wider than the original, metadata stripped
// (sharp drops EXIF/XMP unless withMetadata() is called). Also writes derived/manifest.json with
// every variant's width and height so pages can set width/height attributes and srcset.
// Originals are never modified. Safe to run again; existing files are overwritten.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'public', 'assets');
const OUT = join(SRC, 'derived');

// name: file in public/assets. widths: candidates; any wider than the original is skipped and the
// original width is added instead. kind: 'photo' → webp + jpeg; 'logo' → webp + png (alpha kept).
const SOURCES = [
  { name: 'katie-eva-coast', ext: 'jpg', kind: 'photo', widths: [480, 960, 1600] },
  { name: 'play-katie-eva-clay', ext: 'jpg', kind: 'photo', widths: [480, 960, 1600] },
  { name: 'life-eva-paella', ext: 'jpg', kind: 'photo', widths: [480, 960, 1600] },
  { name: 'life-friends-court', ext: 'jpg', kind: 'photo', widths: [480, 960, 1600] },
  { name: 'life-friends-family', ext: 'jpg', kind: 'photo', widths: [480, 960, 1600] },
  { name: 'courtside-lockup', ext: 'png', kind: 'logo', widths: [320, 640] },
  { name: 'courtside-lockup-footer', ext: 'png', kind: 'logo', widths: [320, 640] },
];

mkdirSync(OUT, { recursive: true });
const manifest = {};

for (const src of SOURCES) {
  const input = readFileSync(join(SRC, `${src.name}.${src.ext}`));
  const meta = await sharp(input).metadata();
  const widths = [...new Set([...src.widths.filter((w) => w < meta.width), meta.width])].sort((a, b) => a - b);
  manifest[src.name] = { original: { width: meta.width, height: meta.height, file: `/assets/${src.name}.${src.ext}` }, variants: [] };

  for (const width of widths) {
    const base = sharp(input).resize({ width, withoutEnlargement: true });
    const outputs = src.kind === 'photo'
      ? [['webp', base.clone().webp({ quality: 78 })], ['jpg', base.clone().jpeg({ quality: 80, mozjpeg: true })]]
      : [['webp', base.clone().webp({ quality: 85, alphaQuality: 90 })], ['png', base.clone().png({ compressionLevel: 9 })]];
    for (const [ext, pipeline] of outputs) {
      const file = `${src.name}-${width}.${ext}`;
      const info = await pipeline.toFile(join(OUT, file));
      manifest[src.name].variants.push({ file: `/assets/derived/${file}`, format: ext, width: info.width, height: info.height, bytes: info.size });
    }
  }
  const sizes = manifest[src.name].variants.map((v) => `${v.width}${v.format === 'webp' ? 'w' : v.format}=${Math.round(v.bytes / 1024)}KB`).join(' ');
  console.log(`${src.name}: ${meta.width}×${meta.height} → ${sizes}`);
}

writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${Object.keys(manifest).length} sources to public/assets/derived/ (+ manifest.json)`);
