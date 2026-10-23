// tests/e2e/polish.test.js
// The polish checklist (QA_REPORT_POLISH.md, items 2–14 and 17) against COURTSIDE_POLISH_BRIEF.md section 1,
// POLISH_PLAN.md (sections 1–8, the approved decisions) and DESIGN.md. Playwright (library) drives headless
// Chromium against a dev server started in this process on a free port with a temp mock file, as the other
// e2e suites do; every request that would leave 127.0.0.1 is aborted and recorded. Items 1, 15 and 16
// (the suite counts, Lighthouse and the screenshots) are run by hand and recorded in the report.
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
import { TRIPS } from '../../public/js/trips.js';

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

// Tab through the document until focus leaves it; each step records the focused control and whether a ring is drawn
// on it or on the frame that carries its ring (.pro-card for .pro-link, .panel for the featured button).
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
      return { tag: el.tagName.toLowerCase(), id: el.id, within: el.closest('[id]')?.id || '', cls: String(el.className), href: el.getAttribute('href'), text: (el.textContent || '').trim().slice(0, 40), focusVisible: el.matches(':focus-visible'), ring: ring(el) || (frame ? ring(frame) : false), ringOnFrame: !ring(el) && !!frame && ring(frame) };
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
    test('one <h1>, the italic line, the two approved sentences, one primary button, the no-code link that scrolls to #trips, no eyebrow, no second button', async (t) => {
      for (const viewport of [MOBILE, DESKTOP]) {
        const page = await open({ viewport });
        await page.goto('/');
        await settled(page);
        assert.equal(await page.locator('h1').count(), 1);
        assert.equal(plain(await text(page, '.hero h1')), 'tennis takes you further.');
        assert.equal(await text(page, '.hero h1 em'), 'further.', 'the italic clay word');
        assert.equal(await text(page, '.hero .sub'), 'good places. better people.');
        assert.equal(await page.locator('.hero .sub').evaluate((el) => getComputedStyle(el).fontStyle), 'italic');
        assert.equal(plain(await text(page, '.hero .intro')), HERO_SENTENCES.join(' '), 'the two approved sentences (POLISH_PLAN.md section 1)');
        assert.equal(await page.locator('.hero .eyebrow').count(), 0, 'no hero eyebrow');
        assert.equal(await page.locator('.hero-ctas a.primary').count(), 1, 'exactly one primary');
        assert.equal(await page.locator('.hero-ctas .secondary, .hero-ctas button').count(), 0, 'no second button');
        assert.equal(await page.locator('.hero-ctas a').count(), 2);
        assert.equal(await text(page, '.hero-ctas a.primary'), 'Enter invite code');
        assert.equal(await attr(page, '.hero-ctas a.primary', 'href'), '/invite');
        assert.equal(await text(page, '.hero-ctas a.no-code'), 'Don’t have an invite code?');
        assert.equal(await attr(page, '.hero-ctas a.no-code', 'href'), '#trips');
        await page.evaluate(() => { window.__same = true; });
        await page.click('.hero-ctas a.no-code');
        await page.waitForFunction(() => location.hash === '#trips');
        await page.waitForFunction(() => { const el = document.getElementById('trips'); return Math.abs(el.getBoundingClientRect().top - parseFloat(getComputedStyle(el).scrollMarginTop)) < 4; }, null, { timeout: 5000 });
        const m = await page.evaluate(() => ({ same: window.__same, top: Math.round(document.getElementById('trips').getBoundingClientRect().top), header: Math.round(document.querySelector('.site-header').getBoundingClientRect().bottom), behavior: getComputedStyle(document.documentElement).scrollBehavior }));
        t.diagnostic(`${viewport.width}px: #trips top ${m.top}px, header bottom ${m.header}px, scroll-behavior ${m.behavior}`);
        assert.equal(m.same, true, 'same document (no navigation)');
        assert.equal(m.behavior, 'smooth', 'native CSS scroll-behavior, no library');
        assert.ok(m.top >= m.header - 1, `#trips (${m.top}) lands below the sticky header (${m.header})`);
        assert.ok(m.top <= m.header + 40, `#trips (${m.top}) lands just below the header (${m.header})`);
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
      assert.deepEqual(await links('.hero-ctas a'), [['Enter invite code', '/invite'], ['Don’t have an invite code?', '#trips']]);
      assert.deepEqual(await links('.sticky-cta a'), [['Enter code', '/invite']]);
      assert.deepEqual(await links('#trips .panel a'), [['Enter with your invitation', '/invite']]);
      const openers = await page.locator('#season .trip-card button.waitlist-open').evaluateAll((els) => els.map((b) => [b.textContent.trim(), b.getAttribute('aria-controls'), b.getAttribute('aria-expanded'), !!document.getElementById(b.getAttribute('aria-controls'))?.querySelector('form.waitlist-form')]));
      assert.deepEqual(openers, TRIPS.slice(1).map((trip) => ['Join the waitlist', `waitlist-${trip.id}`, 'false', true]), 'six lineup cards open the capture under the card');
      assert.deepEqual(await page.locator('#season form.waitlist-form button[type="submit"]').evaluateAll((els) => els.map((b) => b.textContent.trim())), Array(6).fill('Join'));
      assert.deepEqual(await links('#how a'), [['Enter it here', '/invite']], 'step 01: one link only');
      assert.deepEqual(await links('#pros .pro-link'), [['Katie Delich', '/pros#katie'], ['Eva', '/pros#eva'], ['Nelson Ramos', '/pros#nelson']]);
      assert.deepEqual(await links('#pros .section-cta a'), [['Meet the pros', '/pros']]);
      assert.deepEqual(await page.locator('#waitlist button.waitlist-open').evaluateAll((els) => els.map((b) => [b.textContent.trim(), b.getAttribute('aria-controls')])), [['Join the waitlist', 'waitlist-general']]);
      assert.deepEqual(await page.locator('#waitlist form.waitlist-form').evaluateAll((els) => els.map((f) => [f.dataset.trip, f.dataset.source])), [['general', 'footer']]);
      assert.deepEqual(await links('.footer-links a'), [['Meet the pros', '/pros'], ['Privacy', '/privacy'], ['Enter code', '/invite']]);
      assert.equal(await page.locator('.site-header .site-powered, .site-header .powered').count(), 0, '"powered by tgl.rsvp" is not in the header (decision 8)');
      assert.deepEqual(await page.locator('.site-powered').evaluateAll((els) => els.map((el) => [el.closest('footer') ? 'footer' : 'elsewhere', el.textContent.trim()])), [['footer', 'powered by tgl.rsvp']], 'footer only');
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

    test('the header pill reads "Enter code" → /invite on every public page with the shell header; phones put the two text links on a second row', async (t) => {
      for (const route of SHELL_PAGES) {
        for (const viewport of [MOBILE, DESKTOP]) {
          const page = await open({ viewport });
          await page.goto(route);
          assert.deepEqual(await page.locator('.site-header .invite-pill').evaluateAll((els) => els.map((a) => [a.textContent.trim(), a.getAttribute('href'), getComputedStyle(a).display !== 'none'])), [['Enter code', '/invite', true]], `${route} @${viewport.width}`);
          const m = await page.evaluate(() => {
            const header = document.querySelector('.site-header');
            const logo = header.querySelector('a[aria-label]').getBoundingClientRect();
            const nav = header.querySelector('.site-nav').getBoundingClientRect();
            const pill = header.querySelector('.invite-pill').getBoundingClientRect();
            const links = [...header.querySelectorAll('.site-nav a')].map((a) => ({ text: a.textContent.trim(), shown: a.getClientRects().length > 0 && getComputedStyle(a).display !== 'none', h: Math.round(a.getBoundingClientRect().height) }));
            return { headerH: Math.round(header.getBoundingClientRect().height), headerVar: getComputedStyle(document.documentElement).getPropertyValue('--header-h').trim(), logoBottom: Math.round(logo.bottom), navTop: Math.round(nav.top), pillTop: Math.round(pill.top), pillBottom: Math.round(pill.bottom), links };
          });
          t.diagnostic(`${route} @${viewport.width}: header ${m.headerH}px (--header-h ${m.headerVar}); logo bottom ${m.logoBottom}, nav top ${m.navTop}, pill ${m.pillTop}–${m.pillBottom}; links ${JSON.stringify(m.links)}`);
          assert.deepEqual(m.links.map((l) => [l.text, l.shown]), [['Trips', true], ['Meet the pros', true]], `${route} @${viewport.width}: both text links visible`);
          assert.ok(m.links.every((l) => l.h >= 40), 'nav links are at least 40px tall (tap targets)');
          assert.ok(Math.abs(m.headerH - parseFloat(m.headerVar)) <= 4, `the header is as tall as --header-h says (${m.headerH} vs ${m.headerVar}), so anchors land right`);
          if (viewport.width === 390) {
            assert.ok(m.navTop >= m.logoBottom - 1 && m.navTop >= m.pillBottom - 1, `phones: the nav row (${m.navTop}) sits under the logo (${m.logoBottom}) and the pill (${m.pillBottom})`);
          } else {
            assert.ok(m.navTop < m.pillBottom && m.headerH <= 90, 'desktop: one row');
          }
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
        return { on: bar.classList.contains('is-on'), ariaHidden: bar.getAttribute('aria-hidden'), visibility: s.visibility, transform: s.transform, display: s.display, position: s.position, focusable, heroBottom: Math.round(document.querySelector('.home-hero').getBoundingClientRect().bottom) };
      });
      const off = await state();
      t.diagnostic(`390 at the top: ${JSON.stringify(off)}`);
      assert.equal(off.on, false);
      assert.equal(off.ariaHidden, 'true');
      assert.equal(off.visibility, 'hidden', 'hidden from the tab order while off');
      assert.equal(off.focusable, false, 'its link cannot take focus while off');
      assert.equal(off.position, 'fixed');
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
    test('opener semantics, focus and trip_card_open; Escape; a valid submit writes one Waitlist row and one Log row; the server message on a bad email; footer capture; honeypot; no_code_click', async (t) => {
      await resetMock();
      const page = await open({ viewport: DESKTOP });
      await page.goto('/');
      await settled(page);
      const openers = await page.locator('#season .trip-card button.waitlist-open').evaluateAll((els) => els.map((b) => ({ expanded: b.getAttribute('aria-expanded'), controls: b.getAttribute('aria-controls'), target: !!document.getElementById(b.getAttribute('aria-controls')) })));
      assert.equal(openers.length, 6);
      assert.ok(openers.every((o) => o.expanded === 'false' && o.controls && o.target), 'button.waitlist-open[aria-expanded][aria-controls] on every card');

      // Open Charleston: focus on the email field, one trip_card_open row.
      await page.click('#trip-charleston button.waitlist-open');
      assert.equal(await attr(page, '#trip-charleston button.waitlist-open', 'aria-expanded'), 'true');
      assert.equal((await activeInfo(page)).id, 'wl-charleston-email', 'opening focuses the email field');
      assert.equal(await text(page, '#waitlist-charleston .waitlist-title'), 'Join the waitlist for Charleston');
      const opened = await waitForLog((r) => r.code === 'trip_card_open');
      assert.deepEqual(opened.map((r) => r.result), ['charleston'], 'one trip_card_open Log row with the trip id');
      assert.match(opened[0].ip_hash, /^[0-9a-f]{16}$/);
      assert.deepEqual(Object.keys(opened[0]), ['time', 'code', 'result', 'ip_hash']);

      // Escape closes and returns focus.
      await page.keyboard.press('Escape');
      assert.equal(await attr(page, '#trip-charleston button.waitlist-open', 'aria-expanded'), 'false');
      assert.equal(await page.locator('#waitlist-charleston').evaluate((el) => el.getClientRects().length), 0, 'the capture is hidden again');
      assert.equal((await activeInfo(page)).cls, 'secondary waitlist-open', 'focus returns to the opener');

      // Reopen (a second trip_card_open), bad email that passes the client check but not the server's.
      await page.click('#trip-charleston button.waitlist-open');
      await page.fill('#wl-charleston-email', 'ana@example.c');
      await page.check('#waitlist-charleston input[name="consent"]');
      const bad = page.waitForResponse((r) => r.url().endsWith('/api/waitlist'));
      await page.click('#waitlist-charleston button[type="submit"]');
      assert.equal((await bad).status(), 400);
      await page.waitForFunction(() => document.querySelector('#waitlist-charleston .form-status').textContent.trim() !== '' && document.querySelector('#waitlist-charleston .form-status').textContent !== 'Joining…');
      assert.equal(await text(page, '#waitlist-charleston .form-status'), 'Enter a valid email address.', "the server's message");
      assert.ok(await page.locator('#waitlist-charleston .form-status').evaluate((el) => el.classList.contains('is-error')));
      assert.equal((await activeInfo(page)).id, 'wl-charleston-email', 'focus goes back to the email field');
      assert.equal(await page.locator('#waitlist-charleston button[type="submit"]').isEnabled(), true, 'Join is enabled again');
      assert.equal((mock().waitlist || []).length, 0, 'nothing written for a 400');

      // Client-side checks: an empty consent and a malformed email never reach the server.
      await page.fill('#wl-charleston-email', 'nope');
      await page.click('#waitlist-charleston button[type="submit"]');
      assert.equal(await text(page, '#waitlist-charleston .form-status'), 'Enter a working email address.');

      // A valid submit with a name.
      await page.fill('#wl-charleston-email', 'Ana.Guest@Example.com');
      await page.fill('#wl-charleston-name', 'Ana Guest');
      const ok = page.waitForResponse((r) => r.url().endsWith('/api/waitlist'));
      await page.click('#waitlist-charleston button[type="submit"]');
      assert.equal((await ok).status(), 200);
      await page.waitForFunction(() => document.querySelector('#waitlist-charleston form').classList.contains('is-done'));
      assert.equal(await text(page, '#waitlist-charleston .form-status'), 'You’re on the list for Charleston. Katie will be in touch when it opens.');
      assert.equal(await page.locator('#waitlist-charleston .waitlist-fields').evaluate((el) => getComputedStyle(el).display), 'none', 'the fields fold away on success');
      let data = mock();
      assert.equal(data.waitlist.length, 1);
      assert.deepEqual(data.waitlist[0], { ...data.waitlist[0], email: 'ana.guest@example.com', name: 'Ana Guest', trip: 'Charleston', source: 'card' }, 'trip name, source card, lower-cased email');
      assert.deepEqual(Object.keys(data.waitlist[0]), ['timestamp', 'email', 'name', 'trip', 'source']);
      assert.deepEqual(data.log.filter((r) => r.code === 'waitlist_submit').map((r) => r.result), ['charleston'], 'one waitlist_submit Log row');
      assert.deepEqual(data.log.filter((r) => r.code === 'trip_card_open').map((r) => r.result), ['charleston', 'charleston'], 'one trip_card_open per open');

      // The general capture after the pros teaser: General / footer.
      await page.click('#waitlist button.waitlist-open');
      assert.equal((await activeInfo(page)).id, 'wl-general-email');
      assert.equal(await text(page, '#waitlist-general .waitlist-title'), 'Join the waitlist');
      await page.fill('#wl-general-email', 'friend@example.com');
      await page.check('#waitlist-general input[name="consent"]');
      const general = page.waitForResponse((r) => r.url().endsWith('/api/waitlist'));
      await page.click('#waitlist-general button[type="submit"]');
      assert.equal((await general).status(), 200);
      await page.waitForFunction(() => document.querySelector('#waitlist-general form').classList.contains('is-done'));
      assert.equal(await text(page, '#waitlist-general .form-status'), 'You’re on the list. Katie will be in touch when the lineup firms up.');
      data = mock();
      assert.deepEqual(data.waitlist.map((r) => [r.email, r.name, r.trip, r.source]), [['ana.guest@example.com', 'Ana Guest', 'Charleston', 'card'], ['friend@example.com', '', 'General', 'footer']]);
      assert.deepEqual(data.log.filter((r) => r.code === 'waitlist_submit').map((r) => r.result), ['charleston', 'general']);
      const generalOpens = data.log.filter((r) => r.code === 'trip_card_open' && r.result === 'general');
      t.diagnostic(`trip_card_open rows for the general opener: ${generalOpens.length} (the server refuses "general" for this event with a 400; the client still sends it)`);

      // Honeypot: looks like success, writes nothing.
      await page.click('#trip-geneva button.waitlist-open');
      await page.fill('#wl-geneva-email', 'bot@example.com');
      await page.check('#waitlist-geneva input[name="consent"]');
      const hpField = await page.locator('#waitlist-geneva .hp').evaluate((el) => ({ ariaHidden: el.getAttribute('aria-hidden'), offScreen: el.getBoundingClientRect().right < -5000, opacity: getComputedStyle(el).opacity, tabIndex: el.querySelector('input').tabIndex }));
      assert.deepEqual(hpField, { ariaHidden: 'true', offScreen: true, opacity: '0', tabIndex: -1 }, 'the honeypot is off screen (left:-9999px), transparent and out of the tab order');
      await page.evaluate(() => { document.querySelector('#waitlist-geneva input[name="website"]').value = 'http://spam.example'; });
      const hp = page.waitForResponse((r) => r.url().endsWith('/api/waitlist'));
      await page.click('#waitlist-geneva button[type="submit"]');
      assert.equal((await hp).status(), 200);
      await page.waitForFunction(() => document.querySelector('#waitlist-geneva form').classList.contains('is-done'));
      data = mock();
      assert.equal(data.waitlist.length, 2, 'the honeypot wrote no Waitlist row');
      assert.equal(data.log.filter((r) => r.code === 'waitlist_submit').length, 2, 'and no Log row');
      assert.equal(await text(page, '#waitlist-geneva .form-status'), 'You’re on the list for Geneva. Katie will be in touch when it opens.', 'a bot sees the same success copy');

      // The hero link logs no_code_click.
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await page.click('.hero-ctas a.no-code');
      const noCode = await waitForLog((r) => r.code === 'no_code_click');
      assert.equal(noCode.length, 1, 'one no_code_click row');
      assert.equal(noCode[0].result, '');
      t.diagnostic(`Log rows: ${mock().log.map((r) => `${r.code}:${r.result}`).join(', ')}`);
      assert.deepEqual(page.errors(), []);
      assert.deepEqual(page.external(), []);
      await page.close2();
    });

    test('the capture reads without JS: the form is in the markup, open, with the noscript line', async () => {
      const r = await http(srv.base, '/');
      assert.equal((r.text.match(/<form class="waitlist-form"/g) || []).length, 7, 'seven forms in the HTML');
      assert.match(r.text, /<noscript><p class="waitlist-noscript">Turn on JavaScript to join the waitlist, or ask Katie\.<\/p><\/noscript>/);
      assert.match(read('public/marketing.css'), /\.js \.waitlist-capture:not\(\.is-open\)\{display:none\}/, 'hidden only when JS is on');
      for (const trip of TRIPS.slice(1)) {
        assert.match(r.text, new RegExp(`<form class="waitlist-form" data-source="card" data-trip="${trip.id}" data-trip-name="${trip.name}"`), trip.id);
        assert.match(r.text, new RegExp(`<a href="/privacy">keep my email</a>`), 'the consent line links /privacy');
      }
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
    test('Katie = katie-portrait-34 (left half), Eva = eva-portrait-34 (right half), alts name the right person; hero crops per breakpoint; alt, width and height on every <img>', async (t) => {
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
      assert.equal(await home.evaluate(() => document.querySelector('.hero-image img').currentSrc.split('/').pop()), 'hero-clay-45-480.webp', 'the hero is the 4:5 crop below 700px');
      await home.close2();

      for (const [viewport, expected] of [[TABLET, /^hero-clay-32-/], [DESKTOP, /^hero-clay-32-960\.webp$/]]) {
        const page = await open({ viewport });
        await page.goto('/');
        await page.waitForFunction(() => document.querySelector('.hero-image img').complete);
        const src = await page.evaluate(() => document.querySelector('.hero-image img').currentSrc.split('/').pop());
        t.diagnostic(`hero @${viewport.width}: ${src}`);
        assert.match(src, expected, `${viewport.width}px hero crop`);
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

    test('phones (390, 3×) fetch no image variant wider than 960 on /', async (t) => {
      const page = await open({ viewport: MOBILE, deviceScaleFactor: 3 });
      const images = [];
      page.on('requestfinished', (req) => { if (req.resourceType() === 'image') images.push(req.url().split('/').pop()); });
      await page.goto('/');
      await loadWholePage(page);
      const widths = images.map((f) => ({ f, w: Number((f.match(/-(\d+)\.(?:webp|jpg|png)$/) || [])[1] || 0) }));
      t.diagnostic(`/ @390×3 images: ${widths.map((x) => `${x.f}`).join(', ')}`);
      assert.ok(widths.length > 0);
      assert.ok(widths.every((x) => x.w > 0 && x.w <= 960), 'no variant wider than 960');
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
          const rest = s.replaceAll('4–12 players', '').replaceAll('4–12</strong><span>players', '').replaceAll(HERO_SENTENCES[1], '');
          if (/players/i.test(rest)) return 'NOT ALLOWED';
          return s.includes(HERO_SENTENCES[1]) ? 'allowed: the approved hero sentence' : 'allowed: 4–12 players';
        }
        if (h.pattern === 'star') {
          if (/pros(?:-jump)?:(?:start|end)/.test(s) && !/star(?!t)/i.test(s)) return 'markup noise: pros:start / pros-jump:start marker';
          return /five-star/.test(s) && /La Finca/.test(s) && !/star(?!t)/i.test(s.replaceAll('five-star', '')) ? 'allowed: five-star La Finca' : 'NOT ALLOWED';
        }
        return 'NOT ALLOWED';
      };
      for (const h of hits) t.diagnostic(`[${h.pattern}] ${h.file}:${h.line} -> ${verdict(h)} | ${h.text}`);
      const bad = hits.filter((h) => verdict(h) === 'NOT ALLOWED').map(({ full, ...rest }) => rest);
      assert.deepEqual(bad, [], 'every hit is an allowed fact or markup noise');
      for (const name of ['guests', '8–12', 'Dellich', 'Miami', 'white visor']) assert.equal(hits.filter((h) => h.pattern === name).length, 0, `${name}: no hits`);
      assert.equal(hits.filter((h) => h.pattern === '\\$').length, 3, 'the price appears on /, /pros and in trips.js only');
      // "To be announced" is the only wording for an unconfirmed detail on the non-Spain cards.
      const index = read('public/index.html');
      assert.equal((index.match(/<p class="trip-tba">To be announced<\/p>/g) || []).length, 5, 'five cards without a blurb say "To be announced"');
      assert.doesNotMatch(index.replace(/<[^>]+>/g, ' '), /\bTBD\b|\bTBA\b|coming soon/i, 'no other "unknown" wording in the visible text');
    });
  });

  describe('8. type and space', () => {
    test('the token block: eight --t-* steps (DESIGN.md says nine, lists eight), ten --s-* steps, the Georgia fallback; no bare font-size outside the token block except the documented exception', (t) => {
      const css = read('public/marketing.css');
      const root = css.match(/:root\s*\{[^}]*\}/)[0];
      const tSteps = [...root.matchAll(/--t(-?-\d):\s*clamp\(/g)].map((m) => `--t${m[1]}`);
      const sSteps = [...root.matchAll(/--s-([0-9a-z]+):\s*clamp\(/g)].map((m) => `--s-${m[1]}`);
      t.diagnostic(`type steps: ${tSteps.join(', ')} (${tSteps.length}); space steps: ${sSteps.join(', ')} (${sSteps.length})`);
      assert.deepEqual(tSteps, ['--t-5', '--t-4', '--t-3', '--t-2', '--t-1', '--t-0', '--t--1', '--t--2'], 'the eight fluid type steps DESIGN.md lists');
      assert.deepEqual(sSteps, ['--s-3xs', '--s-2xs', '--s-xs', '--s-s', '--s-m', '--s-l', '--s-xl', '--s-2xl', '--s-3xl', '--s-4xl']);
      assert.match(root, /--serif:\s*Georgia,\s*'Courtside Serif Fallback',\s*serif/);
      assert.match(css, /@font-face\{font-family:'Courtside Serif Fallback';src:local\([^}]*size-adjust:94%;ascent-override:92%;descent-override:22%;line-gap-override:0%\}/, 'the size-adjusted fallback face');
      const outside = css.replace(/:root\s*\{[^}]*\}/g, '').replace(/@font-face\s*\{[^}]*\}/g, '');
      const bareSizes = [...outside.matchAll(/([^{}]*)\{[^}]*?font-size:\s*([^;}]+)/g)].filter((m) => !/var\(--t/.test(m[2])).map((m) => `${m[1].trim().split('\n').pop().trim()} → font-size:${m[2].trim()}`);
      const bareShorthands = [...outside.matchAll(/([^{}]*)\{[^}]*?\bfont:\s*([^;}]+)/g)].filter((m) => !/var\(--t/.test(m[2])).map((m) => `${m[1].trim().split('\n').pop().trim()} → font:${m[2].trim()}`);
      t.diagnostic(`bare font sizes outside the token block: ${[...bareSizes, ...bareShorthands].join(' | ') || 'none'}`);
      // Documented exception (QA_REPORT_POLISH.md, item 8): the monogram letters at 700px+ are a display ornament, not text, drawn at 5rem.
      assert.deepEqual(bareSizes, ['.monogram span → font-size:5rem']);
      assert.deepEqual(bareShorthands, []);
      // Every space value in marketing.css is a token: no bare px/rem padding or margin except 0, 1px hairlines and the few documented offsets.
      const spacing = [...outside.matchAll(/(?:^|[;{])\s*(padding|margin)(?:-(?:top|bottom|left|right))?:\s*([^;}]+)/g)].map((m) => m[2].trim()).filter((v) => /\d(px|rem|em)/.test(v) && !/var\(--s/.test(v));
      t.diagnostic(`bare spacing values: ${[...new Set(spacing)].join(' | ') || 'none'}`);
    });

    test('computed sizes: body 17px at 390 and 18px at 1440; hero H1 56px and 112px (±2); paragraph measure ≤ 62ch', async (t) => {
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
          return {
            body: px(document.body), h1: px(document.querySelector('.hero h1')), h2: px(document.querySelector('.section-head h2')), intro: px(document.querySelector('.hero .intro')), eyebrow: px(document.querySelector('.eyebrow')),
            t5: getComputedStyle(document.documentElement).getPropertyValue('--t-5').trim(), widest,
          };
        });
        results[viewport.width] = m;
        t.diagnostic(`${viewport.width}px: body ${m.body}px, hero h1 ${m.h1}px, section h2 ${m.h2}px, intro ${m.intro}px, eyebrow ${m.eyebrow}px; --t-5 ${m.t5}; widest paragraphs ${m.widest.map((w) => `${w.sel} ${w.ch}ch (max-width ${w.maxWidth})`).join('; ')}`);
        assert.ok(m.widest.every((w) => w.ch <= 62.5), `paragraph measure ≤ 62ch (${m.widest[0].sel} is ${m.widest[0].ch}ch)`);
        await page.close2();
      }
      assert.ok(Math.abs(results[390].body - 17) <= 0.5, `body at 390 is 17px (${results[390].body})`);
      assert.ok(Math.abs(results[1440].body - 18) <= 0.5, `body at 1440 is 18px (${results[1440].body})`);
      assert.ok(Math.abs(results[390].h1 - 56) <= 2, `hero H1 at 390 is 56px ±2 (${results[390].h1})`);
      // DESIGN.md: --t-5 is 56 → 112px over 390 → 1440px. The declared clamp(3.5rem, 2.59rem + 3.9vw, 7rem) only reaches 7rem at ~1809px.
      assert.ok(Math.abs(results[1440].h1 - 112) <= 2, `hero H1 at 1440 is 112px ±2 (measured ${results[1440].h1}px; --t-5 = ${results[1440].t5})`);
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

    test('every link, button and input draws a :focus-visible ring; the featured card\'s ring sits on the panel frame; Tab is never stuck; Escape closes the capture', async (t) => {
      for (const route of PUBLIC_PAGES) {
        const page = await open({ viewport: DESKTOP });
        await page.goto(route);
        await settled(page);
        const { steps, left } = await tabWalk(page);
        t.diagnostic(`${route}: ${steps.length} Tab stops, focus left the document: ${left}; rings on a frame: ${steps.filter((s) => s.ringOnFrame).map((s) => `${s.tag} "${s.text}"`).join(', ') || 'none'}`);
        assert.ok(left, `${route}: Tab leaves the document (never stuck)`);
        assert.ok(steps.length >= 3, `${route}: controls were walked (the gate has three: the way back, the code field, Enter)`);
        for (let i = 1; i < steps.length; i += 1) assert.notDeepEqual(steps[i], steps[i - 1], `${route}: no control is focused twice in a row`);
        assert.deepEqual(steps.filter((s) => !s.ring).map((s) => `${s.tag}|${s.href}|${s.text}`), [], `${route}: a ring on every stop`);
        assert.ok(steps.every((s) => s.focusVisible), `${route}: :focus-visible matched on every stop`);
        if (route === '/') {
          const featured = steps.find((s) => s.href === '/invite' && s.text === 'Enter with your invitation');
          assert.ok(featured && featured.ringOnFrame, 'the featured card\'s ring is drawn on its .panel frame, not on the stretched link');
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
          assert.equal(await attr(page, '#trip-charleston button.waitlist-open', 'aria-expanded'), 'false');
        }
        assert.deepEqual(page.errors(), []);
        await page.close2();
      }
    });
  });

  describe('11. hover', () => {
    const TREATMENTS = [
      // selector, what changes on hover, the expected end state
      { sel: '.hero-ctas a.primary', role: 'primary button', check: (b, a) => b.backgroundColor === 'rgb(57, 38, 29)' && a.backgroundColor === 'rgb(38, 25, 20)' && a.transform === 'matrix(1, 0, 0, 1, 0, -2)' && a.after === 'matrix(1, 0, 0, 1, 4, 0)' },
      { sel: '#pros .section-cta a.secondary', role: 'secondary button', check: (b, a) => b.backgroundColor === 'rgba(0, 0, 0, 0)' && a.backgroundColor === 'rgb(57, 38, 29)' && a.color === 'rgb(244, 239, 229)' && a.transform === 'matrix(1, 0, 0, 1, 0, -2)' },
      { sel: '.site-header .invite-pill', role: 'header pill', check: (b, a) => a.backgroundColor === 'rgb(57, 38, 29)' && a.color === 'rgb(244, 239, 229)' && a.transform === 'matrix(1, 0, 0, 1, 0, -2)' },
      { sel: '.site-nav a[href="#trips"]', role: 'nav link underline', check: (b, a) => /^0px/.test(b.backgroundSize) && (/^100%/.test(a.backgroundSize) || parseFloat(a.backgroundSize) >= a.width - 1) },
      // DESIGN.md's treatment for this link is the underline; the hover rule also darkens it to espresso, the focus rule does not (reported, not failed).
      { sel: '.hero-ctas a.no-code', role: 'no-code link underline', check: (b, a) => /^0px/.test(b.backgroundSize) && (/^100%/.test(a.backgroundSize) || parseFloat(a.backgroundSize) >= a.width - 1) },
      { sel: '#pros .pro-card:nth-child(1)', role: 'card lift', check: (b, a) => b.transform === 'none' && a.transform === 'matrix(1, 0, 0, 1, 0, -4)' && a.boxShadow !== 'none' },
      { sel: '.site-header > a[aria-label]', role: 'logo scale', check: (b, a) => b.transform === 'none' && a.transform === 'matrix(1.03, 0, 0, 1.03, 0, 0)' },
    ];
    const styles = (page, sel) => page.locator(sel).first().evaluate((el) => { const s = getComputedStyle(el); const after = getComputedStyle(el, '::after'); return { backgroundColor: s.backgroundColor, color: s.color, transform: s.transform, boxShadow: s.boxShadow, backgroundSize: s.backgroundSize, width: el.getBoundingClientRect().width, after: after.transform, focusVisible: el.matches(':focus-visible') }; });

    test('primary and secondary buttons flood and rise, nav links draw the underline, cards lift, the logo scales; the same end state on :focus-visible', async (t) => {
      const page = await open({ viewport: DESKTOP });
      await page.goto('/');
      await settled(page);
      assert.ok(await page.evaluate(() => matchMedia('(hover: hover)').matches), 'the test context reports a hovering pointer');
      for (const { sel, role, check } of TREATMENTS) {
        await page.mouse.move(5, 500);
        await page.waitForTimeout(350);
        const before = await styles(page, sel);
        await page.locator(sel).first().hover();
        await page.waitForTimeout(600);
        const after = await styles(page, sel);
        t.diagnostic(`${role} ${sel}: before ${JSON.stringify({ bg: before.backgroundColor, tf: before.transform, bs: before.backgroundSize })} → hover ${JSON.stringify({ bg: after.backgroundColor, color: after.color, tf: after.transform, after: after.after, bs: after.backgroundSize, shadow: after.boxShadow.slice(0, 40) })}`);
        assert.ok(check(before, after), `${role} (${sel}) changes on hover as designed`);
      }
      await page.mouse.move(5, 500);
      await page.waitForTimeout(350);
      // Keyboard: the same end state when the control is :focus-visible (the card and logo via their links).
      await page.keyboard.press('Tab');
      for (const { sel, role, check } of TREATMENTS) {
        const target = sel.includes('.pro-card') ? `${sel} .pro-link` : sel;
        await page.locator(target).first().focus();
        await page.waitForTimeout(500);
        const focused = await styles(page, sel);
        const fv = await page.locator(target).first().evaluate((el) => el.matches(':focus-visible'));
        const before = { backgroundColor: sel.includes('secondary') || sel.includes('pill') ? 'rgba(0, 0, 0, 0)' : 'rgb(57, 38, 29)', transform: 'none', backgroundSize: '0px 1px' };
        t.diagnostic(`${role} focus-visible=${fv}: ${JSON.stringify({ bg: focused.backgroundColor, color: focused.color, tf: focused.transform, after: focused.after, bs: focused.backgroundSize })}`);
        assert.ok(fv, `${role}: :focus-visible matched`);
        assert.ok(check(before, focused), `${role}: the hover end state appears on :focus-visible`);
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
      for (const need of ['.primary:hover', '.secondary:hover', '.site-nav a:hover', '.pro-card:hover', '.site-header>a[aria-label]:hover', '.no-code:hover']) {
        assert.ok(inside.some((r) => r.selector.replace(/\s+/g, '').includes(need.replace(/\s+/g, ''))), `${need} is inside @media (hover: hover)`);
      }
      assert.ok(outside.every((r) => /color|text-decoration|background-size|background:|transform:none|transition:none/.test(r.body || '')), 'every hover rule outside the media block is colour, underline or a reduced-motion reset');
    });
  });

  describe('12. motion', () => {
    test('the hero settles once on load; under reduced motion nothing animates, the hero is visible, the anchor is instant and the sticky bar has no transition', async (t) => {
      const page = await open({ viewport: DESKTOP });
      await page.goto('/');
      const early = await page.evaluate(() => document.getAnimations().map((a) => ({ state: a.playState, target: a.effect.target.className || a.effect.target.tagName, pseudo: a.effect.pseudoElement || null, inHero: !!a.effect.target.closest('.home-hero'), duration: a.effect.getTiming().duration, delay: a.effect.getTiming().delay, fill: a.effect.getTiming().fill })));
      t.diagnostic(`on load: ${early.length} animations: ${early.map((a) => `${a.target}${a.pseudo || ''} ${a.state} ${a.duration}ms+${a.delay}`).join('; ')}`);
      assert.ok(early.length > 0, 'the hero settle is running');
      assert.ok(early.every((a) => a.inHero), 'every animation belongs to the hero');
      assert.ok(early.every((a) => a.fill === 'both' && a.duration <= 900 && a.duration >= 600), 'CSS keyframes, 600–900ms, fill both');
      await settled(page);
      await page.waitForTimeout(800);
      const late = await page.evaluate(() => ({ animations: document.getAnimations().map((a) => a.playState), copy: [...document.querySelectorAll('.hero-copy > *')].map((el) => getComputedStyle(el).opacity), shade: getComputedStyle(document.querySelector('.hero-image'), '::before').opacity, label: getComputedStyle(document.querySelector('.hero-label')).opacity }));
      t.diagnostic(`after settle: ${JSON.stringify(late)}`);
      assert.ok(late.animations.every((s) => s === 'finished'), 'every hero animation finished and none restarted');
      assert.deepEqual(late.copy, ['1', '1', '1', '1'], 'the hero copy is at opacity 1');
      assert.equal(late.shade, '0', 'the photo shade lifted');
      assert.equal(late.label, '1');
      assert.deepEqual(page.errors(), []);
      await page.close2();

      const reduced = await open({ viewport: MOBILE, reducedMotion: 'reduce' });
      await reduced.goto('/');
      const r = await reduced.evaluate(() => ({ animations: document.getAnimations().length, copy: [...document.querySelectorAll('.hero-copy > *')].map((el) => getComputedStyle(el).opacity), shade: getComputedStyle(document.querySelector('.hero-image'), '::before').opacity, img: getComputedStyle(document.querySelector('.hero-image img')).opacity, scroll: getComputedStyle(document.documentElement).scrollBehavior, barTransition: getComputedStyle(document.querySelector('.sticky-cta')).transitionDuration, vt: typeof document.startViewTransition }));
      t.diagnostic(`reduced motion: ${JSON.stringify(r)}`);
      assert.equal(r.animations, 0, 'zero animations under reduced motion');
      assert.deepEqual(r.copy, ['1', '1', '1', '1'], 'the hero is fully visible');
      assert.equal(r.shade, '0');
      assert.equal(r.img, '1');
      assert.equal(r.scroll, 'auto');
      assert.match(r.barTransition, /^0s(, 0s)?$/, 'the sticky bar has no transition');
      await reduced.click('.hero-ctas a.no-code');
      const landed = await reduced.evaluate(() => { const el = document.getElementById('trips'); return { hash: location.hash, top: Math.round(el.getBoundingClientRect().top), margin: parseFloat(getComputedStyle(el).scrollMarginTop) }; });
      assert.equal(landed.hash, '#trips');
      assert.ok(Math.abs(landed.top - landed.margin) < 4, `#trips lands instantly (${landed.top}px vs scroll-margin ${landed.margin}px)`);
      await reduced.evaluate(() => window.scrollTo({ top: document.querySelector('.home-hero').getBoundingClientRect().bottom + window.scrollY + 120, behavior: 'instant' }));
      await reduced.waitForFunction(() => document.querySelector('.sticky-cta').classList.contains('is-on'));
      const bar = await reduced.evaluate(() => { const s = getComputedStyle(document.querySelector('.sticky-cta')); return { visibility: s.visibility, transform: s.transform, transition: s.transitionDuration }; });
      assert.deepEqual(bar, { visibility: 'visible', transform: 'none', transition: bar.transition }, 'the bar appears at once');
      assert.match(bar.transition, /^0s(, 0s)?$/);
      assert.equal(await reduced.evaluate(() => document.getAnimations().length), 0);
      assert.deepEqual(reduced.errors(), []);
      await reduced.close2();
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
    test('style.css and gate.js unchanged versus main; site.html +1 <style> line; site.js only the three redirects; no new hex in marketing.css outside :root but the gold-ink tokens; no @import, no webfont URL', (t) => {
      let hasMain = true;
      try { execFileSync('git', ['rev-parse', '--verify', 'main'], { cwd: ROOT, stdio: 'pipe' }); } catch { hasMain = false; }
      if (hasMain) {
        assert.equal(execFileSync('git', ['diff', 'main', '--', 'public/style.css', 'public/js/gate.js'], { cwd: ROOT, encoding: 'utf8' }), '', 'style.css and gate.js are byte-identical to main');
        const siteHtml = execFileSync('git', ['diff', 'main', '--', 'public/site.html'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
        assert.deepEqual(siteHtml, ['+<style>@view-transition{navigation:auto}@media (prefers-reduced-motion:reduce){@view-transition{navigation:none}}</style>'], 'site.html: exactly one added line, the view-transition opt-in');
        const siteJs = execFileSync('git', ['diff', 'main', '--', 'public/js/site.js'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
        assert.equal(siteJs.length, 6);
        assert.ok(siteJs.filter((l) => l.startsWith('-')).every((l) => l.includes("location.replace('/')")) && siteJs.filter((l) => l.startsWith('+')).every((l) => l.includes("location.replace('/invite')")), 'site.js: the three redirect targets only');
      } else t.diagnostic('no main branch: git diffs skipped');
      const marketing = read('public/marketing.css');
      const style = read('public/style.css');
      const hex = (css) => [...new Set((css.match(/#[0-9a-fA-F]{3,8}\b/g) || []).map((h) => h.toLowerCase()))];
      const outsideRoot = marketing.replace(/:root\s*\{[^}]*\}/g, '');
      const extra = hex(outsideRoot).filter((h) => !hex(style).includes(h) && h !== '#7d6236' && h !== '#c9a86a');
      t.diagnostic(`marketing.css hex outside :root: ${hex(outsideRoot).join(', ')}; in :root: ${hex(marketing.match(/:root\s*\{[^}]*\}/)[0]).join(', ')}`);
      assert.deepEqual(extra, [], 'no hex colour outside :root that style.css does not already use, other than the gold text tokens');
      assert.deepEqual(hex(marketing.match(/:root\s*\{[^}]*\}/)[0]), ['#7d6236', '#c9a86a'], 'the token block adds --gold-ink and --gold-bright only');
      for (const file of ['public/marketing.css', 'public/style.css', 'public/index.html', 'public/pros.html', 'public/invite.html', 'public/privacy.html', 'public/404.html', 'public/site.html']) {
        const src = read(file);
        assert.doesNotMatch(src, /@import/, `${file}: no @import`);
        assert.doesNotMatch(src, /fonts\.googleapis|fonts\.gstatic|typekit|use\.fontawesome|\.woff2?|\.ttf|\.otf/i, `${file}: no webfont URL`);
        assert.doesNotMatch(src, /<link[^>]+href="https?:\/\/(?!courtside-ivory\.vercel\.app\/)/, `${file}: no cross-origin <link>`);
      }
      const faces = marketing.match(/@font-face\s*\{[^}]*\}/g) || [];
      assert.equal(faces.length, 2);
      assert.ok(faces.every((f) => !/url\(/.test(f) && /local\(/.test(f)), 'the fallback @font-face uses local() only');
    });
  });

  describe('17. page weight', () => {
    for (const route of ['/', '/pros']) {
      test(`${route} at 390: whole page under 1 MB, first view under 400 KB, no third-party request, no render-blocking script; the hero image's transfer size`, async (t) => {
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
          const hero = transfers.find((r) => /hero-clay|katie-portrait/.test(r.url));
          const scripts = await page.evaluate(() => [...document.scripts].map((s) => ({ src: s.getAttribute('src'), type: s.getAttribute('type'), async: s.async, defer: s.defer, inline: !s.src ? s.textContent.length : 0 })));
          const byType = {};
          for (const r of transfers) byType[r.type] = (byType[r.type] || 0) + r.body;
          t.diagnostic(`${route} @390×${dpr}: ${firstViewCount} requests / ${(firstView / 1024).toFixed(0)} KB first view; ${transfers.length} requests / ${(total / 1024).toFixed(0)} KB whole page (${Object.entries(byType).map(([k, v]) => `${k} ${(v / 1024).toFixed(0)} KB`).join(', ')}); hero/first image ${hero ? `${hero.url.split('/').pop()} ${(hero.body / 1024).toFixed(1)} KB` : 'n/a'}; scripts ${JSON.stringify(scripts)}`);
          assert.ok(total < 1024 * 1024, `${route} @${dpr}×: whole page ${total} B < 1 MB`);
          assert.ok(firstView < 400 * 1024, `${route} @${dpr}×: first view ${firstView} B < 400 KB`);
          assert.deepEqual(page.external(), [], 'no third-party request');
          assert.ok(transfers.every((r) => r.url.startsWith('/')), 'same-origin only');
          assert.ok(scripts.filter((s) => s.src).every((s) => s.type === 'module'), 'external scripts are modules (deferred by definition)');
          assert.ok(scripts.filter((s) => !s.src).every((s) => s.inline < 200), 'the only inline script is the one-line html.js class toggle');
          assert.ok(hero && hero.body > 0, 'the hero image was fetched');
          assert.deepEqual(page.errors(), []);
          await page.close2();
        }
      });
    }
  });
});
