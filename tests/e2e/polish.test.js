// tests/e2e/polish.test.js
// The polish checklist (QA_REPORT_POLISH.md, items 2–14 and 17) against COURTSIDE_POLISH_BRIEF.md section 1,
// POLISH_PLAN.md (sections 1–8, the approved decisions) and DESIGN.md, with the expectations the redesign v2
// (branch redesign-v2; courtside-handoff/CLAUDE_BUILD_PROMPT.md steps 1–4, DESIGN_v2.md, mockups/html) changed
// rewritten: Canela + GT America trial fonts in style.css, the v2 tokens, radii 26 / 18 / 999, no glass, one caps
// eyebrow per section, the hero and the header pill as the only invite asks, one waitlist capture at the close.
// Playwright (library) drives headless Chromium against a dev server started in this process on a free port with
// a temp mock file, as the other e2e suites do; every request that would leave 127.0.0.1 is aborted and recorded.
// Items 1, 15 and 16 (the suite counts, Lighthouse and the screenshots) are run by hand and recorded in the report.
//
// A failing test documents a defect against the brief; nothing here fixes anything. Each test says which
// checklist item it covers in its name.
//
// Run: node --test tests/e2e/polish.test.js   (part of npm run test:e2e; needs `npx playwright install chromium`)

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { NOINDEX, ROOT, freshIp, http, resetMock, startServer, useTempMock } from './helpers.js';

let playwright = null;
try {
  playwright = await import('playwright');
} catch {
  playwright = null;
}
let sharp = null;
try {
  sharp = (await import('sharp')).default;
} catch {
  sharp = null;
}

const require = createRequire(import.meta.url);
let axePath = null;
try {
  axePath = path.join(path.dirname(require.resolve('axe-core/package.json')), 'axe.min.js');
} catch {
  axePath = null;
}

const MOBILE = { width: 390, height: 844 };
const TABLET = { width: 700, height: 900 };
const DESKTOP = { width: 1440, height: 900 };
const PUBLIC_PAGES = ['/', '/pros', '/invite', '/privacy', '/nope'];      // /nope: any unknown path serves public/404.html with 404
const SHELL_PAGES = ['/', '/pros', '/privacy', '/nope'];                 // the pages with the public header, main and footer
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const plain = (s) => s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const HERO_SENTENCES = ['Small tennis trips hosted by pros: great clubs, beautiful places, and the long lunch after.', 'For the players they coach and the friends they bring.'];
const TAGLINE = 'good places. better people.'; // the brand line: on the gate (/invite), not in the hero (CLAUDE_BUILD_PROMPT.md s01)
// DESIGN_v2 colours as Chromium reports them.
const ESPRESSO = 'rgb(57, 38, 29)';
const BROWN = 'rgb(93, 64, 49)';
const CREAM = 'rgb(244, 239, 229)';
const PAPER = 'rgb(251, 248, 242)';
const GOLD_INK = 'rgb(125, 98, 54)';
const GOLD_BRIGHT = 'rgb(201, 168, 106)';
// Every public file that ships CSS or HTML (site.html is the gated app; it shares style.css).
const PUBLIC_FILES = ['public/marketing.css', 'public/style.css', 'public/index.html', 'public/pros.html', 'public/invite.html', 'public/privacy.html', 'public/404.html', 'public/site.html'];
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');

let srv;
let browser;
const contexts = new Set();

async function open({ viewport = DESKTOP, ip = freshIp(), reducedMotion = 'no-preference', deviceScaleFactor = 1 } = {}) {
  const context = await browser.newContext({ baseURL: srv.base, viewport, reducedMotion, deviceScaleFactor, extraHTTPHeaders: { 'x-forwarded-for': ip } });
  contexts.add(context);
  const external = [];
  await context.route((url) => !url.href.startsWith(srv.base), (route) => { external.push(route.request().url()); return route.abort(); });
  const page = await context.newPage();
  const errors = [];
  const console_ = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    console_.push(`${msg.type()}: ${msg.text()}`);
    if (msg.type() === 'error' && !/^Failed to load resource/.test(msg.text())) errors.push(`console.error: ${msg.text()}`);
  });
  page.errors = () => errors;
  page.consoleMessages = () => console_;
  page.external = () => external;
  page.close2 = async () => { await context.close(); contexts.delete(context); };
  return page;
}

const text = (page, sel) => page.locator(sel).first().evaluate((el) => el.textContent.trim());
const attr = (page, sel, name) => page.locator(sel).first().getAttribute(name);
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 50))));
const settled = (page) => page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
const activeInfo = (page) => page.evaluate(() => {
  const el = document.activeElement;
  return el ? { tag: el.tagName.toLowerCase(), id: el.id, cls: String(el.className), href: el.getAttribute('href'), text: (el.textContent || '').trim().slice(0, 40) } : null;
});

async function loadWholePage(page) {
  await page.evaluate(async () => {
    const step = Math.max(200, Math.floor(innerHeight * 0.8));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 40));
    }
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
    await Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; }))));
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => window.scrollY === 0);
  await settled(page);
  await settle(page);
}

// The mock file as the server writes it; empty before the first store access.
function mock() {
  try { return JSON.parse(fs.readFileSync(process.env.MOCK_DATA_PATH, 'utf8')); } catch { return { log: [], waitlist: [] }; }
}
// sendBeacon is fire-and-forget: wait for the Log tab to receive the row.
async function waitForLog(pred, ms = 3000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const rows = (mock().log || []).filter(pred);
    if (rows.length) return rows;
    await new Promise((r) => setTimeout(r, 50));
  }
  return [];
}

// Tab through the document until focus leaves it; each step records the focused control, whether a ring is drawn
// on it or on the frame that carries its ring (.pro-card for .pro-link), the ring's colour and whether the control
// sits on a dark surface (DESIGN_v2: gold-ink rings on cream and paper, gold-bright on espresso).
async function tabWalk(page, max = 150) {
  await page.evaluate(() => { window.scrollTo({ top: 0, behavior: 'instant' }); if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); });
  const steps = [];
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return null;
      const ring = (e) => { const s = getComputedStyle(e); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0; };
      const frame = el.closest('.pro-card, .panel');
      const carrier = ring(el) ? el : (frame && ring(frame) ? frame : el);
      return { tag: el.tagName.toLowerCase(), id: el.id, within: el.closest('[id]')?.id || '', cls: String(el.className), href: el.getAttribute('href'), text: (el.textContent || '').trim().slice(0, 40), focusVisible: el.matches(':focus-visible'), ring: ring(el) || (frame ? ring(frame) : false), ringOnFrame: !ring(el) && !!frame && ring(frame), ringColor: getComputedStyle(carrier).outlineColor, dark: !!el.closest('.dark, .how, .footer') };
    });
    if (!info) return { steps, left: true };
    steps.push(info);
  }
  return { steps, left: false };
}

// Every rule in a stylesheet with the at-rule stack it sits in (a small brace scanner, enough for marketing.css).
function cssRules(css) {
  const rules = [];
  const stack = [];
  let buf = '';
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '{') {
      const head = buf.trim();
      buf = '';
      if (head.startsWith('@')) { stack.push(head); rules.push({ selector: null, at: head, stack: [...stack] }); } else { stack.push(null); rules.push({ selector: head, stack: stack.filter(Boolean) }); }
    } else if (ch === '}') {
      if (stack.length && stack[stack.length - 1] === null) { const r = [...rules].reverse().find((x) => x.selector && !x.body); if (r) r.body = buf.trim(); }
      buf = '';
      stack.pop();
    } else if (ch === ';' && !stack.length) {
      buf = '';
    } else buf += ch;
  }
  return rules.filter((r) => r.selector);
}

before(async () => {
  if (!playwright) return;
  useTempMock();
  srv = await startServer();
  browser = await playwright.chromium.launch();
});
after(async () => {
  for (const c of contexts) await c.close().catch(() => {});
  if (browser) await browser.close();
  if (srv) { await resetMock(); await srv.close(); }
});

