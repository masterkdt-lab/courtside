#!/usr/bin/env node
// Removes metadata from JPEG files in place, losslessly. Usage:
//   node scripts/strip-exif.js public/assets/photo.jpg [more.jpg ...]
// A JPEG is a sequence of segments. Camera metadata (EXIF, with GPS and dates), XMP and
// Photoshop/IPTC blocks each live in their own APP1 / APP13 segment ahead of the image data.
// This drops those segments and copies every other byte unchanged, so the pixels are identical.
// Check the Orientation tag first: a photo that relies on EXIF rotation (orientation != 1) would
// display rotated after stripping. All three Courtside photos are orientation 1.
import { readFileSync, writeFileSync } from 'node:fs';

const EXIF = Buffer.from('Exif\0\0', 'latin1');
const XMP = Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1');
const PHOTOSHOP = Buffer.from('Photoshop 3.0\0', 'latin1');

function strip(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('not a JPEG (no SOI marker)');
  const out = [buf.subarray(0, 2)];
  let i = 2;
  const removed = [];
  while (i < buf.length) {
    if (buf[i] !== 0xff) throw new Error(`bad marker at byte ${i}`);
    const marker = buf[i + 1];
    if (marker === 0xda) { // SOS: image data follows until EOI; copy the rest verbatim
      out.push(buf.subarray(i));
      break;
    }
    const len = buf.readUInt16BE(i + 2);
    const seg = buf.subarray(i, i + 2 + len);
    const payload = seg.subarray(4);
    const isExif = marker === 0xe1 && payload.subarray(0, EXIF.length).equals(EXIF);
    const isXmp = marker === 0xe1 && payload.subarray(0, XMP.length).equals(XMP);
    const isPhotoshop = marker === 0xed && payload.subarray(0, PHOTOSHOP.length).equals(PHOTOSHOP);
    if (isExif || isXmp || isPhotoshop) removed.push(`${isExif ? 'EXIF' : isXmp ? 'XMP' : 'Photoshop/IPTC'} (${seg.length} bytes)`);
    else out.push(seg);
    i += 2 + len;
  }
  return { data: Buffer.concat(out), removed };
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node scripts/strip-exif.js <file.jpg> [more.jpg ...]');
  process.exit(1);
}
for (const file of files) {
  const before = readFileSync(file);
  const { data, removed } = strip(before);
  if (!removed.length) { console.log(`${file}: nothing to remove`); continue; }
  writeFileSync(file, data);
  console.log(`${file}: removed ${removed.join(', ')}; ${before.length} → ${data.length} bytes`);
}
