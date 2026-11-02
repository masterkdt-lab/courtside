#!/usr/bin/env node
// Redesign v2 review: screenshots of each homepage section at 1440×900 and 390×844 into review/, plus the checks
// from the build prompt's acceptance list that a browser can answer (overflow at 390/768/1024/1440, orphans on
// headings, eyebrows per section, image attributes, reduced motion, computed contrast of the named pairs).
//   node scripts/review-screenshots.js [http://localhost:3000]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:3000';
const OUT = 'review';
mkdirSync(OUT, { recursive: true });

// s01 is header + hero together; the rest are the sections in page order.
const SECTIONS = [
  ['s01', 'header.site-header, section.home-hero'],
  ['s02', '#about'], ['s03', 'section.qf'], ['s04', '#trips'], ['s05', '#season'],
  ['s06', '#how'], ['s07', '#pros'], ['s08', '#waitlist'], ['s09', 'footer.footer'],
];
const VIEWPORTS = [[1440, 900], [390, 844]];

const browser = await chromium.launch();
const report = { overflow: {}, orphans: {}, eyebrows: null, images: null, motion: null, contrast: null };

for (const [width, height] of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.evaluate(async () => { await document.fonts.ready; await new Promise((r) => setTimeout(r, 1400)); });
  // Lazy images: scroll through once so every photo is loaded before the section shots.
  // Lazy images only start loading once the browser has had a frame near them: scroll in viewport steps with a paint between each.
  for (let y = 0; ; y += height - 100) {
    const done = await page.evaluate((top) => { scrollTo(0, top); return top >= document.body.scrollHeight - innerHeight; }, y);
    await page.waitForTimeout(250);
    if (done) break;
  }
  await page.waitForFunction(() => [...document.images].every((img) => img.complete && img.naturalWidth > 0), null, { timeout: 15000 });
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(300);
  // The header is sticky; a clipped full-page shot would paint it wherever the viewport was. Static for the shots only (same layout).
  await page.addStyleTag({ content: '.site-header{position:static!important}' });
  for (const [name, selector] of SECTIONS) {
    const parts = selector.split(',').map((s) => s.trim());
    const box = await page.evaluate((sels) => {
      const rects = sels.map((s) => document.querySelector(s).getBoundingClientRect());
      const top = Math.min(...rects.map((r) => r.top)) + scrollY;
      const bottom = Math.max(...rects.map((r) => r.bottom)) + scrollY;
      return { top, height: bottom - top };
    }, parts);
    await page.screenshot({ path: `${OUT}/${name}-${width}.png`, fullPage: true, clip: { x: 0, y: box.top, width, height: Math.ceil(box.height) } });
  }
  report.orphans[width] = await page.evaluate(() => {
    // A heading or short paragraph whose last line is a single word.
    const out = [];
    const lastLineWords = (el) => {
      const range = document.createRange();
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const words = [];
      let node;
      while ((node = walker.nextNode())) {
        const text = node.textContent;
        const re = /\S+/g;
        let m;
        while ((m = re.exec(text))) {
          range.setStart(node, m.index); range.setEnd(node, m.index + m[0].length);
          const r = range.getBoundingClientRect();
          words.push({ word: m[0], top: Math.round(r.top) });
        }
      }
      if (words.length < 2) return null;
      const lastTop = words[words.length - 1].top;
      const lines = new Set(words.map((w) => w.top)).size;
      const lastLine = words.filter((w) => w.top === lastTop);
      return { lines, lastLine: lastLine.map((w) => w.word).join(' ') };
    };
    for (const el of document.querySelectorAll('h1, h2, h3, .hero-copy p, .lead, .facts span, .section-head p, .how-head p, .how-steps p, .tc p, .season-ask p, .qf span')) {
      const info = lastLineWords(el);
      if (info && info.lines > 1 && !info.lastLine.includes(' ')) out.push({ sel: el.tagName + (el.className ? '.' + el.className.split(' ')[0] : ''), text: el.textContent.trim().slice(0, 50), last: info.lastLine });
    }
    return out;
  });
  await page.close();
}