describe('polish checklist', { skip: playwright ? false : 'playwright is not installed: npm i -D playwright && npx playwright install chromium' }, () => {
  describe('2. hero', () => {
    test('one <h1> in Canela with the italic "further." (three lines at 1440), the intro and who lines, no tagline, no eyebrow, one primary button, the no-code link that scrolls to #waitlist and opens the general form, no second button', async (t) => {
      for (const viewport of [MOBILE, DESKTOP]) {
        const page = await open({ viewport });
        await page.goto('/');
        await settled(page);
        assert.equal(await page.locator('h1').count(), 1);
        assert.equal(plain(await text(page, '.hero h1')), 'tennis takes you further.');
        assert.equal(await text(page, '.hero h1 em'), 'further.', 'the italic word');
        assert.equal(await page.locator('.hero h1 em').evaluate((el) => getComputedStyle(el).fontStyle), 'italic');
        const h1 = await page.locator('.hero h1').evaluate((el) => { const s = getComputedStyle(el); return { size: Math.round(parseFloat(s.fontSize)), lines: Math.round(el.getBoundingClientRect().height / parseFloat(s.lineHeight)), family: s.fontFamily, weight: s.fontWeight }; });
        t.diagnostic(`${viewport.width}px: h1 ${h1.size}px, ${h1.lines} lines, ${h1.family} ${h1.weight}`);
        assert.match(h1.family, /^Canela\b/, 'Canela on the display line');
        assert.equal(h1.weight, '400');
        if (viewport.width === 1440) assert.equal(h1.lines, 3, 'three lines at 1440 (mockups/html/s01.html)');
        assert.equal(await page.locator('.hero .sub').count(), 0, 'no italic sub line (redesign v2)');
        assert.ok(!(await text(page, '.hero')).includes(TAGLINE), 'the tagline is not in the hero (CLAUDE_BUILD_PROMPT.md s01)');
        assert.equal(plain(await text(page, '.hero p.intro')), HERO_SENTENCES[0], 'the intro (POLISH_PLAN.md section 1, kept by v2)');
        assert.equal(plain(await text(page, '.hero p.who')), HERO_SENTENCES[1], 'the who line');
        assert.equal(await page.locator('.hero .eyebrow').count(), 0, 'no hero eyebrow');
        assert.equal(await page.locator('.hero-ctas a.btn').count(), 1, 'exactly one primary');
        assert.equal(await page.locator('.hero-ctas .secondary, .hero-ctas .primary, .hero-ctas button').count(), 0, 'no second button');
        assert.equal(await page.locator('.hero-ctas a').count(), 2);
        assert.equal(await text(page, '.hero-ctas a.btn'), 'Enter invite code');
        assert.equal(await attr(page, '.hero-ctas a.btn', 'href'), '/invite');
        assert.equal(await text(page, '.hero-ctas a.quiet.no-code'), 'Don’t have an invite code? Join the waitlist');
        assert.equal(await attr(page, '.hero-ctas a.no-code', 'href'), '#waitlist');
        const photo = await page.locator('figure.hero-image > img').evaluate((img) => ({ loading: img.getAttribute('loading'), priority: img.getAttribute('fetchpriority'), alt: img.alt, width: img.getAttribute('width'), height: img.getAttribute('height'), fit: getComputedStyle(img).objectFit, caption: img.parentElement.querySelector('figcaption')?.textContent.trim() ?? null }));
        t.diagnostic(`${viewport.width}px: hero photo ${JSON.stringify(photo)}`);
        assert.deepEqual([photo.loading, photo.priority, photo.fit], ['eager', 'high', 'cover'], 'the hero photo is eager, high priority, object-fit cover');
        assert.ok(photo.alt && photo.width && photo.height, 'alt, width and height on the hero photo');
        await page.evaluate(() => { window.__same = true; });
        await page.click('.hero-ctas a.no-code');
        await page.waitForFunction(() => location.hash === '#waitlist');
        await page.waitForFunction(() => { const el = document.getElementById('waitlist'); return Math.abs(el.getBoundingClientRect().top - parseFloat(getComputedStyle(el).scrollMarginTop)) < 4; }, null, { timeout: 5000 });
        const m = await page.evaluate(() => ({ same: window.__same, top: Math.round(document.getElementById('waitlist').getBoundingClientRect().top), header: Math.round(document.querySelector('.site-header').getBoundingClientRect().bottom), behavior: getComputedStyle(document.documentElement).scrollBehavior, expanded: document.querySelector('#waitlist button.waitlist-open').getAttribute('aria-expanded'), open: document.getElementById('waitlist-general').classList.contains('is-open'), visible: document.getElementById('waitlist-general').getClientRects().length > 0 }));
        t.diagnostic(`${viewport.width}px: #waitlist top ${m.top}px, header bottom ${m.header}px, scroll-behavior ${m.behavior}, form open ${m.open}`);
        assert.equal(m.same, true, 'same document (no navigation)');
        assert.equal(m.behavior, 'smooth', 'native CSS scroll-behavior, no library');
        assert.ok(m.top >= m.header - 1, `#waitlist (${m.top}) lands below the sticky header (${m.header})`);
        assert.ok(m.top <= m.header + 40, `#waitlist (${m.top}) lands just below the header (${m.header})`);
        assert.deepEqual([m.expanded, m.open, m.visible], ['true', true, true], 'the general waitlist form is open on arrival (home.js)');
        assert.deepEqual(page.errors(), []);
        await page.close2();
      }
    });
  });

  describe('3. CTA map', () => {
    test('/ : every control in POLISH_PLAN.md section 2 is present with its destination', async () => {
      const page = await open({ viewport: DESKTOP });
      await page.goto('/');
      const links = (sel) => page.locator(sel).evaluateAll((els) => els.map((a) => [a.textContent.trim(), a.getAttribute('href')]));
      assert.equal(await attr(page, '.site-header > a[aria-label="Courtside home"]', 'href'), '/');
      assert.deepEqual(await links('.site-nav a'), [['Trips', '#trips'], ['Meet the pros', '/pros']]);
      assert.deepEqual(await links('.site-header .invite-pill'), [['Enter code', '/invite']]);
      assert.deepEqual(await links('.hero-ctas a'), [['Enter invite code', '/invite'], ['Don’t have an invite code? Join the waitlist', '#waitlist']]);
      assert.deepEqual(await links('.sticky-cta a'), [['Enter code', '/invite']]);
      assert.deepEqual(await links('#about .ask a'), [['Meet the pros →', '/pros']], 's02: one button, the arrow typed in the copy');
      assert.deepEqual(await links('#trips .panel a, #trips .overlay a, #trips button'), [], 'the featured panel has no button or link (the hero and the pill own the invite ask)');
      assert.deepEqual(await page.locator('#trips .panel .tag').evaluateAll((els) => els.map((e) => e.textContent.trim())), ['Invitation only'], 'one "Invitation only" label, a chip on the panel');
      assert.equal(await page.locator('#trips .overlay .caps, #trips .caps').count(), 0, 'the overlay duplicate is gone');
      assert.deepEqual(await links('#season a'), [['Join the waitlist →', '#waitlist']], 's05: one ask under the grid');
      assert.equal(await page.locator('#season button, #season form').count(), 0, 'no per-card openers or forms');
      assert.deepEqual(await links('#how a'), [['Enter it here', '/invite']], 'step 1: one quiet link, no button');
      assert.equal(await page.locator('#how button, #how .btn, #how .primary, #how .secondary').count(), 0);
      assert.deepEqual(await links('#pros .pro-link'), [['Katie Delich', '/pros#katie'], ['Eva', '/pros#eva'], ['Nelson Ramos', '/pros#nelson']]);
      assert.deepEqual(await links('#pros .section-cta a'), [['Meet the pros', '/pros']]);
      assert.deepEqual(await page.locator('#waitlist button.waitlist-open').evaluateAll((els) => els.map((b) => [b.textContent.trim(), b.getAttribute('aria-controls')])), [['Join the waitlist', 'waitlist-general']]);
      assert.deepEqual(await page.locator('#waitlist form.waitlist-form').evaluateAll((els) => els.map((f) => [f.dataset.trip, f.dataset.source])), [['general', 'footer']]);
      assert.deepEqual(await links('.footer-links a'), [['Meet the pros', '/pros'], ['Privacy', '/privacy'], ['Enter code', '/invite']]);
      assert.equal(await page.locator('.site-header .site-powered, .site-header .powered').count(), 0, '"powered by tgl.rsvp" is not in the header (decision 8)');
      assert.deepEqual(await page.locator('.site-powered').evaluateAll((els) => els.map((el) => [el.closest('footer') ? 'footer' : 'elsewhere', el.textContent.trim()])), [['footer', 'powered by tgl.rsvp']], 'footer only');
      // Fewer asks (CLAUDE_BUILD_PROMPT.md step 2): the hero CTA, the header pill, one "Join the waitlist" in s05, the s08 form; the phone bar keeps one "Enter code".
      assert.equal(await page.locator('button.waitlist-open').count(), 1, 'the general opener is the only one on the page');
      assert.equal(await page.locator('form').count(), 1, 'one form on the page');
      assert.deepEqual(await links('a[href="#waitlist"]'), [['Don’t have an invite code? Join the waitlist', '#waitlist'], ['Join the waitlist →', '#waitlist']], 'two links land on the waitlist');
      assert.equal(await page.locator('a[href="/invite"]').count(), 5, 'invite links: header pill, hero button, step 1 link, footer, sticky bar');
      await page.close2();
    });

    test('/pros : header with Trips → /#trips, the jump row, the Spain card and line → /invite, "Enter invite code" per profile', async () => {
      const page = await open({ viewport: DESKTOP });
      await page.goto('/pros');
      const links = (sel) => page.locator(sel).evaluateAll((els) => els.map((a) => [a.textContent.trim(), a.getAttribute('href')]));
      assert.deepEqual(await links('.site-nav a'), [['Trips', '/#trips'], ['Meet the pros', '/pros']]);
      assert.equal(await attr(page, '.site-nav a[href="/pros"]', 'aria-current'), 'page');
      assert.deepEqual(await links('.site-header .invite-pill'), [['Enter code', '/invite']]);
      assert.deepEqual(await page.locator('.pros-jump a').evaluateAll((els) => els.map((a) => [a.querySelector('.pros-jump-name').textContent.trim(), a.getAttribute('href')])), [['Katie Delich', '#katie'], ['Eva', '#eva'], ['Nelson Ramos', '#nelson']]);
      assert.deepEqual(await links('#katie-trip-spain a'), [['Enter with your invitation', '/invite']]);
      assert.deepEqual(await links('#eva-trip-spain a'), [['Co-hosts The Spanish Offseason with Katie', '/invite']]);
      assert.deepEqual(await links('.profile-section .section-cta a'), Array(3).fill(['Enter invite code', '/invite']));
      assert.deepEqual(await links('.footer-links a'), [['Meet the pros', '/pros'], ['Privacy', '/privacy'], ['Enter code', '/invite']]);
      await page.close2();
    });

    test('the header pill reads "Enter code" → /invite on every public page with the shell header; one row at every width (Trips, Meet the pros hidden under 700px, the pill); 68px / 88px tall, solid cream, no glass, sentence-case 16px links', async (t) => {
      for (const route of SHELL_PAGES) {
        for (const viewport of [MOBILE, DESKTOP]) {
          const page = await open({ viewport });
          await page.goto(route);
          assert.deepEqual(await page.locator('.site-header .invite-pill').evaluateAll((els) => els.map((a) => [a.textContent.trim(), a.getAttribute('href'), getComputedStyle(a).display !== 'none'])), [['Enter code', '/invite', true]], `${route} @${viewport.width}`);
          const m = await page.evaluate(() => {
            const header = document.querySelector('.site-header');
            const hs = getComputedStyle(header);
            const logo = header.querySelector('a[aria-label]').getBoundingClientRect();
            const nav = header.querySelector('.site-nav').getBoundingClientRect();
            const pill = header.querySelector('.invite-pill').getBoundingClientRect();
            const links = [...header.querySelectorAll('.site-nav a')].map((a) => ({ text: a.textContent.trim(), shown: a.getClientRects().length > 0 && getComputedStyle(a).display !== 'none', h: Math.round(a.getBoundingClientRect().height), size: getComputedStyle(a).fontSize, transform: getComputedStyle(a).textTransform }));
            return { headerH: Math.round(header.getBoundingClientRect().height), headerVar: getComputedStyle(document.documentElement).getPropertyValue('--header-h').trim(), bg: hs.backgroundColor, backdrop: hs.backdropFilter, hairline: hs.borderBottomWidth, logoBottom: Math.round(logo.bottom), navTop: Math.round(nav.top), pillTop: Math.round(pill.top), pillBottom: Math.round(pill.bottom), pillH: Math.round(pill.height), links };
          });
          t.diagnostic(`${route} @${viewport.width}: header ${m.headerH}px (--header-h ${m.headerVar}), ${m.bg}, backdrop ${m.backdrop}; logo bottom ${m.logoBottom}, nav top ${m.navTop}, pill ${m.pillTop}–${m.pillBottom}; links ${JSON.stringify(m.links)}`);
          const phone = viewport.width === 390;
          assert.deepEqual(m.links.map((l) => [l.text, l.shown]), [['Trips', true], ['Meet the pros', !phone]], `${route} @${viewport.width}: Trips always, Meet the pros from 700px (s01)`);
          assert.ok(m.links.filter((l) => l.shown).every((l) => l.h >= 40) && m.pillH >= 40, 'nav links and the pill are at least 40px tall (tap targets)');
          assert.ok(m.links.every((l) => l.size === '16px' && l.transform === 'none'), 'sentence-case 16px links');
          assert.equal(m.headerH, phone ? 68 : 88, '68px on phones, 88px from 700px (s01)');
          assert.ok(Math.abs(m.headerH - parseFloat(m.headerVar)) <= 4, `the header is as tall as --header-h says (${m.headerH} vs ${m.headerVar}), so anchors land right`);
          assert.ok(m.navTop < m.logoBottom && m.navTop < m.pillBottom, `${route} @${viewport.width}: one row (nav top ${m.navTop}, logo bottom ${m.logoBottom}, pill bottom ${m.pillBottom}); no second row on phones`);
          assert.equal(m.bg, CREAM, 'solid cream');
          assert.equal(m.backdrop, 'none', 'no glass (step 2)');
          assert.equal(m.hairline, '1px', 'the bottom hairline');
          await page.close2();
        }
      }
    });

    test('sticky bar: off while the hero is on screen (and out of the tab order), on after it scrolls out, absent from 700px up', async (t) => {
      const page = await open({ viewport: MOBILE });
      await page.goto('/');
      await settled(page);
      const state = () => page.evaluate(() => {
        const bar = document.querySelector('.sticky-cta');
        const a = bar.querySelector('a');
        const s = getComputedStyle(bar);
        a.focus();
        const focusable = document.activeElement === a;
        if (focusable) a.blur();
        return { on: bar.classList.contains('is-on'), ariaHidden: bar.getAttribute('aria-hidden'), visibility: s.visibility, transform: s.transform, display: s.display, position: s.position, bg: s.backgroundColor, backdrop: s.backdropFilter, hairline: s.borderTopWidth, focusable, heroBottom: Math.round(document.querySelector('.home-hero').getBoundingClientRect().bottom) };
      });
      const off = await state();
      t.diagnostic(`390 at the top: ${JSON.stringify(off)}`);
      assert.equal(off.on, false);
      assert.equal(off.ariaHidden, 'true');
      assert.equal(off.visibility, 'hidden', 'hidden from the tab order while off');
      assert.equal(off.focusable, false, 'its link cannot take focus while off');
      assert.equal(off.position, 'fixed');
      assert.deepEqual([off.bg, off.backdrop, off.hairline], [CREAM, 'none', '1px'], 'solid cream with a top hairline, no glass (step 2)');
      await page.evaluate(() => window.scrollTo({ top: document.querySelector('.home-hero').getBoundingClientRect().bottom + window.scrollY + 120, behavior: 'instant' }));
      await page.waitForFunction(() => document.querySelector('.sticky-cta').classList.contains('is-on'), null, { timeout: 3000 });
      await page.waitForTimeout(450); // the .32s slide
      const on = await state();
      t.diagnostic(`390 after the hero: ${JSON.stringify(on)}`);
      assert.equal(on.ariaHidden, 'false');
      assert.equal(on.visibility, 'visible');
      assert.equal(on.transform, 'none');
      assert.equal(on.focusable, true, 'its link takes focus while on');
      assert.ok(on.heroBottom <= 0, 'the hero is above the viewport');
      const box = await page.locator('.sticky-cta a').boundingBox();
      assert.ok(box.y + box.height <= 844 + 1 && box.y > 700, `the bar sits at the bottom of the viewport (link at y ${Math.round(box.y)})`);
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await page.waitForFunction(() => !document.querySelector('.sticky-cta').classList.contains('is-on'), null, { timeout: 3000 });
      await page.waitForTimeout(450);
      const back = await state();
      assert.equal(back.ariaHidden, 'true');
      assert.equal(back.visibility, 'hidden');
      assert.equal(back.focusable, false);
      assert.deepEqual(page.errors(), []);
      await page.close2();
      for (const viewport of [TABLET, DESKTOP]) {
        const wide = await open({ viewport });
        await wide.goto('/');
        await wide.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight / 2, behavior: 'instant' }));
        await wide.waitForTimeout(300);
        const m = await wide.evaluate(() => { const bar = document.querySelector('.sticky-cta'); return { display: getComputedStyle(bar).display, rects: bar.getClientRects().length, on: bar.classList.contains('is-on') }; });
        t.diagnostic(`${viewport.width}px mid-page: ${JSON.stringify(m)}`);
        assert.equal(m.display, 'none', `${viewport.width}px: the bar does not exist visually`);
        assert.equal(m.rects, 0);
        await wide.close2();
      }
    });
  });

  describe('4. waitlist capture', () => {
    test('the one opener: semantics, focus, Escape; the server message on a bad email; client checks never reach the server; a valid submit writes one Waitlist row (General / footer) and one Log row; honeypot; the hero link and the season button land on the open form and the hero link logs no_code_click', async (t) => {
      await resetMock();
      const page = await open({ viewport: DESKTOP });
      let apiCalls = 0;
      page.on('request', (req) => { if (req.url().endsWith('/api/waitlist')) apiCalls += 1; });
      await page.goto('/');
      await settled(page);
      const openers = await page.locator('button.waitlist-open').evaluateAll((els) => els.map((b) => ({ expanded: b.getAttribute('aria-expanded'), controls: b.getAttribute('aria-controls'), target: !!document.getElementById(b.getAttribute('aria-controls'))?.querySelector('form.waitlist-form'), within: b.closest('section')?.id })));
      assert.deepEqual(openers, [{ expanded: 'false', controls: 'waitlist-general', target: true, within: 'waitlist' }], 'one button.waitlist-open[aria-expanded][aria-controls] on the page, at the close (redesign v2 removed the per-card captures)');

      // Open: focus on the email field. The general form logs no trip_card_open (home.js skips the event for "general").
      await page.click('#waitlist button.waitlist-open');
      assert.equal(await attr(page, '#waitlist button.waitlist-open', 'aria-expanded'), 'true');
      assert.equal((await activeInfo(page)).id, 'wl-general-email', 'opening focuses the email field');
      assert.equal(await text(page, '#waitlist-general .waitlist-title'), 'Join the waitlist');

      // Escape closes and returns focus.
      await page.keyboard.press('Escape');
      assert.equal(await attr(page, '#waitlist button.waitlist-open', 'aria-expanded'), 'false');
      assert.equal(await page.locator('#waitlist-general').evaluate((el) => el.getClientRects().length), 0, 'the capture is hidden again');
      assert.equal((await activeInfo(page)).cls, 'secondary waitlist-open', 'focus returns to the opener');

      // Reopen; a bad email that passes the client check but not the server's.
      await page.click('#waitlist button.waitlist-open');
      await page.fill('#wl-general-email', 'ana@example.c');
      await page.check('#waitlist-general input[name="consent"]');
      const bad = page.waitForResponse((r) => r.url().endsWith('/api/waitlist'));
      await page.click('#waitlist-general button[type="submit"]');
      assert.equal((await bad).status(), 400);
      await page.waitForFunction(() => { const s = document.querySelector('#waitlist-general .form-status').textContent.trim(); return s !== '' && s !== 'Joining…'; });
      assert.equal(await text(page, '#waitlist-general .form-status'), 'Enter a valid email address.', "the server's message");
      assert.ok(await page.locator('#waitlist-general .form-status').evaluate((el) => el.classList.contains('is-error')));
      assert.equal((await activeInfo(page)).id, 'wl-general-email', 'focus goes back to the email field');
      assert.equal(await page.locator('#waitlist-general button[type="submit"]').isEnabled(), true, 'Join is enabled again');
      assert.equal((mock().waitlist || []).length, 0, 'nothing written for a 400');

      // Client-side checks: a malformed email and an unticked consent box never reach the server.
      await page.fill('#wl-general-email', 'nope');
      await page.click('#waitlist-general button[type="submit"]');
      assert.equal(await text(page, '#waitlist-general .form-status'), 'Enter a working email address.');
      assert.equal((await activeInfo(page)).id, 'wl-general-email', 'focus on the field to fix');
      await page.fill('#wl-general-email', 'Ana.Guest@Example.com');
      await page.uncheck('#waitlist-general input[name="consent"]');
      await page.click('#waitlist-general button[type="submit"]');
      assert.equal(await text(page, '#waitlist-general .form-status'), 'Tick the box so Courtside can keep your email.');
      assert.equal(await page.evaluate(() => document.activeElement.name), 'consent', 'focus on the box to tick');
      assert.equal(apiCalls, 1, 'only the bad-email submit reached /api/waitlist');

      // A valid submit with a name: General / footer.
      await page.check('#waitlist-general input[name="consent"]');
      await page.fill('#wl-general-name', 'Ana Guest');
      const ok = page.waitForResponse((r) => r.url().endsWith('/api/waitlist'));
      await page.click('#waitlist-general button[type="submit"]');
      assert.equal((await ok).status(), 200);
      await page.waitForFunction(() => document.querySelector('#waitlist-general form').classList.contains('is-done'));
      assert.equal(await text(page, '#waitlist-general .form-status'), 'You’re on the list. Katie will be in touch when the lineup firms up.');
      assert.equal(await page.locator('#waitlist-general .waitlist-fields').evaluate((el) => getComputedStyle(el).display), 'none', 'the fields fold away on success');
      let data = mock();
      assert.equal(data.waitlist.length, 1, 'one Waitlist row per submit');
      assert.deepEqual(data.waitlist[0], { ...data.waitlist[0], email: 'ana.guest@example.com', name: 'Ana Guest', trip: 'General', source: 'footer' }, 'General / footer, lower-cased email');
      assert.deepEqual(Object.keys(data.waitlist[0]), ['timestamp', 'email', 'name', 'trip', 'source']);
      assert.deepEqual(data.log.filter((r) => r.code === 'waitlist_submit').map((r) => r.result), ['general'], 'one waitlist_submit Log row');
      assert.match(data.log[0].ip_hash, /^[0-9a-f]{16}$/);
      assert.deepEqual(Object.keys(data.log[0]), ['time', 'code', 'result', 'ip_hash']);
      assert.equal(data.log.filter((r) => r.code === 'trip_card_open').length, 0, 'the general form logs no trip_card_open');

      // Honeypot, on a fresh load: looks like success, writes nothing.
      await page.goto('/pros');
      await page.goto('/');
      await settled(page);
      await page.click('#waitlist button.waitlist-open');
      await page.fill('#wl-general-email', 'bot@example.com');
      await page.check('#waitlist-general input[name="consent"]');
      const hpField = await page.locator('#waitlist-general .hp').evaluate((el) => ({ ariaHidden: el.getAttribute('aria-hidden'), offScreen: el.getBoundingClientRect().right < -5000, opacity: getComputedStyle(el).opacity, tabIndex: el.querySelector('input').tabIndex }));
      assert.deepEqual(hpField, { ariaHidden: 'true', offScreen: true, opacity: '0', tabIndex: -1 }, 'the honeypot is off screen (left:-9999px), transparent and out of the tab order');
      await page.evaluate(() => { document.querySelector('#waitlist-general input[name="website"]').value = 'http://spam.example'; });
      const hp = page.waitForResponse((r) => r.url().endsWith('/api/waitlist'));
      await page.click('#waitlist-general button[type="submit"]');
      assert.equal((await hp).status(), 200);
      await page.waitForFunction(() => document.querySelector('#waitlist-general form').classList.contains('is-done'));
      data = mock();
      assert.equal(data.waitlist.length, 1, 'the honeypot wrote no Waitlist row');
      assert.equal(data.log.filter((r) => r.code === 'waitlist_submit').length, 1, 'and no Log row');
      assert.equal(await text(page, '#waitlist-general .form-status'), 'You’re on the list. Katie will be in touch when the lineup firms up.', 'a bot sees the same success copy');

      // The hero link: scrolls to #waitlist, opens the form on arrival and logs no_code_click.
      await page.goto('/pros');
      await page.goto('/');
      await settled(page);
      await page.click('.hero-ctas a.no-code');
      await page.waitForFunction(() => location.hash === '#waitlist');
      assert.equal(await attr(page, '#waitlist button.waitlist-open', 'aria-expanded'), 'true', 'the form is open on arrival');
      const noCode = await waitForLog((r) => r.code === 'no_code_click');
      assert.equal(noCode.length, 1, 'one no_code_click row');
      assert.equal(noCode[0].result, '');
      assert.match(noCode[0].ip_hash, /^[0-9a-f]{16}$/);
      assert.deepEqual(Object.keys(noCode[0]), ['time', 'code', 'result', 'ip_hash']);
      // The season button lands on the open form too, and so does arriving with the hash in the URL.
      await page.goto('/pros');
      await page.goto('/');
      await settled(page);
      await page.click('#season .season-ask a[href="#waitlist"]');
      await page.waitForFunction(() => location.hash === '#waitlist');
      assert.equal(await attr(page, '#waitlist button.waitlist-open', 'aria-expanded'), 'true', 'the season button opens the form');
      await page.goto('/pros');
      await page.goto('/#waitlist');
      assert.equal(await attr(page, '#waitlist button.waitlist-open', 'aria-expanded'), 'true', 'a /#waitlist link from another page opens the form on load');
      assert.equal((await waitForLog((r) => r.code === 'no_code_click')).length, 1, 'the season button and the hash arrival log no no_code_click');
      t.diagnostic(`Log rows: ${mock().log.map((r) => `${r.code}:${r.result}`).join(', ')}`);
      assert.deepEqual(page.errors(), []);
      assert.deepEqual(page.external(), []);
      await page.close2();
    });

    test('the capture reads without JS: the one form is in the markup, open, with the noscript line', async () => {
      const r = await http(srv.base, '/');
      assert.equal((r.text.match(/<form\b/g) || []).length, 1, 'one form in the HTML: the general capture (no per-card forms)');
      assert.match(r.text, /<form class="waitlist-form" data-source="footer" data-trip="general" data-trip-name="" novalidate=""/, 'General / footer');
      assert.equal((r.text.match(/class="secondary waitlist-open"/g) || []).length, 1, 'one opener in the HTML');
      assert.match(r.text, /<noscript><p class="waitlist-noscript">Turn on JavaScript to join the waitlist, or ask Katie\.<\/p><\/noscript>/);
      assert.match(read('public/marketing.css'), /\.js \.waitlist-capture:not\(\.is-open\)\{display:none\}/, 'hidden only when JS is on');
      assert.match(r.text, /<a href="\/privacy">keep my email<\/a>/, 'the consent line links /privacy');
      const context = await browser.newContext({ baseURL: srv.base, javaScriptEnabled: false, extraHTTPHeaders: { 'x-forwarded-for': freshIp() } });
      contexts.add(context);
      const page = await context.newPage();
      await page.goto('/');
      const noJs = await page.evaluate(() => ({ form: document.querySelector('#waitlist-general form').getClientRects().length > 0, noscript: !!document.querySelector('.waitlist-noscript') && getComputedStyle(document.querySelector('.waitlist-noscript')).display !== 'none', jsClass: document.documentElement.classList.contains('js') }));
      assert.deepEqual(noJs, { form: true, noscript: true, jsClass: false }, 'without JS the form is visible and the noscript line shows');
      await context.close();
      contexts.delete(context);
    });
  });

  describe('5. placeholders', () => {
    test('no "To come" text in the rendered /pros or / DOM; Nelson shows name, monogram and "Trips to be announced"; --check passes', async (t) => {
      const out = execFileSync(process.execPath, [path.join(ROOT, 'public/js/pros-page.js'), '--check'], { cwd: ROOT, encoding: 'utf8' });
      t.diagnostic(out.trim());
      assert.match(out, /pros\.html matches pros\.js \(3 pros\) and IMAGES matches manifest\.json/);
      const PLACEHOLDER = /\b(?:bio |details |role |photo )?to come\b/i;
      for (const route of ['/pros', '/']) {
        const page = await open();
        await page.goto(route);
        await page.waitForLoadState('networkidle');
        const dom = await page.evaluate(() => ({ text: document.body.textContent, html: document.documentElement.outerHTML }));
        assert.doesNotMatch(dom.text, PLACEHOLDER, `${route}: no placeholder text in the rendered DOM`);
        assert.doesNotMatch(dom.html, PLACEHOLDER, `${route}: no placeholder text anywhere in the DOM, comments included`);
        if (route === '/pros') {
          const nelson = await page.evaluate(() => {
            const s = document.getElementById('nelson');
            return { h2: s.querySelector('h2').textContent.trim(), monogram: s.querySelector('.monogram span').textContent.trim(), img: s.querySelectorAll('img').length, eyebrow: s.querySelectorAll('.eyebrow').length, facts: s.querySelectorAll('.quickfacts').length, panels: s.querySelectorAll('.profile-panels').length, trips: s.querySelector('.profile-trips .placeholder').textContent.trim(), cta: s.querySelector('.section-cta a').textContent.trim() };
          });
          assert.deepEqual(nelson, { h2: 'Nelson Ramos', monogram: 'NR', img: 0, eyebrow: 0, facts: 0, panels: 0, trips: 'Trips to be announced.', cta: 'Enter invite code' });
          const others = await page.evaluate(() => ['katie', 'eva'].map((id) => { const s = document.getElementById(id); return { id, facts: [...s.querySelectorAll('.quickfact strong')].map((e) => e.textContent.trim()), panels: [...s.querySelectorAll('.profile-label')].map((e) => e.textContent.trim()), onCourt: s.querySelectorAll('.on-court li').length }; }));
          t.diagnostic(`/pros known rows: ${JSON.stringify(others)}`);
          assert.deepEqual(others.map((o) => o.panels), [['On court', 'Trips'], ['On court', 'Trips']], 'no About panel until a bio exists');
          assert.deepEqual(others.map((o) => o.facts), [['Almoradí', 'Spain'], ['Almoradí', 'Spain']], 'only the known facts');
        }
        await page.close2();
      }
    });
  });

  describe('6. photos', () => {
    test('Katie = katie-portrait-34 (left half), Eva = eva-portrait-34 (right half), alts name the right person; one hero photo at every width with the right srcset pick; the about photo per breakpoint; alt, width and height on every <img>', async (t) => {
      const manifest = JSON.parse(read('public/assets/derived/manifest.json'));
      const W = 960; // play-katie-eva-clay.jpg
      const katie = manifest['katie-portrait-34'].original.crop;
      const eva = manifest['eva-portrait-34'].original.crop;
      t.diagnostic(`crops: katie ${JSON.stringify(katie)}, eva ${JSON.stringify(eva)}`);
      assert.ok(katie.left + katie.width / 2 < W / 2, 'Katie is cut from the left half (PHOTOS.md)');
      assert.ok(eva.left + eva.width / 2 > W / 2, 'Eva is cut from the right half (PHOTOS.md)');
      assert.ok(eva.left >= katie.left + katie.width / 2, 'the two windows do not share a centre');

      const pros = await open();
      await pros.goto('/pros');
      await loadWholePage(pros);
      const portraits = await pros.evaluate(() => ({
        katie: { src: document.querySelector('#katie .profile-media img').currentSrc.split('/').pop(), alt: document.querySelector('#katie .profile-media img').alt },
        eva: { src: document.querySelector('#eva .profile-media img').currentSrc.split('/').pop(), alt: document.querySelector('#eva .profile-media img').alt },
        jumpKatie: { src: document.querySelector('.pros-jump a[href="#katie"] img').currentSrc.split('/').pop(), alt: document.querySelector('.pros-jump a[href="#katie"] img').alt },
        jumpEva: { src: document.querySelector('.pros-jump a[href="#eva"] img').currentSrc.split('/').pop(), alt: document.querySelector('.pros-jump a[href="#eva"] img').alt },
      }));
      t.diagnostic(`/pros portraits: ${JSON.stringify(portraits)}`);
      for (const k of ['katie', 'jumpKatie']) { assert.match(portraits[k].src, /^katie-portrait-34-/); assert.match(portraits[k].alt, /Katie/); assert.doesNotMatch(portraits[k].alt, /Eva/); }
      for (const k of ['eva', 'jumpEva']) { assert.match(portraits[k].src, /^eva-portrait-34-/); assert.match(portraits[k].alt, /Eva/); assert.doesNotMatch(portraits[k].alt, /Katie/); }
      await pros.close2();

      const home = await open({ viewport: MOBILE });
      await home.goto('/');
      await loadWholePage(home);
      const teaser = await home.evaluate(() => [...document.querySelectorAll('#pros .pro-card')].map((c) => ({ name: c.querySelector('.pro-link').textContent.trim(), src: c.querySelector('img')?.currentSrc.split('/').pop() || null, alt: c.querySelector('img')?.alt || null, monogram: c.querySelector('.monogram span')?.textContent.trim() || null })));
      t.diagnostic(`teaser @390: ${JSON.stringify(teaser)}`);
      assert.equal(teaser[0].name, 'Katie Delich'); assert.equal(teaser[0].src, 'katie-portrait-34-480.webp', 'phones fetch the 480 variant of Katie'); assert.match(teaser[0].alt, /Katie/);
      assert.equal(teaser[1].name, 'Eva'); assert.equal(teaser[1].src, 'eva-portrait-34-403.webp', 'Eva: the crop is 403px wide, its only (sub-480) variant'); assert.match(teaser[1].alt, /Eva/);
      assert.equal(teaser[2].monogram, 'NR');
      assert.equal(await home.evaluate(() => document.querySelector('#about .about-photo img').currentSrc.split('/').pop()), 'katie-eva-coast-480.webp', 'phones fetch the 480 variant of the coast photo (s02)');
      await home.close2();

      // The hero (redesign v2): one photo at every width, a single <img sizes srcset> (no <picture> crops per breakpoint),
      // served as WebP from /images/hero/; each viewport gets the smallest variant that covers the `sizes` slot at the
      // device scale. The about photo (s02) is the katie-eva-coast crop: 480 on phones, 768 at 1440.
      for (const viewport of [MOBILE, TABLET, DESKTOP]) {
        const page = await open({ viewport });
        await page.goto('/');
        await page.waitForFunction(() => document.querySelector('.hero-image img').complete);
        const hero = await page.evaluate(() => {
          const img = document.querySelector('figure.hero-image > img');
          const length = (v) => (v.endsWith('vw') ? (parseFloat(v) * innerWidth) / 100 : parseFloat(v));
          let slot = null;
          for (const part of (img.getAttribute('sizes') || '100vw').split(',').map((s) => s.trim())) {
            const m = part.match(/^\((.*)\)\s+(\S+)$/);
            if (!m) { slot = length(part); break; }
            if (matchMedia(`(${m[1]})`).matches) { slot = length(m[2]); break; }
          }
          const need = (slot ?? innerWidth) * devicePixelRatio;
          const candidates = img.getAttribute('srcset').split(',').map((c) => { const [url, w] = c.trim().split(/\s+/); return { file: url.split('/').pop(), dir: url.slice(0, url.lastIndexOf('/')), w: Number(w.replace('w', '')) }; }).sort((a, b) => a.w - b.w);
          const expected = candidates.find((c) => c.w >= need) || candidates[candidates.length - 1];
          return { pictures: document.querySelectorAll('.hero-image picture, .hero-image source').length, current: img.currentSrc.split('/').pop(), expected: expected.file, need: Math.round(need), widths: candidates.map((c) => c.w), dirs: [...new Set(candidates.map((c) => c.dir))], about: document.querySelector('#about .about-photo img').currentSrc.split('/').pop() };
        });
        t.diagnostic(`hero @${viewport.width}: ${hero.current} (slot ${hero.need}px of ${hero.widths.join('/')}); about photo ${hero.about}`);
        assert.equal(hero.pictures, 0, 'one <img>, no <picture> crops per breakpoint');
        assert.deepEqual(hero.dirs, ['/images/hero'], 'the hero variants live in /images/hero/');
        assert.match(hero.current, /\.webp$/, 'served as WebP');
        assert.equal(hero.current, hero.expected, `${viewport.width}px: the smallest variant that covers the slot`);
        if (viewport.width === 1440) assert.equal(hero.about, 'katie-eva-coast-768.webp', 'the about photo at 1440 is the 768 variant');
        await page.close2();
      }

      for (const route of PUBLIC_PAGES) {
        const page = await open();
        await page.goto(route);
        const imgs = await page.evaluate(() => [...document.images].map((i) => ({ src: (i.getAttribute('src') || '').split('/').pop(), alt: i.getAttribute('alt'), width: i.getAttribute('width'), height: i.getAttribute('height') })));
        const bad = imgs.filter((i) => !i.alt || !i.width || !i.height);
        assert.deepEqual(bad, [], `${route}: alt, width and height on every <img>`);
        assert.ok(imgs.length >= 1, `${route}: has images`);
        await page.close2();
      }
    });

    test('phones (390, 3×) fetch no image variant wider than 1400 on / (a full-width photo at 3× needs 1170px)', async (t) => {
      const page = await open({ viewport: MOBILE, deviceScaleFactor: 3 });
      const images = [];
      page.on('requestfinished', (req) => { if (req.resourceType() === 'image') images.push(req.url().split('/').pop()); });
      await page.goto('/');
      await loadWholePage(page);
      const widths = images.map((f) => ({ f, w: Number((f.match(/-(\d+)\.(?:webp|jpg|png)$/) || [])[1] || 0) }));
      t.diagnostic(`/ @390×3 images: ${widths.map((x) => `${x.f}`).join(', ')}`);
      assert.ok(widths.length > 0);
      assert.ok(widths.every((x) => x.w > 0 && x.w <= 1400), 'no variant wider than 1400');
      await page.close2();
    });
  });

  describe('7. no invented claims', () => {
    test('every grep hit in index.html, pros.html, 404.html, trips.js, pros.js is an allowed fact, "To be announced" or markup noise', (t) => {
      const files = ['public/index.html', 'public/pros.html', 'public/404.html', 'public/js/trips.js', 'public/js/pros.js'];
      const patterns = { '\\$': /\$/, guests: /guests/i, players: /players/i, star: /star/i, '8–12': /8–12/, Dellich: /Dellich/i, Miami: /Miami/i, 'white visor': /white visor/i };
      const hits = [];
      for (const file of files) {
        read(file).split('\n').forEach((line, i) => {
          for (const [name, re] of Object.entries(patterns)) if (re.test(line)) hits.push({ pattern: name, file, line: i + 1, full: line.trim(), text: line.trim().slice(0, 140) });
        });
      }
      const verdict = (h) => {
        const s = h.full;
        if (h.pattern === '\\$') return /\$2,995/.test(s) && !/\$\s?[0-9]/.test(s.replaceAll('$2,995', '')) ? 'allowed: $2,995 / from $2,995' : 'NOT ALLOWED';
        if (h.pattern === 'players') {
          // "4–12 players" in prose, the s03 facts pair (mockups/html/s03.html: "Players, private groups") or the approved hero sentence.
          const rest = s.replaceAll('4–12 players', '').replaceAll('4–12</strong><span>players', '').replaceAll('<strong>4–12</strong><span>Players, private groups</span>', '').replaceAll(HERO_SENTENCES[1], '');
          if (/players/i.test(rest)) return 'NOT ALLOWED';
          return s.includes(HERO_SENTENCES[1]) ? 'allowed: the approved hero sentence' : 'allowed: 4–12 players';
        }
        if (h.pattern === 'star') {
          if (/pros(?:-jump)?:(?:start|end)/.test(s) && !/star(?!t)/i.test(s)) return 'markup noise: pros:start / pros-jump:start marker';
          // "five-star La Finca" in prose and the s03 facts label "Five-star resort · home base" (mockups/html/s03.html).
          return /[Ff]ive-star/.test(s) && /La Finca/.test(s) && !/star(?!t)/i.test(s.replace(/[Ff]ive-star/g, '')) ? 'allowed: five-star La Finca' : 'NOT ALLOWED';
        }
        return 'NOT ALLOWED';
      };
      for (const h of hits) t.diagnostic(`[${h.pattern}] ${h.file}:${h.line} -> ${verdict(h)} | ${h.text}`);
      const bad = hits.filter((h) => verdict(h) === 'NOT ALLOWED').map(({ full, ...rest }) => rest);
      assert.deepEqual(bad, [], 'every hit is an allowed fact or markup noise');
      for (const name of ['guests', '8–12', 'Dellich', 'Miami', 'white visor']) assert.equal(hits.filter((h) => h.pattern === name).length, 0, `${name}: no hits`);
      assert.deepEqual(hits.filter((h) => h.pattern === '\\$').map((h) => h.file), ['public/index.html', 'public/index.html', 'public/pros.html', 'public/js/trips.js'], 'the price appears twice on / (the featured overlay and the Spain season card), once on /pros and in trips.js');
      // "To be announced" is the only wording for an unconfirmed detail on the non-Spain cards; the one "TBD" is the
      // fall residency's place chip from the approved mockup ("Place TBD · court texture", mockups/html/s05-cards.html).
      const index = read('public/index.html');
      assert.equal((index.match(/<p class="st">To be announced<\/p>/g) || []).length, 5, 'five cards without a blurb say "To be announced"');
      assert.equal((index.match(/<span class="lbl">Place TBD · court texture<\/span>/g) || []).length, 1, 'the fall residency chip, once');
      assert.doesNotMatch(index.replace(/<span class="lbl">Place TBD · court texture<\/span>/, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' '), /\bTBD\b|\bTBA\b|coming soon/i, 'no other "unknown" wording in the visible text');
    });
  });

  describe('8. type and space', () => {
    test('the token block (style.css :root, DESIGN_v2.md): eight --t-* steps, ten --s-* steps, section padding, three radii, motion, the gold text colours, the Canela and GT America stacks; marketing.css keeps only page-specific tokens; every bare font size in marketing.css is a mockup size or the monogram ornament', (t) => {
      const style = read('public/style.css');
      const css = read('public/marketing.css');
      const styleRoot = style.match(/:root\s*\{[^}]*\}/)[0];
      const root = css.match(/:root\s*\{[^}]*\}/)[0];
      const tSteps = [...styleRoot.matchAll(/--t(-?-\d):\s*([^;]+);/g)].map((m) => [`--t${m[1]}`, m[2].trim()]);
      const sSteps = [...styleRoot.matchAll(/--s-(\d+):\s*([^;]+);/g)].map((m) => [`--s-${m[1]}`, m[2].trim()]);
      t.diagnostic(`type steps: ${tSteps.map((s) => s[0]).join(', ')} (${tSteps.length}); space steps: ${sSteps.map((s) => s.join(' ')).join(', ')} (${sSteps.length})`);
      assert.deepEqual(tSteps.map((s) => s[0]), ['--t-5', '--t-4', '--t-3', '--t-2', '--t-1', '--t-0', '--t--1', '--t--2'], 'the eight type steps (DESIGN_v2 "Type scale")');
      assert.ok(tSteps.slice(0, 7).every((s) => /^clamp\(/.test(s[1])), 'the seven fluid steps are clamp()');
      assert.equal(tSteps[7][1], '.875rem', '--t--2 is the fixed 14px caps size');
      assert.match(styleRoot, /--caps-tracking:\.16em/, 'caps tracking +0.16em');
      assert.deepEqual(sSteps, [['--s-1', '4px'], ['--s-2', '8px'], ['--s-3', '12px'], ['--s-4', '16px'], ['--s-5', '24px'], ['--s-6', '32px'], ['--s-7', '48px'], ['--s-8', '64px'], ['--s-9', '96px'], ['--s-10', '128px']], 'the ten space steps 4 8 12 16 24 32 48 64 96 128');
      for (const token of ['--sec-y:clamp(64px,', '--sec-x:clamp(24px,', '--r-card:26px', '--r-chip:18px', '--r-pill:999px', '--ease:cubic-bezier(.2,.7,.2,1)', '--dur-feedback:240ms', '--stagger:80ms', '--gold-ink:#7d6236', '--gold-bright:#c9a86a', '--line-dark:rgba(244,239,229,.2)']) assert.ok(styleRoot.includes(token), `${token} in style.css :root`);
      const durHero = Number((styleRoot.match(/--dur-hero:(\d+)ms/) || [])[1]);
      assert.ok(durHero >= 600 && durHero <= 900, `--dur-hero is 600–900ms (${durHero})`);
      assert.match(styleRoot, /--font-display:"Canela","Instrument Serif",Georgia,serif/, 'the display stack: Canela, the Instrument fallback for the glyphs the trial lacks');
      assert.match(styleRoot, /--font-sans:"GT America","Instrument Sans",-apple-system,"Helvetica Neue",sans-serif/, 'the sans stack');
      assert.match(styleRoot, /--serif:var\(--font-display\);\s*--sans:var\(--font-sans\)/, 'the old names alias the v2 stacks');
      assert.doesNotMatch(styleRoot, /Courtside Serif Fallback|Times New Roman|\bInter\b/, 'the polish-pass Georgia stack and the Inter sans are gone');
      // marketing.css :root keeps only page-specific tokens: the /pros and gate titles, the old fluid space scale the
      // other public pages were built on, the header metrics and the cream-78 body colour on espresso.
      const marketingTokens = [...root.matchAll(/--([a-z0-9-]+):/g)].map((m) => `--${m[1]}`);
      t.diagnostic(`marketing.css :root tokens: ${marketingTokens.join(', ')}`);
      assert.deepEqual(marketingTokens, ['--t-pros', '--t-gate', '--s-3xs', '--s-2xs', '--s-xs', '--s-s', '--s-m', '--s-l', '--s-xl', '--s-2xl', '--s-3xl', '--s-4xl', '--header-h', '--header-x', '--gutter', '--cream-78']);
      assert.ok(marketingTokens.every((tok) => !/^--(t--?\d+|s-\d+)$/.test(tok) && !/^--(r-|dur-|ease|gold|stagger|sec-|line|font-|cream$|paper$|espresso$)/.test(tok)), 'no system token is redeclared in marketing.css');
      // Font sizes outside the token block: the hero h1 is its own clamp (60px on phones to 92px at 1440, s01); everything
      // else is a --t-* token or one of the mockups' literal pixel sizes (11px photo credit to 92px), the mockups' CSS
      // being the spec; the monogram letters at 700px+ stay the 5rem ornament (QA_REPORT_POLISH.md item 8).
      const outside = css.replace(/:root\s*\{[^}]*\}/g, '');
      const bare = [
        ...[...outside.matchAll(/([^{}]*)\{[^}]*?font-size:\s*([^;}]+)/g)].map((m) => ({ sel: m[1].trim().split('\n').pop().trim(), prop: 'font-size', value: m[2].trim() })),
        ...[...outside.matchAll(/([^{}]*)\{[^}]*?\bfont:\s*([^;}]+)/g)].map((m) => ({ sel: m[1].trim().split('\n').pop().trim(), prop: 'font', value: m[2].trim() })),
      ].filter((b) => !/var\(--t/.test(b.value));
      t.diagnostic(`bare font sizes outside the token block: ${bare.map((b) => `${b.sel} → ${b.prop}:${b.value}`).join(' | ') || 'none'}`);
      const h1 = bare.find((b) => b.sel === '.hero-copy h1');
      assert.match(h1?.value || '', /clamp\(60px,[^)]*,\s*92px\)/, 'the hero h1 is clamp(60px … 92px), not --t-5');
      const px = (v) => { const m = v.match(/(?:^|\s)(\d+(?:\.\d+)?)px(?=\/|\s|$)/); return m ? Number(m[1]) : null; };
      const odd = bare.filter((b) => b !== h1 && !(/^5rem$/.test(b.value) && /monogram/.test(b.sel))).filter((b) => { const n = px(b.value); return n === null || !Number.isInteger(n) || n < 11 || n > 92; });
      assert.deepEqual(odd, [], 'every other bare size is a whole pixel value between 11px and 92px (the mockups\' range) or the 5rem monogram');
      // Every space value in marketing.css is a token: no bare px/rem padding or margin except 0, 1px hairlines and the few documented offsets.
      const spacing = [...outside.matchAll(/(?:^|[;{])\s*(padding|margin)(?:-(?:top|bottom|left|right))?:\s*([^;}]+)/g)].map((m) => m[2].trim()).filter((v) => /\d(px|rem|em)/.test(v) && !/var\(--s/.test(v));
      t.diagnostic(`bare spacing values: ${[...new Set(spacing)].join(' | ') || 'none'}`);
    });

    test('computed sizes: body 17px at 390 and 18px at 1440; hero H1 60px and 92px (±2); section h2 40px and 80px; the eyebrow 14px caps, gold-ink on light and gold-bright on the espresso band; paragraph measure ≤ 62ch', async (t) => {
      const results = {};
      for (const viewport of [MOBILE, DESKTOP]) {
        const page = await open({ viewport });
        await page.goto('/');
        await settled(page);
        const m = await page.evaluate(() => {
          const px = (el, prop = 'fontSize') => parseFloat(getComputedStyle(el)[prop]);
          // 1ch as the browser resolves it for this element's font (a probe sized 1ch), so kerning plays no part.
          const chOf = (el) => { const probe = document.createElement('span'); probe.style.cssText = 'position:absolute;visibility:hidden;display:block;width:1ch;height:1px'; el.appendChild(probe); const w = probe.getBoundingClientRect().width; probe.remove(); return w; };
          const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('.waitlist-capture, .sticky-cta');
          const paras = [...document.querySelectorAll('p')].filter((p) => visible(p) && p.textContent.trim().length > 40).map((p) => ({ sel: `${p.closest('section')?.id || (p.closest('footer') ? 'footer' : p.closest('section')?.className || p.tagName)} p.${p.className}`, ch: +(p.getBoundingClientRect().width / chOf(p)).toFixed(1), maxWidth: getComputedStyle(p).maxWidth }));
          const widest = paras.sort((a, b) => b.ch - a.ch).slice(0, 4);
          const eyebrow = (el) => { const s = getComputedStyle(el); return { section: el.closest('section')?.id || el.closest('section')?.className, size: parseFloat(s.fontSize), weight: s.fontWeight, tracking: s.letterSpacing, transform: s.textTransform, color: s.color, family: s.fontFamily, gap: Math.round(el.nextElementSibling.getBoundingClientRect().top - el.getBoundingClientRect().bottom) }; };
          return {
            body: px(document.body), bodyFamily: getComputedStyle(document.body).fontFamily, h1: px(document.querySelector('.hero h1')), h2: px(document.querySelector('#about h2')), seasonH2: px(document.querySelector('#season h2')), intro: px(document.querySelector('.hero .intro')),
            eyebrows: [...document.querySelectorAll('.eyebrow')].map(eyebrow), t5: getComputedStyle(document.documentElement).getPropertyValue('--t-5').trim(), widest,
          };
        });
        results[viewport.width] = m;
        t.diagnostic(`${viewport.width}px: body ${m.body}px, hero h1 ${m.h1}px, s02 h2 ${m.h2}px, s05 h2 ${m.seasonH2}px, intro ${m.intro}px; eyebrows ${m.eyebrows.map((e) => `${e.section} ${e.size}px/${e.weight} gap ${e.gap}px ${e.color}`).join('; ')}; widest paragraphs ${m.widest.map((w) => `${w.sel} ${w.ch}ch (max-width ${w.maxWidth})`).join('; ')}`);
        assert.ok(m.widest.every((w) => w.ch <= 62.5), `paragraph measure ≤ 62ch (${m.widest[0].sel} is ${m.widest[0].ch}ch)`);
        assert.match(m.bodyFamily, /^"GT America"/, 'GT America on the body');
        // Step 2: one eyebrow style everywhere: 500 14px GT America, +0.16em, caps, gold-ink (gold-bright on the espresso band), 24px (--s-5) above the title.
        assert.equal(m.eyebrows.length, 6, 'six eyebrows: s02, s04, s05, s06, s07, s08');
        const offStyle = m.eyebrows.filter((e) => !(e.size === 14 && e.weight === '500' && e.tracking === '2.24px' && e.transform === 'uppercase' && /^"GT America"/.test(e.family) && e.gap === 24));
        assert.deepEqual(offStyle.map((e) => `${e.section}: ${e.size}px/${e.weight}, gap ${e.gap}px`), [], `${viewport.width}px: every eyebrow is 500 14px GT America caps with 24px to its title`);
        assert.deepEqual(m.eyebrows.map((e) => e.color), m.eyebrows.map((e) => (e.section === 'how' ? GOLD_BRIGHT : GOLD_INK)), 'gold-ink on cream and paper, gold-bright on the espresso band');
        await page.close2();
      }
      assert.ok(Math.abs(results[390].body - 17) <= 0.5, `body at 390 is 17px (${results[390].body})`);
      assert.ok(Math.abs(results[1440].body - 18) <= 0.5, `body at 1440 is 18px (${results[1440].body})`);
      // s01: the hero h1 is clamp(60px … 92px) over 390 → 1440px (CLAUDE_BUILD_PROMPT.md: 92px, 60px on mobile), not --t-5.
      assert.ok(Math.abs(results[390].h1 - 60) <= 2, `hero H1 at 390 is 60px ±2 (${results[390].h1})`);
      assert.ok(Math.abs(results[1440].h1 - 92) <= 2, `hero H1 at 1440 is 92px ±2 (measured ${results[1440].h1}px)`);
      // Section titles are --t-4: 40 → 80px.
      for (const key of ['h2', 'seasonH2']) {
        assert.ok(Math.abs(results[390][key] - 40) <= 1, `section h2 at 390 is 40px (${results[390][key]})`);
        assert.ok(Math.abs(results[1440][key] - 80) <= 1, `section h2 at 1440 is 80px (${results[1440][key]})`);
      }
      assert.ok(Math.abs(results[1440].intro - 22) <= 0.5 && Math.abs(results[390].intro - 19) <= 0.5, `the hero intro is 22px at 1440 and 19px on phones (${results[1440].intro} / ${results[390].intro})`);
    });
  });

  describe('9. contrast', () => {
    test('axe-core on /, /pros, /invite, /privacy and the 404 at 390 and 1440: zero serious or critical violations, color-contrast included; the eyebrow is #7d6236 on cream', { skip: axePath ? false : 'axe-core is not installed' }, async (t) => {
      const serious = [];
      const other = [];
      for (const route of PUBLIC_PAGES) {
        for (const viewport of [MOBILE, DESKTOP]) {
          const page = await open({ viewport });
          await page.goto(route);
          await loadWholePage(page); // waits for the hero settle, so nothing is measured mid-fade
          await page.addScriptTag({ path: axePath });
          const results = await page.evaluate(() => window.axe.run(document, { resultTypes: ['violations'] }));
          for (const v of results.violations) {
            const nodes = v.nodes.map((n) => { const d = n.any[0]?.data || {}; return `${n.target.join(' ')}${d.contrastRatio ? ` ${d.fgColor} on ${d.bgColor} ${d.contrastRatio}:1 (${d.fontSize} ${d.fontWeight}, needs ${d.expectedContrastRatio})` : ''}`; });
            const line = `${route} @${viewport.width}: [${v.impact}] ${v.id} ×${v.nodes.length}: ${nodes.join(' | ')}`;
            t.diagnostic(line);
            (v.impact === 'serious' || v.impact === 'critical' ? serious : other).push(line);
          }
          if (!results.violations.length) t.diagnostic(`${route} @${viewport.width}: axe ${results.testEngine.version}: no violations`);
          await page.close2();
        }
      }
      const page = await open({ viewport: DESKTOP });
      await page.goto('/');
      const eyebrow = await page.evaluate(() => { const el = document.querySelector('#about .eyebrow'); return { color: getComputedStyle(el).color, bg: getComputedStyle(el.closest('section')).backgroundColor, size: getComputedStyle(el).fontSize, weight: getComputedStyle(el).fontWeight }; });
      t.diagnostic(`#about .eyebrow: ${JSON.stringify(eyebrow)}`);
      assert.equal(eyebrow.color, 'rgb(125, 98, 54)', 'eyebrow text is --gold-ink #7d6236');
      await page.close2();
      t.diagnostic(`moderate/minor: ${other.length ? other.join(' || ') : 'none'}`);
      // --gold-ink #7d6236 on #f4efe5 is 4.99:1 (5.40:1 on paper); the earlier #8a6d3c measured 4.23:1 and failed.
      assert.deepEqual(serious, [], 'no serious or critical axe violation on any public page');
    });
  });

  describe('10. keyboard and focus', () => {
    test('skip link first on every shell page (the gate has none: its input is the third Tab stop); the 404 has a focusable way back', async (t) => {
      for (const route of SHELL_PAGES) {
        const page = await open();
        await page.goto(route);
        await page.keyboard.press('Tab');
        const first = await activeInfo(page);
        assert.deepEqual([first.cls, first.href], ['skip-link', '#main'], `${route}: the skip link is the first Tab stop`);
        assert.ok(await page.evaluate(() => document.activeElement.getBoundingClientRect().top >= 0), `${route}: the skip link is visible while focused`);
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => location.hash === '#main');
        assert.equal((await activeInfo(page)).id, 'main', `${route}: focus moves to <main>`);
        if (route === '/nope') {
          await page.keyboard.press('Tab');
          const back = await activeInfo(page);
          assert.deepEqual([back.cls, back.href, back.text], ['primary', '/', 'Back to Courtside'], 'the first Tab inside the 404 is the way back');
          assert.ok(await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0; }), 'with a ring');
        }
        await page.close2();
      }
      const gate = await open();
      await gate.goto('/invite');
      const stops = [];
      for (let i = 0; i < 3; i += 1) { await gate.keyboard.press('Tab'); stops.push(await activeInfo(gate)); }
      t.diagnostic(`/invite first Tab stops: ${stops.map((s) => `${s.tag}#${s.id}.${s.cls}`).join(' → ')} (no skip link on the gate; the gate shell has no header to skip)`);
      assert.equal(gate.locator ? await gate.locator('.skip-link').count() : 0, 0);
      assert.ok(stops.some((s) => s.id === 'inviteCode'), 'the code field is reached within three Tabs');
      await gate.close2();
    });

    test('every link, button and input draws a :focus-visible ring, gold-ink on light and gold-bright on dark; the teaser cards carry the ring on the card frame; Tab is never stuck; Escape closes the capture', async (t) => {
      for (const route of PUBLIC_PAGES) {
        const page = await open({ viewport: DESKTOP });
        await page.goto(route);
        await settled(page);
        const { steps, left } = await tabWalk(page);
        t.diagnostic(`${route}: ${steps.length} Tab stops, focus left the document: ${left}; rings on a frame: ${steps.filter((s) => s.ringOnFrame).map((s) => `${s.tag} "${s.text}"`).join(', ') || 'none'}; ring colours ${[...new Set(steps.map((s) => `${s.dark ? 'dark' : 'light'} ${s.ringColor}`))].join(', ')}`);
        assert.ok(left, `${route}: Tab leaves the document (never stuck)`);
        assert.ok(steps.length >= 3, `${route}: controls were walked (the gate has three: the way back, the code field, Enter)`);
        for (let i = 1; i < steps.length; i += 1) assert.notDeepEqual(steps[i], steps[i - 1], `${route}: no control is focused twice in a row`);
        assert.deepEqual(steps.filter((s) => !s.ring).map((s) => `${s.tag}|${s.href}|${s.text}`), [], `${route}: a ring on every stop`);
        assert.ok(steps.every((s) => s.focusVisible), `${route}: :focus-visible matched on every stop`);
        assert.deepEqual(steps.filter((s) => s.ringColor !== (s.dark ? GOLD_BRIGHT : GOLD_INK)).map((s) => `${s.tag}|${s.href}|${s.text} ${s.ringColor}`), [], `${route}: gold-ink rings on cream and paper, gold-bright on espresso (DESIGN_v2 "Focus")`);
        if (route === '/') {
          assert.equal(steps.filter((s) => s.text === 'Enter with your invitation').length, 0, 'the featured panel\'s button is gone (the hero and the pill own the ask)');
          const prosCards = steps.filter((s) => s.cls === 'pro-link');
          assert.equal(prosCards.length, 3);
          assert.ok(prosCards.every((s) => s.ringOnFrame), 'the teaser cards carry the ring on the card');
          // Open a capture by keyboard and walk its controls.
          await page.evaluate(() => { window.scrollTo({ top: 0, behavior: 'instant' }); document.activeElement.blur(); });
          let info = null;
          for (let i = 0; i < 60; i += 1) { await page.keyboard.press('Tab'); info = await activeInfo(page); if (info && info.cls.includes('waitlist-open')) break; }
          await page.keyboard.press('Enter');
          const inner = [];
          for (let i = 0; i < 5; i += 1) {
            inner.push(await page.evaluate(() => { const el = document.activeElement; const s = getComputedStyle(el); return { tag: el.tagName.toLowerCase(), type: el.type || null, id: el.id, href: el.getAttribute('href'), ring: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0, fv: el.matches(':focus-visible') }; }));
            await page.keyboard.press('Tab');
          }
          t.diagnostic(`capture controls: ${inner.map((c) => `${c.tag}${c.type ? `[${c.type}]` : ''}#${c.id}${c.href || ''} ring=${c.ring}`).join(' → ')}`);
          assert.deepEqual(inner.map((c) => [c.tag, c.type || c.href]), [['input', 'email'], ['input', 'text'], ['input', 'checkbox'], ['a', '/privacy'], ['button', 'submit']], 'email → name → consent → privacy link → Join');
          assert.ok(inner.every((c) => c.ring && c.fv), 'each capture control draws a ring');
          await page.keyboard.press('Shift+Tab');
          await page.keyboard.press('Shift+Tab');
          await page.keyboard.press('Escape');
          assert.equal((await activeInfo(page)).cls, 'secondary waitlist-open', 'Escape from inside the form closes it and returns focus');
          assert.equal(await attr(page, '#waitlist button.waitlist-open', 'aria-expanded'), 'false');
        }
        assert.deepEqual(page.errors(), []);
        await page.close2();
      }
    });
  });

  describe('11. hover', () => {
    const TREATMENTS = [
      // selector, what changes on hover, the expected end state (DESIGN_v2 "Buttons": hover goes to brown / fills with paper; nothing translates).
      { sel: '.hero-ctas a.btn', role: 'primary button', check: (b, a) => b.backgroundColor === ESPRESSO && a.backgroundColor === BROWN && a.transform === 'none' && a.after === 'none' },
      { sel: '#about .ask a.btn', role: 'primary button (s02)', check: (b, a) => b.backgroundColor === ESPRESSO && a.backgroundColor === BROWN && a.transform === 'none' && a.after === 'none' },
      { sel: '#pros .section-cta a.secondary', role: 'secondary button', check: (b, a) => b.backgroundColor === 'rgba(0, 0, 0, 0)' && a.backgroundColor === PAPER && a.color === ESPRESSO && a.transform === 'none' },
      { sel: '.site-header .invite-pill', role: 'header pill', check: (b, a) => b.backgroundColor === 'rgba(0, 0, 0, 0)' && a.backgroundColor === ESPRESSO && a.color === CREAM && a.transform === 'none' },
      { sel: '.site-nav a[href="#trips"]', role: 'nav link underline', check: (b, a) => /^0px/.test(b.backgroundSize) && (/^100%/.test(a.backgroundSize) || parseFloat(a.backgroundSize) >= a.width - 1) },
      // DESIGN_v2 "Text link": always underlined; hover darkens the text to espresso and the underline to gold-ink.
      { sel: '.hero-ctas a.no-code', role: 'quiet link', check: (b, a) => b.textDecorationLine === 'underline' && b.color === BROWN && a.textDecorationLine === 'underline' && a.color === ESPRESSO && a.textDecorationColor === GOLD_INK },
      { sel: '#pros .pro-card:nth-child(1)', role: 'card lift', check: (b, a) => b.transform === 'none' && a.transform === 'matrix(1, 0, 0, 1, 0, -4)' && a.boxShadow !== 'none' },
      // The logo keeps its hover scale; DESIGN_v2 says nothing about it and marketing.css draws no :focus-visible twin (reported, not failed).
      { sel: '.site-header > a[aria-label]', role: 'logo scale', check: (b, a) => b.transform === 'none' && a.transform === 'matrix(1.03, 0, 0, 1.03, 0, 0)', focusTwin: false },
    ];
    const styles = (page, sel) => page.locator(sel).first().evaluate((el) => { const s = getComputedStyle(el); const after = getComputedStyle(el, '::after'); return { backgroundColor: s.backgroundColor, color: s.color, transform: s.transform, boxShadow: s.boxShadow, backgroundSize: s.backgroundSize, textDecorationLine: s.textDecorationLine, textDecorationColor: s.textDecorationColor, width: el.getBoundingClientRect().width, after: after.transform, focusVisible: el.matches(':focus-visible') }; });

    test('primary buttons flood brown, the secondary floods paper, the pill fills espresso, nav links draw the underline, the quiet link darkens, cards lift, the logo scales; nothing translates; the same end state on :focus-visible', async (t) => {
      const page = await open({ viewport: DESKTOP });
      await page.goto('/');
      await settled(page);
      assert.ok(await page.evaluate(() => matchMedia('(hover: hover)').matches), 'the test context reports a hovering pointer');
      const resting = {};
      for (const { sel, role, check } of TREATMENTS) {
        await page.mouse.move(5, 500);
        await page.waitForTimeout(350);
        const before = await styles(page, sel);
        resting[sel] = before;
        await page.locator(sel).first().hover();
        await page.waitForTimeout(600);
        const after = await styles(page, sel);
        t.diagnostic(`${role} ${sel}: before ${JSON.stringify({ bg: before.backgroundColor, color: before.color, tf: before.transform, bs: before.backgroundSize, tdc: before.textDecorationColor })} → hover ${JSON.stringify({ bg: after.backgroundColor, color: after.color, tf: after.transform, after: after.after, bs: after.backgroundSize, tdc: after.textDecorationColor, shadow: after.boxShadow.slice(0, 40) })}`);
        assert.ok(check(before, after), `${role} (${sel}) changes on hover as designed`);
      }
      await page.mouse.move(5, 500);
      await page.waitForTimeout(350);
      // Keyboard: the same end state when the control is :focus-visible (the card and logo via their links).
      await page.keyboard.press('Tab');
      for (const { sel, role, check, focusTwin = true } of TREATMENTS) {
        const target = sel.includes('.pro-card') ? `${sel} .pro-link` : sel;
        await page.locator(target).first().focus();
        await page.waitForTimeout(500);
        const focused = await styles(page, sel);
        const fv = await page.locator(target).first().evaluate((el) => el.matches(':focus-visible'));
        t.diagnostic(`${role} focus-visible=${fv}: ${JSON.stringify({ bg: focused.backgroundColor, color: focused.color, tf: focused.transform, after: focused.after, bs: focused.backgroundSize, tdc: focused.textDecorationColor })}${focusTwin ? '' : ' (hover only by design; no focus twin expected)'}`);
        assert.ok(fv, `${role}: :focus-visible matched`);
        if (focusTwin) assert.ok(check(resting[sel], focused), `${role}: the hover end state appears on :focus-visible`);
        await page.locator(target).first().blur();
        await page.waitForTimeout(350);
      }
      assert.deepEqual(page.errors(), []);
      await page.close2();
    });

    test('the moving hover treatments live inside @media (hover: hover); colour-only hovers outside it are listed', (t) => {
      const rules = cssRules(read('public/marketing.css'));
      const hovers = rules.filter((r) => /:hover/.test(r.selector));
      const inside = hovers.filter((r) => r.stack.some((a) => /@media\s*\(hover:\s*hover\)/.test(a)));
      const outside = hovers.filter((r) => !r.stack.some((a) => /@media\s*\(hover:\s*hover\)/.test(a)));
      t.diagnostic(`hover rules: ${hovers.length}; inside @media (hover:hover): ${inside.length}; outside: ${outside.map((r) => `${r.selector} {${r.body}}`).join(' | ') || 'none'}`);
      const moving = outside.filter((r) => /transform|box-shadow/.test(r.body || '') && !/transition:none|transform:none/.test(r.body || ''));
      assert.deepEqual(moving.map((r) => r.selector), [], 'no hover rule that moves a control sits outside @media (hover: hover)');
      const floods = outside.filter((r) => /(^|;)background:/.test(r.body || ''));
      t.diagnostic(`colour floods outside the media block (sticky on touch): ${floods.map((r) => r.selector).join(' | ') || 'none'}`);
      for (const need of ['.btn:hover', '.primary:hover', '.secondary:hover', '.site-header .invite-pill:hover', '.site-nav a:hover', '.quiet:hover', '.pro-card:hover', '.site-header>a[aria-label]:hover']) {
        assert.ok(inside.some((r) => r.selector.replace(/\s+/g, '').includes(need.replace(/\s+/g, ''))), `${need} is inside @media (hover: hover)`);
      }
      assert.ok(outside.every((r) => /color|text-decoration|background-size|background:|transform:none|transition:none/.test(r.body || '')), 'every hover rule outside the media block is colour, underline or a reduced-motion reset');
      // Redesign v2: no hover translates a button (the lift is the pro card's alone); the pressed primary shifts 1px (DESIGN_v2 "Buttons").
      const translating = hovers.filter((r) => /translateY/.test(r.body || '')).map((r) => r.selector);
      assert.deepEqual(translating, ['.pro-card:hover', '.trip-card:hover'], 'translateY on hover: the card lifts only (.trip-card is the /pros profile card)');
      assert.ok(rules.some((r) => /\.btn:active,\.primary:active/.test(r.selector.replace(/\s+/g, '')) && /translateY\(1px\)/.test(r.body || '')), 'pressed primary shifts down 1px');
    });
  });

  describe('12. motion', () => {
    test('the hero copy rises once on load (ct-rise, 600–900ms, 80ms stagger); under reduced motion nothing on any public page carries a transition or an animation, the hero is visible, the anchor is instant and the sticky bar has no transition; every transition in marketing.css sits inside prefers-reduced-motion: no-preference', async (t) => {
      const page = await open({ viewport: DESKTOP });
      await page.goto('/');
      const early = await page.evaluate(() => document.getAnimations().map((a) => ({ state: a.playState, name: a.animationName, target: a.effect.target.className || a.effect.target.tagName, pseudo: a.effect.pseudoElement || null, inHero: !!a.effect.target.closest('.home-hero'), duration: a.effect.getTiming().duration, delay: a.effect.getTiming().delay, fill: a.effect.getTiming().fill })));
      t.diagnostic(`on load: ${early.length} animations: ${early.map((a) => `${a.target}${a.pseudo || ''} ${a.name} ${a.state} ${a.duration}ms+${a.delay}`).join('; ')}`);
      assert.ok(early.length > 0, 'the hero settle is running');
      assert.ok(early.every((a) => a.inHero), 'every animation belongs to the hero');
      assert.ok(early.every((a) => a.name === 'ct-rise' && a.fill === 'both' && a.duration <= 900 && a.duration >= 600), 'ct-rise keyframes, 600–900ms, fill both');
      assert.deepEqual(early.filter((a) => a.target !== 'hero-label').map((a) => a.delay), [0, 80, 160, 240], 'the four copy blocks rise 80ms apart (--stagger)');
      await settled(page);
      await page.waitForTimeout(800);
      const late = await page.evaluate(() => ({ animations: document.getAnimations().map((a) => a.playState), copy: [...document.querySelectorAll('.hero-copy > *')].map((el) => getComputedStyle(el).opacity), img: getComputedStyle(document.querySelector('.hero-image img')).opacity, shade: getComputedStyle(document.querySelector('.hero-image'), '::after').content }));
      t.diagnostic(`after settle: ${JSON.stringify(late)}`);
      assert.ok(late.animations.every((s) => s === 'finished'), 'every hero animation finished and none restarted');
      assert.deepEqual(late.copy, ['1', '1', '1', '1'], 'the hero copy is at opacity 1');
      assert.equal(late.img, '1');
      assert.equal(late.shade, 'none', 'no gradient shade over the hero photo (redesign v2)');
      assert.deepEqual(page.errors(), []);
      await page.close2();

      const reduced = await open({ viewport: MOBILE, reducedMotion: 'reduce' });
      await reduced.goto('/');
      const r = await reduced.evaluate(() => ({ animations: document.getAnimations().length, copy: [...document.querySelectorAll('.hero-copy > *')].map((el) => getComputedStyle(el).opacity), img: getComputedStyle(document.querySelector('.hero-image img')).opacity, scroll: getComputedStyle(document.documentElement).scrollBehavior, barTransition: getComputedStyle(document.querySelector('.sticky-cta')).transitionDuration, vt: typeof document.startViewTransition }));
      t.diagnostic(`reduced motion: ${JSON.stringify(r)}`);
      assert.equal(r.animations, 0, 'zero animations under reduced motion');
      assert.deepEqual(r.copy, ['1', '1', '1', '1'], 'the hero is fully visible');
      assert.equal(r.img, '1');
      assert.equal(r.scroll, 'auto');
      assert.match(r.barTransition, /^0s(, 0s)?$/, 'the sticky bar has no transition');
      await reduced.click('.hero-ctas a.no-code');
      const landed = await reduced.evaluate(() => { const el = document.getElementById('waitlist'); return { hash: location.hash, top: Math.round(el.getBoundingClientRect().top), margin: parseFloat(getComputedStyle(el).scrollMarginTop), open: document.getElementById('waitlist-general').classList.contains('is-open') }; });
      assert.equal(landed.hash, '#waitlist');
      assert.ok(Math.abs(landed.top - landed.margin) < 4, `#waitlist lands instantly (${landed.top}px vs scroll-margin ${landed.margin}px)`);
      assert.equal(landed.open, true, 'the form is open on arrival');
      await reduced.evaluate(() => window.scrollTo({ top: document.querySelector('.home-hero').getBoundingClientRect().bottom + window.scrollY + 120, behavior: 'instant' }));
      await reduced.waitForFunction(() => document.querySelector('.sticky-cta').classList.contains('is-on'));
      const bar = await reduced.evaluate(() => { const s = getComputedStyle(document.querySelector('.sticky-cta')); return { visibility: s.visibility, transform: s.transform, transition: s.transitionDuration }; });
      assert.deepEqual(bar, { visibility: 'visible', transform: 'none', transition: bar.transition }, 'the bar appears at once');
      assert.match(bar.transition, /^0s(, 0s)?$/);
      assert.equal(await reduced.evaluate(() => document.getAnimations().length), 0);
      assert.deepEqual(reduced.errors(), []);
      await reduced.close2();

      // Step 4 checklist: prefers-reduced-motion: reduce disables transitions and animations. On every public page, no
      // element computes a transition-duration above 0 or an animation-name (the sticky bar and the open capture included).
      for (const route of PUBLIC_PAGES) {
        const quiet = await open({ viewport: MOBILE, reducedMotion: 'reduce' });
        await quiet.goto(route);
        await quiet.waitForLoadState('networkidle');
        const moving = await quiet.evaluate(() => [...document.querySelectorAll('body, body *')].filter((el) => { const s = getComputedStyle(el); return s.transitionDuration.split(',').some((d) => parseFloat(d) > 0) || s.animationName !== 'none'; }).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/).join('.')}`));
        t.diagnostic(`${route} under reduce: ${moving.length ? moving.join(', ') : 'nothing moves'}`);
        assert.deepEqual(moving, [], `${route}: nothing has a transition or an animation under reduced motion`);
        await quiet.close2();
      }
      const rules = cssRules(read('public/marketing.css'));
      const motion = rules.filter((r) => /(^|;)\s*(transition|animation)(-[a-z]+)?\s*:/.test(r.body || '') && !/transition\s*:\s*none/.test(r.body || ''));
      const outsideMotion = motion.filter((r) => !r.stack.some((a) => /prefers-reduced-motion\s*:\s*no-preference/.test(a)));
      t.diagnostic(`marketing.css motion rules: ${motion.length}, inside no-preference: ${motion.length - outsideMotion.length}`);
      assert.ok(motion.length >= 5, 'the hero rise, the button feedback, the nav underline, the card lift and the sticky bar slide are declared');
      assert.deepEqual(outsideMotion.map((r) => r.selector), [], 'every transition and animation in marketing.css sits inside @media (prefers-reduced-motion: no-preference)');
    });

    test('cross-document navigations / → /pros → / → /invite → /privacy → / log no pageerror and no console error', async (t) => {
      const page = await open({ viewport: DESKTOP });
      await page.goto('/');
      t.diagnostic(`document.startViewTransition: ${await page.evaluate(() => typeof document.startViewTransition)}; @view-transition rule inline in <head>: ${await page.evaluate(() => [...document.querySelectorAll('head style')].some((s) => /@view-transition/.test(s.textContent)))}`);
      await page.click('.site-nav a[href="/pros"]');
      await page.waitForURL(/\/pros$/);
      await page.waitForLoadState('load');
      await page.click('.site-header a[aria-label="Courtside home"]');
      await page.waitForURL(/\/$/);
      await page.waitForLoadState('load');
      await page.click('.site-header .invite-pill');
      await page.waitForURL(/\/invite$/);
      await page.waitForLoadState('load');
      await page.goto('/privacy');
      await page.waitForLoadState('load');
      await page.click('.site-header a[aria-label="Courtside home"]');
      await page.waitForURL(/\/$/);
      await page.waitForLoadState('load');
      await page.waitForTimeout(600);
      t.diagnostic(`console: ${page.consoleMessages().length ? page.consoleMessages().join(' | ') : 'silent'}`);
      assert.deepEqual(page.errors(), [], 'no pageerror, no console.error');
      assert.deepEqual(page.consoleMessages().filter((m) => /^(error|warning):/.test(m)), [], 'no warnings either');
      assert.deepEqual(page.external(), []);
      await page.close2();
    });
  });

  describe('13. 404, metadata, icons', () => {
    test('an unknown path returns 404 with the designed page; every page has canonical, og:*, twitter:card, icons, noindex; /invite has <main>, its own h1 and the lockup with dimensions', async (t) => {
      for (const p of ['/nope', '/nope/deeper', '/404.html', '/pros.html', '/index.html']) {
        const r = await http(srv.base, p);
        assert.equal(r.status, 404, `${p} → 404`);
        assert.match(r.headers.get('content-type') || '', /^text\/html/, `${p} is the HTML page`);
        assert.match(r.text, /<title>Page not found — Courtside Travel Co\.<\/title>/);
        assert.match(r.text, /<html lang="en">/);
        assert.match(r.text, NOINDEX, `${p} noindex`);
      }
      const api = await http(srv.base, '/api/nope');
      assert.deepEqual([api.status, api.json], [404, { ok: false, reason: 'not_found' }], 'API misses stay JSON');
      const nf = await open();
      const res = await nf.goto('/nope');
      assert.equal(res.status(), 404);
      assert.equal(await nf.locator('h1').count(), 1);
      assert.equal(plain(await text(nf, 'h1')), 'That page isn’t on the court.');
      assert.deepEqual(await nf.locator('.not-found .section-ctas a').evaluateAll((els) => els.map((a) => [a.className, a.textContent.trim(), a.getAttribute('href')])), [['primary', 'Back to Courtside', '/'], ['secondary', 'Enter invite code', '/invite']]);
      assert.equal(await nf.title(), 'Page not found — Courtside Travel Co.');
      assert.deepEqual(nf.errors(), []);
      await nf.close2();

      const ogSeen = new Set();
      for (const route of ['/', '/pros', '/invite', '/privacy']) {
        const r = await http(srv.base, route);
        const meta = (prop) => (r.text.match(new RegExp(`<meta content="([^"]*)" property="${prop}"`)) || r.text.match(new RegExp(`<meta content="([^"]*)" name="${prop}"`)) || [])[1];
        const canonical = (r.text.match(/<link href="([^"]+)" rel="canonical"\/>/) || [])[1];
        const head = { canonical, ogTitle: meta('og:title'), ogDesc: meta('og:description'), ogImage: meta('og:image'), ogUrl: meta('og:url'), twitter: meta('twitter:card'), icon: (r.text.match(/<link href="([^"]+)" rel="icon"/) || [])[1], touch: (r.text.match(/<link href="([^"]+)" rel="apple-touch-icon"/) || [])[1], title: (r.text.match(/<title>([^<]*)<\/title>/) || [])[1], desc: meta('description') };
        t.diagnostic(`${route}: ${JSON.stringify(head)}`);
        assert.equal(head.canonical, `https://courtside-ivory.vercel.app${route === '/' ? '/' : route}`, `${route} canonical`);
        assert.equal(head.ogUrl, head.canonical, 'og:url matches the canonical');
        assert.ok(head.ogTitle && head.ogDesc && head.ogDesc.length <= 200, `${route} og:title and og:description`);
        if (route === '/pros') assert.ok(head.desc && head.desc.length <= 160, `/pros meta description under 160 chars (${head.desc?.length}; POLISH_PLAN.md section 7, critic fix 7)`);
        else t.diagnostic(`${route} meta description ${head.desc?.length} chars${head.desc?.length > 160 ? ' (over the 160 convention)' : ''}`);
        assert.ok(head.title && !ogSeen.has(head.title), `${route} unique title`);
        ogSeen.add(head.title);
        assert.match(head.ogImage, /^https:\/\/courtside-ivory\.vercel\.app\/assets\/og\/(home|pros|invite)\.jpg$/, `${route} og:image`);
        const imgPath = head.ogImage.replace('https://courtside-ivory.vercel.app', '');
        assert.equal((await http(srv.base, imgPath)).status, 200, `${imgPath} is served`);
        if (sharp) { const m = await sharp(path.join(ROOT, 'public', imgPath)).metadata(); assert.deepEqual([m.width, m.height], [1200, 630], `${imgPath} is 1200×630`); }
        assert.equal(head.twitter, 'summary_large_image');
        assert.equal(head.icon, '/favicon.svg');
        assert.equal(head.touch, '/assets/icons/apple-touch-icon.png');
        assert.match(r.text, NOINDEX, `${route} noindex`);
      }
      const fav = await http(srv.base, '/favicon.svg');
      assert.equal(fav.status, 200);
      assert.match(fav.headers.get('content-type'), /^image\/svg\+xml/);
      assert.match(fav.text, /<svg/);
      const touch = await http(srv.base, '/assets/icons/apple-touch-icon.png');
      assert.equal(touch.status, 200);
      if (sharp) { const m = await sharp(path.join(ROOT, 'public/assets/icons/apple-touch-icon.png')).metadata(); assert.deepEqual([m.width, m.height], [180, 180], 'apple-touch-icon is 180×180'); }

      const gate = await open();
      await gate.goto('/invite');
      const g = await gate.evaluate(() => ({ main: document.querySelectorAll('main').length, h1: [...document.querySelectorAll('h1')].map((h) => h.textContent), sub: document.querySelector('.gate-sub')?.textContent.trim(), subStyle: getComputedStyle(document.querySelector('.gate-sub')).fontStyle, lockup: (() => { const i = document.querySelector('.gate-top img'); return { w: i.getAttribute('width'), h: i.getAttribute('height'), alt: i.alt }; })(), form: !!document.getElementById('inviteForm'), gateInsideMain: !!document.querySelector('main #gate'), footer: document.querySelector('.gate-footer').textContent }));
      t.diagnostic(`/invite: ${JSON.stringify(g)}`);
      assert.equal(g.main, 1, '/invite has one <main>');
      assert.ok(g.gateInsideMain, 'the gate sits inside <main>');
      assert.deepEqual(g.h1.map(plain), ['Enter your invitation.'], 'its own h1 (decision 6)');
      assert.equal(g.sub, 'tennis takes you further.');
      assert.equal(g.subStyle, 'italic', 'the brand line as the italic sub');
      assert.deepEqual([g.lockup.w, g.lockup.h, g.lockup.alt], ['640', '258', 'Courtside Travel Co.'], 'the lockup has width and height');
      assert.ok(g.form, 'the gate form is unchanged');
      assert.equal(plain(g.footer), 'Courtside Travel Co. · Founding Season 2027');
      await gate.close2();
    });
  });

  describe('14. brand diff', () => {
    test('gate.js unchanged versus main; style.css changed on purpose (the v2 fonts, tokens, radii, no glass) and keeps every rule main had; site.html +1 <style> line; site.js only the three redirects; no hex in marketing.css outside :root that style.css lacks; the seven self-hosted @font-face rules with the TRIAL FONTS warning, no Google Fonts, no @import; only radii 26 / 18 / 999 / 0; no backdrop-filter anywhere', (t) => {
      let hasMain = true;
      try { execFileSync('git', ['rev-parse', '--verify', 'main'], { cwd: ROOT, stdio: 'pipe' }); } catch { hasMain = false; }
      const marketing = read('public/marketing.css');
      const style = read('public/style.css');
      if (hasMain) {
        assert.equal(execFileSync('git', ['diff', 'main', '--', 'public/js/gate.js'], { cwd: ROOT, encoding: 'utf8' }), '', 'gate.js is byte-identical to main');
        const styleDiff = execFileSync('git', ['diff', 'main', '--', 'public/style.css'], { cwd: ROOT, encoding: 'utf8' });
        const added = styleDiff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
        const removed = styleDiff.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));
        t.diagnostic(`style.css vs main: +${added.length} / -${removed.length} lines`);
        assert.ok(added.length > 0, 'style.css changed versus main (redesign v2 step 1: the design system lives here)');
        assert.equal(added.filter((l) => /^\+@font-face\{/.test(l)).length, 7, 'the diff adds the seven @font-face rules');
        assert.ok(removed.some((l) => /--serif: Georgia/.test(l)) && !added.some((l) => /--serif: Georgia/.test(l)), 'the diff removes the Georgia stack');
        assert.ok(removed.some((l) => /backdrop-filter/.test(l)) && !added.some((l) => /backdrop-filter/.test(l)), 'the diff removes the header glass');
        // Every selector main's style.css had is still declared, so the gated /site app keeps its rules (values may change).
        const selectors = (css) => new Set([...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{};]+)\{/g)].map((m) => m[1].trim()).filter((s) => s && !s.startsWith('@')));
        const mainStyle = execFileSync('git', ['show', 'main:public/style.css'], { cwd: ROOT, encoding: 'utf8' });
        const lost = [...selectors(mainStyle)].filter((s) => !selectors(style).has(s));
        t.diagnostic(`selectors from main's style.css missing now: ${lost.join(' | ') || 'none'} (${selectors(mainStyle).size} in main)`);
        assert.deepEqual(lost, [], 'no rule main had was dropped');
        const siteHtml = execFileSync('git', ['diff', 'main', '--', 'public/site.html'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
        assert.deepEqual(siteHtml, ['+<style>@view-transition{navigation:auto}@media (prefers-reduced-motion:reduce){@view-transition{navigation:none}}</style>'], 'site.html: exactly one added line, the view-transition opt-in');
        const siteJs = execFileSync('git', ['diff', 'main', '--', 'public/js/site.js'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
        assert.equal(siteJs.length, 6);
        assert.ok(siteJs.filter((l) => l.startsWith('-')).every((l) => l.includes("location.replace('/')")) && siteJs.filter((l) => l.startsWith('+')).every((l) => l.includes("location.replace('/invite')")), 'site.js: the three redirect targets only');
      } else t.diagnostic('no main branch: git diffs skipped');
      const hex = (css) => [...new Set((css.match(/#[0-9a-fA-F]{3,8}\b/g) || []).map((h) => h.toLowerCase()))];
      const outsideRoot = marketing.replace(/:root\s*\{[^}]*\}/g, '');
      const extra = hex(outsideRoot).filter((h) => !hex(style).includes(h));
      t.diagnostic(`marketing.css hex outside :root: ${hex(outsideRoot).join(', ') || 'none'}; in :root: ${hex(marketing.match(/:root\s*\{[^}]*\}/)[0]).join(', ') || 'none'}`);
      assert.deepEqual(extra, [], 'no hex colour outside :root that style.css does not already declare');
      assert.deepEqual(hex(marketing.match(/:root\s*\{[^}]*\}/)[0]), [], 'the marketing token block declares no colour; --gold-ink and --gold-bright live in style.css :root');
      assert.ok(style.includes('--gold-ink:#7d6236') && style.includes('--gold-bright:#c9a86a'), 'the gold text tokens (DESIGN_v2)');
      // Fonts: the trial faces are self-hosted from /fonts/ and declared once, in style.css; no font service, no @import, no cross-origin <link>.
      for (const file of PUBLIC_FILES) {
        const src = stripComments(read(file));
        assert.doesNotMatch(src, /@import/, `${file}: no @import`);
        assert.doesNotMatch(src, /fonts\.googleapis|fonts\.gstatic|typekit|use\.fontawesome/i, `${file}: no third-party font service`);
        assert.doesNotMatch(src, /<link[^>]+href="https?:\/\/(?!courtside-ivory\.vercel\.app\/)/, `${file}: no cross-origin <link>`);
        if (file !== 'public/style.css') assert.doesNotMatch(src, /@font-face/, `${file}: @font-face lives in style.css only`);
        const fontUrls = [...new Set([...src.matchAll(/[\w./-]+\.(?:woff2?|ttf|otf)\b/g)].map((m) => m[0]))];
        assert.ok(fontUrls.every((u) => u.startsWith('/fonts/') && fs.existsSync(path.join(ROOT, 'public', u))), `${file}: every font URL is same-origin under /fonts/ and the file exists (${fontUrls.join(', ') || 'none'})`);
      }
      const faces = style.match(/@font-face\s*\{[^}]*\}/g) || [];
      assert.deepEqual(faces.map((f) => (f.match(/font-family:"([^"]+)"/) || [])[1]), ['Canela', 'Canela', 'GT America', 'GT America', 'GT America', 'Instrument Serif', 'Instrument Sans'], 'Canela upright + italic, GT America regular + italic + medium, the two Instrument fallbacks');
      assert.ok(faces.every((f) => /font-display:swap/.test(f) && /src:url\(\/fonts\/[\w-]+\.(?:otf|ttf)\)/.test(f)), 'every face swaps and loads from /fonts/');
      assert.ok(faces.slice(0, 5).every((f) => /-Trial\.otf\) format\("opentype"\)/.test(f)), 'the five trial faces are the OTF trial files');
      assert.match(style, /^\/\* ⚠️ TRIAL FONTS — LOCAL PREVIEW ONLY\./, 'the warning comment opens style.css');
      assert.match(style, /TODO before deploy: buy desktop\+web licences/, 'with the licensing TODO');
      assert.ok(fs.existsSync(path.join(ROOT, 'public/fonts/README.md')) && /TRIAL FILES, LOCAL PREVIEW ONLY/.test(read('public/fonts/README.md')), 'public/fonts/README.md carries the same warning');
      // Step 2: only radii 26 / 18 / 999 (0 switches a corner off); no backdrop-filter anywhere under public/.
      const radii = [...new Set([...`${style}\n${marketing}`.matchAll(/border-radius:\s*([^;}]+)/g)].map((m) => m[1].trim()))].sort();
      t.diagnostic(`border-radius values: ${radii.join(', ')}`);
      assert.deepEqual(radii.filter((r) => !/^var\(--r-(card|chip|pill)\)$/.test(r)), ['0', '18px', '26px', '999px'], 'no radius but 26, 18, 999 and 0');
      for (const file of PUBLIC_FILES) assert.doesNotMatch(stripComments(read(file)), /backdrop-filter/, `${file}: no glass`);
    });
  });

  describe('17. page weight', () => {
    for (const route of ['/', '/pros']) {
      test(`${route} at 390: whole page under 1.5 MB (2.25 MB at 3×), first view under 800 KB (1 MB at 3×), no third-party request, no render-blocking script; the hero image's transfer size`, async (t) => {
        for (const dpr of [1, 3]) {
          const page = await open({ viewport: MOBILE, deviceScaleFactor: dpr });
          const transfers = [];
          page.on('requestfinished', async (req) => {
            try {
              const res = await req.response();
              const sizes = await req.sizes().catch(() => null);
              const body = Math.max(sizes?.responseBodySize || 0, Number(res?.headers()['content-length'] || 0));
              transfers.push({ url: req.url().replace(srv.base, ''), type: req.resourceType(), body, headers: sizes?.responseHeadersSize || 0 });
            } catch { /* closed */ }
          });
          await page.goto(route);
          await page.waitForLoadState('networkidle');
          const firstView = transfers.reduce((n, r) => n + r.body + r.headers, 0);
          const firstViewCount = transfers.length;
          await loadWholePage(page);
          const total = transfers.reduce((n, r) => n + r.body + r.headers, 0);
          const firstImage = await page.evaluate(() => new URL(document.querySelector('main img').currentSrc).pathname);
          const hero = transfers.find((r) => r.url === firstImage);
          const scripts = await page.evaluate(() => [...document.scripts].map((s) => ({ src: s.getAttribute('src'), type: s.getAttribute('type'), async: s.async, defer: s.defer, inline: !s.src ? s.textContent.length : 0 })));
          const byType = {};
          for (const r of transfers) byType[r.type] = (byType[r.type] || 0) + r.body;
          t.diagnostic(`${route} @390×${dpr}: ${firstViewCount} requests / ${(firstView / 1024).toFixed(0)} KB first view; ${transfers.length} requests / ${(total / 1024).toFixed(0)} KB whole page (${Object.entries(byType).map(([k, v]) => `${k} ${(v / 1024).toFixed(0)} KB`).join(', ')}); hero/first image ${hero ? `${hero.url.split('/').pop()} ${(hero.body / 1024).toFixed(1)} KB` : `n/a (${firstImage})`}; scripts ${JSON.stringify(scripts)}`);
          assert.deepEqual(page.external(), [], 'no third-party request');
          assert.ok(transfers.every((r) => r.url.startsWith('/')), 'same-origin only');
          assert.ok(scripts.filter((s) => s.src).every((s) => s.type === 'module'), 'external scripts are modules (deferred by definition)');
          assert.ok(scripts.filter((s) => !s.src).every((s) => s.inline < 200), 'the only inline script is the one-line html.js class toggle');
          assert.ok(hero && hero.body > 0, 'the hero image was fetched');
          assert.deepEqual(page.errors(), []);
          // The budgets last, so the checks above run even while the trial OTF fonts (~480 KB, licensed WOFF2 before launch) blow them.
          // Redesign v2 budgets: 474 KB of the first view is the seven trial OTF fonts (licensed WOFF2 will be far smaller);
          // measured 2026-11-01: / 1,208 KB whole, 722 KB first view; /pros 690 KB whole, 667 KB first view.
          const pageBudget = dpr >= 3 ? 2.25 : 1.5; // at 3× the season cards fetch their 1200 variants and the hero its 1400 (measured 1,891 KB)
          assert.ok(total < pageBudget * 1024 * 1024, `${route} @${dpr}×: whole page ${total} B < ${pageBudget} MB`);
          const firstBudget = dpr >= 3 ? 1024 : 800; // KB; at 3× the hero fetches its 1400 variant (measured 847 KB)
          assert.ok(firstView < firstBudget * 1024, `${route} @${dpr}×: first view ${firstView} B < ${firstBudget} KB`);
          await page.close2();
        }
      });
    }
  });
});
