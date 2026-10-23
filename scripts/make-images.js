#!/usr/bin/env node
// Generates responsive image variants for the public pages (plan v2, decision 5; polish: named crops).
//   npm run images
// Reads the originals in public/assets/, writes resized WebP + JPEG (or PNG for logos) into
// public/assets/derived/<name>-<width>.<ext>, never wider than the original, metadata stripped
// (sharp drops EXIF/XMP unless withMetadata() is called). Also writes derived/manifest.json with
// every variant's width and height so pages can set width/height attributes and srcset.
// Originals are never modified. Safe to run again; existing files are overwritten.
//
// Two kinds of entry:
//   SOURCES  whole images, resized only.
//   CROPS    a named window cut from a source with a fixed aspect and a focal point, then resized.
//            Who is where in each photo is recorded in public/assets/PHOTOS.md; read it before
//            moving a focal point. The crop window is written to the manifest as `original.crop`.
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

// name: the derived key. source: a SOURCES photo. aspect: [w, h] of the window. focus: the point
// (fractions of the source) the window is centred on, clamped to the frame. span: optional
// fraction of the source width the window covers (default: as wide as the aspect allows), used
// to cut one person out of a two-person photo. widths: as above, capped at the window width.
// quality: optional WebP/JPEG quality for a crop that is a page's LCP image (default 78/80).
//
// play-katie-eva-clay (960×2042): Katie is the LEFT player (navy jacket), Eva the RIGHT (white
// visor). Faces sit at about 33–41% of the height, the net at about 47–52%.
export const CROPS = [
  { name: 'hero-clay-32', source: 'play-katie-eva-clay', ext: 'jpg', aspect: [3, 2], focus: { x: 0.61, y: 0.36 }, widths: [480, 960, 1440] },
  { name: 'hero-clay-45', source: 'play-katie-eva-clay', ext: 'jpg', aspect: [4, 5], focus: { x: 0.58, y: 0.52 }, widths: [480, 960, 1440], quality: 70 },
  { name: 'katie-portrait-34', source: 'play-katie-eva-clay', ext: 'jpg', aspect: [3, 4], focus: { x: 0.40, y: 0.41 }, span: 0.52, widths: [480, 960] },
  { name: 'eva-portrait-34', source: 'play-katie-eva-clay', ext: 'jpg', aspect: [3, 4], focus: { x: 0.80, y: 0.40 }, span: 0.42, widths: [480, 960] },
  { name: 'spain-card-43', source: 'play-katie-eva-clay', ext: 'jpg', aspect: [4, 3], focus: { x: 0.61, y: 0.37 }, widths: [480, 960, 1440] },
  { name: 'coast-small-11', source: 'katie-eva-coast', ext: 'jpg', aspect: [1, 1], focus: { x: 0.5, y: 0.5 }, widths: [240, 480] },
];

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// The crop window for a source of W×H: the widest window of the aspect that fits (or `span` of the
// width), centred on the focal point and pushed back inside the frame.
export function cropWindow({ aspect: [aw, ah], focus, span }, W, H) {
  const a = aw / ah;
  let width = span ? Math.round(W * span) : Math.min(W, Math.round(H * a));
  let height = Math.round(width / a);
  if (height > H) { height = H; width = Math.round(H * a); }
  const left = clamp(Math.round(focus.x * W - width / 2), 0, W - width);
  const top = clamp(Math.round(focus.y * H - height / 2), 0, H - height);
  return { left, top, width, height };
}

mkdirSync(OUT, { recursive: true });
const manifest = {};

async function emit(name, kind, pipelineFor, widths, original, quality = null) {
  manifest[name] = { original, variants: [] };
  for (const width of widths) {
    const base = pipelineFor().resize({ width, withoutEnlargement: true });
    const outputs = kind === 'photo'
      ? [['webp', base.clone().webp({ quality: quality || 78 })], ['jpg', base.clone().jpeg({ quality: quality ? quality + 2 : 80, mozjpeg: true })]]
      : [['webp', base.clone().webp({ quality: 85, alphaQuality: 90 })], ['png', base.clone().png({ compressionLevel: 9 })]];
    for (const [ext, pipeline] of outputs) {
      const file = `${name}-${width}.${ext}`;
      const info = await pipeline.toFile(join(OUT, file));
      manifest[name].variants.push({ file: `/assets/derived/${file}`, format: ext, width: info.width, height: info.height, bytes: info.size });
    }
  }
  const sizes = manifest[name].variants.map((v) => `${v.width}${v.format === 'webp' ? 'w' : v.format}=${Math.round(v.bytes / 1024)}KB`).join(' ');
  console.log(`${name}: ${original.width}×${original.height} → ${sizes}`);
}

const widthsFor = (candidates, max) => [...new Set([...candidates.filter((w) => w < max), max])].sort((a, b) => a - b);

const inputs = new Map();
const inputFor = (name, ext) => {
  const key = `${name}.${ext}`;
  if (!inputs.has(key)) inputs.set(key, readFileSync(join(SRC, key)));
  return inputs.get(key);
};

for (const src of SOURCES) {
  const input = inputFor(src.name, src.ext);
  const meta = await sharp(input).metadata();
  await emit(src.name, src.kind, () => sharp(input), widthsFor(src.widths, meta.width),
    { width: meta.width, height: meta.height, file: `/assets/${src.name}.${src.ext}` });
}

for (const crop of CROPS) {
  const input = inputFor(crop.source, crop.ext);
  const meta = await sharp(input).metadata();
  const win = cropWindow(crop, meta.width, meta.height);
  await emit(crop.name, 'photo', () => sharp(input).extract(win), widthsFor(crop.widths, win.width),
    { width: win.width, height: win.height, file: `/assets/${crop.source}.${crop.ext}`, crop: win }, crop.quality || null);
}

writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${Object.keys(manifest).length} entries to public/assets/derived/ (+ manifest.json)`);