for (const width of [390, 768, 1024, 1440]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  report.overflow[width] = await page.evaluate(() => {
    const wide = [...document.querySelectorAll('body *')].filter((el) => { const r = el.getBoundingClientRect(); return r.right > innerWidth + 1 || r.left < -1; }).slice(0, 5).map((el) => el.tagName + '.' + el.className);
    return { scrollWidth: document.documentElement.scrollWidth, innerWidth, ok: document.documentElement.scrollWidth === innerWidth, wide };
  });
  if (width === 1440) {
    report.eyebrows = await page.evaluate(() => [...document.querySelectorAll('main section, header, footer')].map((s) => ({ id: s.id || s.className.split(' ').slice(0, 2).join('.'), caps: [...s.querySelectorAll('*')].filter((el) => { const cs = getComputedStyle(el); return cs.textTransform === 'uppercase' && el.children.length === 0 && el.textContent.trim(); }).map((el) => el.textContent.trim()) })));
    report.images = await page.evaluate(() => [...document.images].map((img) => ({ src: img.currentSrc.split('/').pop(), alt: img.alt, w: img.getAttribute('width'), h: img.getAttribute('height'), loading: img.getAttribute('loading') || 'auto', ok: !!(img.alt !== null && img.getAttribute('width') && img.getAttribute('height')) })));
    report.contrast = await page.evaluate(() => {
      const lum = (r, g, b) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const parse = (s) => s.match(/[\d.]+/g).map(Number);
      const blend = (fg, bg) => { const a = fg[3] ?? 1; return [0, 1, 2].map((i) => Math.round(fg[i] * a + bg[i] * (1 - a))); };
      const ratio = (a, b) => { const [l1, l2] = [lum(...a), lum(...b)].sort((x, y) => y - x); return ((l1 + 0.05) / (l2 + 0.05)).toFixed(2); };
      const bgOf = (el) => { let e = el; while (e) { const c = parse(getComputedStyle(e).backgroundColor); if (c.length === 3 || c[3] > 0) return c.slice(0, 3); e = e.parentElement; } return [244, 239, 229]; };
      const pairs = [['#about .eyebrow', 'eyebrow gold-ink on cream'], ['#season .eyebrow', 'eyebrow gold-ink on paper'], ['#how .eyebrow', 'eyebrow gold-bright on espresso'], ['#how .how-head p', '78% cream on espresso'], ['#how .how-steps a', 'gold-bright link on espresso'], ['.when', 'italic gold-ink on paper'], ['.tc .st', 'muted on paper'], ['.hero-copy .who', 'muted on cream'], ['.about-photo figcaption', 'muted caption on cream'], ['.quiet', 'quiet link brown on cream'], ['.btn', 'cream on espresso button'], ['.tag', 'white on sage tag'], ['.feat .tag', 'white on clay tag'], ['.cr', 'credit white on scrim (over a photo)'], ['.lbl', 'label brown on paper chip'], ['.footer-links a', 'footer link'], ['.site-nav a', 'nav link']];
      return pairs.map(([sel, label]) => { const el = document.querySelector(sel); if (!el) return { label, missing: sel }; const fg = parse(getComputedStyle(el).color); const bg = bgOf(el); return { label, fg: getComputedStyle(el).color, bg: `rgb(${bg.join(',')})`, size: getComputedStyle(el).fontSize, ratio: ratio(blend(fg, bg), bg) }; });
    });
  }
  await page.close();
}

const reduced = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
await reduced.goto(`${BASE}/`, { waitUntil: 'networkidle' });
report.motion = await reduced.evaluate(() => {
  const els = [...document.querySelectorAll('body *')];
  const moving = els.filter((el) => { const cs = getComputedStyle(el); return (cs.transitionDuration.split(',').some((d) => parseFloat(d) > 0)) || cs.animationName !== 'none'; }).map((el) => el.tagName + '.' + el.className).slice(0, 10);
  return { animations: document.getAnimations().length, elementsWithMotion: moving.length, sample: moving, scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior };
});
await reduced.close();
await browser.close();
console.log(JSON.stringify(report, null, 2));
