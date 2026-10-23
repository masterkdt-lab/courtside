// tests/e2e/public.test.js
// The public pages (/, /pros, /invite) against COURTSIDE_PHASE2_PLAN.md sections 3, 5, 6 and 8, with the
// expectations the approved polish redesign changed (COURTSIDE_POLISH_BRIEF.md section 1, POLISH_PLAN.md
// sections 1–8 and the approved decisions) rewritten; every Phase 2 check that still applies is kept.
// Playwright (library) drives headless Chromium against a dev server started in this process on a free
// port with a temp mock file, exactly as browser.test.js does. Every request that would leave 127.0.0.1
// is aborted and recorded, so the suite never touches the network.
//
// The items are numbered as in QA_REPORT_PHASE2.md. The polish checklist (QA_REPORT_POLISH.md) lives in
// polish.test.js, which also owns the axe scan (all five pages, both widths, color-contrast included).
// A failing test documents a defect; nothing here fixes anything.
//
// Run: npm run test:e2e   (needs `npx playwright install chromium`)
// Set E2E_SCREENSHOT_DIR=/some/dir to save the full-page screenshots (item 14).

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { NOINDEX, ROOT, freshIp, http, resetMock, startServer, useTempMock } from './helpers.js';
import { PROS } from '../../public/js/pros.js';
import { TRIPS, WAITLIST_NOTE } from '../../public/js/trips.js';

let playwright = null;
try {
  playwright = await import('playwright');
} catch {
  playwright = null;
}

const SHOTS = process.env.E2E_SCREENSHOT_DIR || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
// textContent with the typographic no-break spaces (the "&nbsp;" before the last word of each display line) folded.
const plain = (s) => s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

let srv;
let browser;
const contexts = new Set();

// A context with its own IP (rate limits), optional cookie, external requests aborted and recorded,
// and a collector for every console message and uncaught exception.
async function open({ cookie = null, viewport = { width: 1280, height: 900 }, ip = freshIp(), reducedMotion = 'no-preference' } = {}) {
  const context = await browser.newContext({ baseURL: srv.base, viewport, reducedMotion, extraHTTPHeaders: { 'x-forwarded-for': ip } });
  contexts.add(context);
  const external = [];
  await context.route((url) => !url.href.startsWith(srv.base), (route) => { external.push(route.request().url()); return route.abort(); });
  if (cookie) await context.addCookies([{ name: 'cs_session', value: cookie, url: srv.base }]);
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
const texts = (page, sel) => page.locator(sel).evaluateAll((els) => els.map((el) => el.textContent.trim()));
const activeInfo = (page) => page.evaluate(() => {
  const el = document.activeElement;
  return el ? { tag: el.tagName.toLowerCase(), id: el.id, cls: String(el.className), href: el.getAttribute('href'), text: (el.textContent || '').trim().slice(0, 48) } : null;
});
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 50))));
// The hero settles once on load (polish, one motion moment); measurements wait for it.
const settled = (page) => page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true }); };

// Scroll through the whole page so every lazy image is requested, wait for them, then go back up.
async function loadWholePage(page) {
  // Every scroll is instant: with html{scroll-behavior:smooth} a plain scrollTo() starts a compositor animation that
  // keeps running after the next call, so the page would never settle where the measurements expect it.
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

// Press Tab until focus leaves the document; returns what had focus at each step and whether a focus ring
// was drawn: on the element, or on the frame that carries the ring for a stretched link (.pro-card for
// .pro-link, .panel for the featured card's button; polish plan section 7).
async function tabWalk(page, max = 120) {
  await page.evaluate(() => { window.scrollTo(0, 0); if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); });
  const steps = [];
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return null;
      const ring = (e) => { const s = getComputedStyle(e); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0; };
      const frame = el.closest('.pro-card, .panel');
      return {
        tag: el.tagName.toLowerCase(), id: el.id, cls: String(el.className), href: el.getAttribute('href'),
        text: (el.textContent || '').trim().slice(0, 48), focusVisible: el.matches(':focus-visible'),
        ring: ring(el) || (frame ? ring(frame) : false),
      };
    });
    if (!info) break;
    steps.push(info);
  }
  return steps;
}

// Every keyboard-reachable control in DOM order (what tabWalk should produce).
const focusableInDomOrder = (page) => page.evaluate(() => {
  const els = [...document.querySelectorAll('a[href], button:not([disabled]), summary, input:not([disabled]), select, textarea, [tabindex]')]
    .filter((el) => el.getAttribute('tabindex') !== '-1');
  const visible = (el) => {
    if (!el.getClientRects().length) return false;
    for (let e = el; e; e = e.parentElement) { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden') return false; }
    return true;
  };
  return els.filter(visible).map((el) => ({ tag: el.tagName.toLowerCase(), id: el.id, href: el.getAttribute('href'), text: (el.textContent || '').trim().slice(0, 48) }));
});

const key = (s) => `${s.tag}|${s.href || ''}|${s.id || ''}|${s.text}`;

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

describe('public pages (Phase 2 Wave 3 QA, polish expectations)', { skip: playwright ? false : 'playwright is not installed: npm i -D playwright && npx playwright install chromium' }, () => {
  describe('2. / is the homepage', () => {
    test('200, noindex, no gate form, one <h1>, the sections in plan order plus the general waitlist close', async () => {
      const r = await http(srv.base, '/');
      assert.equal(r.status, 200);
      assert.match(r.text, NOINDEX, 'noindex,nofollow');
      assert.doesNotMatch(r.text, /id="inviteForm"/, 'no gate form on /');
      assert.equal((r.text.match(/<h1\b/g) || []).length, 1, 'exactly one <h1> in the markup');

      const page = await open();
      await page.goto('/');
      assert.equal(await page.locator('h1').count(), 1);
      assert.equal(plain(await text(page, 'h1')), 'tennis takes you further.');
      const order = await page.evaluate(() => {
        const sig = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : `.${String(el.className).trim().split(/\s+/)[0]}`}`;
        return { body: [...document.body.children].filter((el) => el.tagName !== 'SCRIPT').map(sig), main: [...document.querySelector('main').children].map(sig) };
      });
      // Polish: the sticky "Enter code" bar for phones sits after the footer (home.js shows it once the hero scrolls out).
      assert.deepEqual(order.body, ['a.skip-link', 'header.site-header', 'main#main', 'footer.footer', 'aside.sticky-cta'], 'header, main, footer, sticky bar (a complementary landmark so axe sees it inside a region)');
      assert.deepEqual(order.main, ['section.hero', 'section#about', 'section.quickfacts', 'section#trips', 'section#season', 'section#how', 'section#pros', 'section#waitlist'],
        'hero, what Courtside is + trust row, featured trip #trips, upcoming trips, how it works, pros teaser, general waitlist close');
      assert.equal(await page.locator('#about .pillar').count(), 3, 'three columns');
      assert.equal(await page.locator('section.quickfacts.trust .quickfact').count(), 4, 'trust row');
      assert.deepEqual(await texts(page, 'section.quickfacts.trust .quickfact strong'), ['Katie Delich', '4–12', 'Almoradí', 'La Finca']);
      assert.equal(await page.locator('#season .trip-card').count(), 6, 'six upcoming cards');
      assert.equal(await page.locator('#how .path-card').count(), 3, 'three steps');
      assert.equal(await page.locator('#pros .pro-card').count(), 3, 'three pro cards');
      assert.deepEqual(await page.locator('#pros .pro-link').evaluateAll((els) => els.map((a) => a.getAttribute('href'))), ['/pros#katie', '/pros#eva', '/pros#nelson']);
      assert.equal(await page.locator('#waitlist button.waitlist-open[aria-controls="waitlist-general"]').count(), 1, 'one general waitlist button at the close');
      assert.deepEqual(page.errors(), [], 'no console errors');
      assert.deepEqual(page.external(), [], 'no request left the origin');
      await page.close2();
    });
  });

  describe('3. /pros', () => {
    test('profiles render in pros.js order; `pros-page.js --check` passes; Nelson has a monogram and "Trips to be announced"; Katie has the Spain card, Eva the one-line reference', async (t) => {
      assert.deepEqual(PROS.map((p) => p.id), ['katie', 'eva', 'nelson'], 'pros.js order');
      assert.equal(PROS[0].name, 'Katie Delich', 'spelled Delich');
      const out = execFileSync(process.execPath, [path.join(ROOT, 'public/js/pros-page.js'), '--check'], { cwd: ROOT, encoding: 'utf8' });
      t.diagnostic(out.trim());
      assert.match(out, /pros\.html matches pros\.js \(3 pros\)/);

      const r = await http(srv.base, '/pros');
      assert.equal(r.status, 200);
      assert.match(r.text, NOINDEX);
      assert.equal((r.text.match(/<h1\b/g) || []).length, 1);

      const page = await open();
      await page.goto('/pros');
      await page.waitForLoadState('networkidle');
      assert.deepEqual(await page.locator('.profile-section').evaluateAll((els) => els.map((e) => e.id)), ['katie', 'eva', 'nelson']);
      assert.deepEqual(await texts(page, '.profile-section h2'), PROS.map((p) => p.name));
      assert.deepEqual(await page.locator('.pros-jump a').evaluateAll((els) => els.map((a) => a.getAttribute('href'))), ['#katie', '#eva', '#nelson']);
      assert.equal(await text(page, '#nelson .pro-portrait.monogram'), 'NR', 'Nelson monogram');
      assert.equal(await page.locator('#nelson img').count(), 0, 'no photo for Nelson');
      assert.equal(await text(page, '#nelson .profile-trips .placeholder'), 'Trips to be announced.');
      assert.equal(await page.locator('#nelson .trip-card').count(), 0);
      // Polish plan section 7: the full Spain card appears once, under its first host; Eva gets a one-line reference.
      assert.equal(await page.locator('#katie .trip-card').count(), 1, 'katie: one trip card');
      assert.equal(await text(page, '#katie-trip-spain h3'), 'The Spanish Offseason');
      assert.equal(await text(page, '#katie-trip-spain .trip-tag'), 'Invitation only');
      assert.equal(await page.locator('#katie-trip-spain a.secondary').getAttribute('href'), '/invite');
      assert.equal(await page.locator('#eva .trip-card').count(), 0, 'eva: no second copy of the card');
      assert.equal(await page.locator('#eva-trip-spain').evaluate((el) => el.tagName.toLowerCase() + '.' + el.className), 'p.profile-trip-line');
      assert.equal(await text(page, '#eva-trip-spain'), 'Co-hosts The Spanish Offseason with Katie');
      assert.equal(await page.locator('#eva-trip-spain a').getAttribute('href'), '/invite');
      assert.equal(await page.locator('.profile-section .section-cta a.primary[href="/invite"]').count(), 3, 'each profile ends with "Enter invite code"');
      assert.deepEqual(await texts(page, '.profile-section .section-cta a.primary'), ['Enter invite code', 'Enter invite code', 'Enter invite code']);
      assert.ok(await page.locator('#katie img').count() >= 1, 'Katie has a portrait');
      assert.ok(await page.locator('#eva img').count() >= 1, 'Eva has a portrait');
      assert.equal(await page.locator('text=Dellich').count(), 0);
      assert.deepEqual(page.errors(), [], 'pros-page.js module ran clean');
      assert.deepEqual(page.external(), []);
      await page.close2();
    });

    test('beyond: pros-page.js leaves the committed #prosRoot DOM alone when it already matches pros.js', async (t) => {
      // pros-page.js says it only swaps a region when the committed markup drifts. --check passes, so a load of /pros
      // should call replaceChildren() zero times; the init script counts the calls before the module runs.
      const context = await browser.newContext({ baseURL: srv.base, extraHTTPHeaders: { 'x-forwarded-for': freshIp() } });
      contexts.add(context);
      await context.addInitScript(() => {
        window.__replaced = [];
        const orig = Element.prototype.replaceChildren;
        Element.prototype.replaceChildren = function (...args) { window.__replaced.push(this.id || this.tagName); return orig.apply(this, args); };
      });
      const page = await context.newPage();
      await page.goto('/pros');
      await page.waitForLoadState('networkidle');
      const replaced = await page.evaluate(() => window.__replaced);
      t.diagnostic(`replaceChildren() calls on load: ${JSON.stringify(replaced)}`);
      await context.close();
      contexts.delete(context);
      assert.deepEqual(replaced, [], 'the committed markup matches, so the renderer should not re-render');
    });

    test('/pros#eva lands below the sticky header on a fresh load at 390 and 1440', async (t) => {
      for (const viewport of [MOBILE, DESKTOP]) {
        const page = await open({ viewport });
        await page.goto('/pros#eva');
        await page.waitForLoadState('networkidle');
        await settle(page);
        const m = await page.evaluate(() => {
          const eva = document.getElementById('eva').getBoundingClientRect();
          const header = document.querySelector('.site-header').getBoundingClientRect();
          return { evaTop: Math.round(eva.top), headerBottom: Math.round(header.bottom), scrollY: Math.round(scrollY), hash: location.hash };
        });
        t.diagnostic(`${viewport.width}px: #eva top ${m.evaTop}px, header bottom ${m.headerBottom}px, scrollY ${m.scrollY}`);
        assert.equal(m.hash, '#eva');
        assert.ok(m.scrollY > 0, 'the page scrolled to Eva');
        assert.ok(m.evaTop >= m.headerBottom - 1, `#eva (${m.evaTop}) is not hidden under the header (${m.headerBottom})`);
        assert.ok(m.evaTop <= m.headerBottom + 40, `#eva (${m.evaTop}) sits just below the header (${m.headerBottom})`);
        assert.deepEqual(page.errors(), []);
        await page.close2();
      }
    });
  });

  describe('4. /invite is the gate', () => {
    test('GUEST1 enters /site; PAUSED1, ONCE1 twice and a bogus code show their messages', async () => {
      await resetMock();
      const r = await http(srv.base, '/invite');
      assert.equal(r.status, 200);
      assert.match(r.text, /id="inviteForm"/);
      assert.match(r.text, NOINDEX);
      assert.equal((r.text.match(/<h1\b/g) || []).length, 1);
      assert.match(r.text, /<a class="gate-back" href="\/">← Courtside<\/a>/, 'the way back to the homepage');

      const guest = await open();
      await guest.goto('/invite');
      assert.ok(await guest.isVisible('#inviteForm'));
      await guest.fill('#inviteCode', 'GUEST1');
      await guest.click('#enterButton');
      await guest.waitForURL(/\/site$/);
      assert.ok(await guest.isVisible('#site'));
      await guest.close2();

      const once = await open();
      await once.goto('/invite');
      await once.fill('#inviteCode', 'ONCE1');
      await once.click('#enterButton');
      await once.waitForURL(/\/site$/, { timeout: 10000 });
      await once.close2();

      const page = await open();
      await page.goto('/invite');
      const idle = 'Your code is in your invitation from Katie.';
      const expect = { PAUSED1: 'This invitation is paused. Reach out to Katie.', ONCE1: 'This invitation has already been used.', NOPE99: "We couldn't find that invitation. Check the code and try again." };
      for (const [code, message] of Object.entries(expect)) {
        await page.fill('#inviteCode', code);
        await page.click('#enterButton');
        await page.waitForFunction((i) => { const m = document.querySelector('#inviteMessage').textContent; return m && m !== i && m !== 'Checking your invitation…'; }, idle);
        assert.equal(await text(page, '#inviteMessage'), message, code);
        assert.match(page.url(), /\/invite$/, `${code}: still on the gate`);
      }
      assert.deepEqual(page.errors(), []);
      await page.close2();
    });

    test('/invite?invite=GUEST1 and the legacy /?invite=GUEST1 both enter; /site without a cookie lands on /invite', async () => {
      const direct = await open();
      await direct.goto('/invite?invite=GUEST1');
      await direct.waitForURL(/\/site$/);
      assert.deepEqual(await direct.evaluate(() => fetch('/api/session').then((r) => r.json())), { ok: true, code: 'GUEST1', invitedBy: 'Katie', issuedTo: 'Ana Guest' });
      await direct.close2();

      const legacy = await open();
      const landed = await legacy.goto('/?invite=GUEST1');
      assert.equal(landed.url(), `${srv.base}/invite?invite=GUEST1`, 'redirected to the gate with the query');
      await legacy.waitForURL(/\/site$/);
      assert.ok(await legacy.isVisible('#site'));
      await legacy.close2();

      const r = await http(srv.base, '/site');
      assert.equal(r.status, 302);
      assert.equal(r.headers.get('location'), '/invite');
      const page = await open();
      await page.goto('/site');
      await page.waitForURL(/\/invite$/);
      assert.ok(await page.isVisible('#inviteForm'));
      await page.close2();
    });
  });

  describe('5. homepage CTAs (polish brief section 1 item 1)', () => {
    test('hero: one primary "Enter invite code" → /invite and the "Don’t have an invite code?" link scrolls to #trips without navigating; pill, featured link, teaser', async () => {
      const page = await open({ viewport: DESKTOP });
      await page.goto('/');
      await settled(page);
      assert.equal(await page.locator('.hero-ctas a').count(), 2, 'one button and one text link in the hero');
      assert.equal(await page.locator('.hero-ctas a.primary').count(), 1, 'exactly one primary');
      assert.equal(await page.locator('.hero-ctas a.secondary').count(), 0, 'the second hero button is gone (decision 5)');
      assert.equal(await text(page, '.hero-ctas a.primary'), 'Enter invite code');
      assert.equal(await page.getAttribute('.hero-ctas a.primary', 'href'), '/invite');
      assert.equal(await text(page, '.hero-ctas a.no-code'), 'Don’t have an invite code?');
      assert.equal(await page.getAttribute('.hero-ctas a.no-code', 'href'), '#trips');
      assert.equal(await text(page, '#trips .panel a.primary'), 'Enter with your invitation');
      assert.equal(await page.getAttribute('#trips .panel a.primary', 'href'), '/invite');
      assert.equal(await text(page, '.site-header .invite-pill'), 'Enter code');
      assert.equal(await page.getAttribute('.site-header .invite-pill', 'href'), '/invite');
      assert.deepEqual(await page.locator('.site-nav a').evaluateAll((els) => els.map((a) => [a.textContent.trim(), a.getAttribute('href')])), [['Trips', '#trips'], ['Meet the pros', '/pros']]);
      assert.equal(await page.locator('a[href="/invite"]').count(), 6, 'invite links: header pill, hero button, featured card, step 01, footer, sticky bar');

      await page.evaluate(() => { window.__sameDocument = true; });
      await page.click('.hero-ctas a.no-code');
      await page.waitForFunction(() => location.hash === '#trips');
      await page.waitForFunction(() => {
        const el = document.getElementById('trips');
        return Math.abs(el.getBoundingClientRect().top - parseFloat(getComputedStyle(el).scrollMarginTop)) < 4;
      }, null, { timeout: 5000 });
      assert.equal(await page.evaluate(() => window.__sameDocument), true, 'the document was not replaced');
      assert.equal(page.url(), `${srv.base}/#trips`);
      const trips = await page.evaluate(() => { const r = document.getElementById('trips').getBoundingClientRect(); return { top: Math.round(r.top), header: Math.round(document.querySelector('.site-header').getBoundingClientRect().bottom) }; });
      assert.ok(trips.top >= trips.header - 1, `#trips (${trips.top}) below the sticky header (${trips.header})`);

      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await page.click('.hero-ctas a.primary');
      await page.waitForURL(/\/invite$/);
      await page.goto('/');
      await page.click('.site-header .invite-pill');
      await page.waitForURL(/\/invite$/);
      await page.goto('/');
      await page.click('#trips .panel a.primary');
      await page.waitForURL(/\/invite$/);
      await page.goto('/');
      await page.click('#pros .section-cta a.secondary');
      await page.waitForURL(/\/pros$/);
      await page.goto('/');
      await page.click('.site-nav a[href="/pros"]');
      await page.waitForURL(/\/pros$/);
      assert.deepEqual(page.errors(), []);
      await page.close2();
    });
  });

  describe('6. no invented claims (decision 7, polish brief section 4)', () => {
    test('every grep hit in index.html, pros.html, 404.html, trips.js, pros.js is an allowed fact, "To be announced" or markup noise', async (t) => {
      const files = ['public/index.html', 'public/pros.html', 'public/404.html', 'public/js/trips.js', 'public/js/pros.js'];
      const patterns = { '\\$': /\$/, guests: /guests/, players: /players/, star: /star/, '8–12': /8–12/, Dellich: /Dellich/i, Miami: /Miami/i, 'white visor': /white visor/i };
      const hits = [];
      for (const file of files) {
        read(file).split('\n').forEach((line, i) => {
          for (const [name, re] of Object.entries(patterns)) if (re.test(line)) hits.push({ pattern: name, file, line: i + 1, full: line.trim(), text: line.trim().slice(0, 160) });
        });
      }
      // The verdict looks at the whole line; only the diagnostic is shortened.
      const HERO_SENTENCE = 'For the players they coach and the friends they bring.'; // POLISH_PLAN.md section 1, sentence 2 (approved)
      const verdict = (h) => {
        const s = h.full;
        if (h.pattern === '\\$') return /\$2,995/.test(s) && !/\$\s?[0-9]/.test(s.replaceAll('$2,995', '')) ? 'allowed: $2,995' : 'NOT ALLOWED';
        if (h.pattern === 'players') {
          // Only "4–12 players" (prose), the trust-row pair "<strong>4–12</strong><span>players" or the approved hero sentence may remain.
          const rest = s.replaceAll('4–12 players', '').replaceAll('4–12</strong><span>players', '').replaceAll(HERO_SENTENCE, '');
          if (/players/.test(rest)) return 'NOT ALLOWED';
          return s.includes(HERO_SENTENCE) ? 'allowed: the approved hero sentence' : 'allowed: 4–12 players';
        }
        if (h.pattern === 'star') {
          if (/pros(?:-jump)?:start|pros(?:-jump)?:end/.test(s) && !/star(?!t)/.test(s)) return 'markup noise: pros:start / pros-jump:start marker';
          return /five-star/.test(s) && /La Finca/.test(s) && !/star(?!t)/.test(s.replaceAll('five-star', '')) ? 'allowed: five-star La Finca' : 'NOT ALLOWED';
        }
        return 'NOT ALLOWED';
      };
      for (const h of hits) t.diagnostic(`[${h.pattern}] ${h.file}:${h.line} -> ${verdict(h)} | ${h.text}`);
      const bad = hits.filter((h) => verdict(h) === 'NOT ALLOWED').map(({ full, ...rest }) => rest);
      assert.deepEqual(bad, [], 'no disallowed claim');
      for (const name of ['guests', '8–12', 'Dellich', 'Miami', 'white visor']) assert.equal(hits.filter((h) => h.pattern === name).length, 0, `${name} must not appear`);
      assert.ok(hits.some((h) => h.pattern === '\\$'), 'the price is stated (sanity)');
      // The correct spelling is on both pages.
      assert.match(read('public/index.html'), /Katie Delich/);
      assert.match(read('public/pros.html'), /Katie Delich/);
    });
  });

  describe('7. trips data', () => {
    test('TRIPS is the seven Founding Season entries, exact wording and order, all waitlist except Spain', () => {
      const expected = [
        { id: 'spain', name: 'The Spanish Offseason', place: 'Costa Blanca, Spain', timing: 'Winter 2027', status: 'invitation', hostIds: ['katie', 'eva'] },
        { id: 'charleston', name: 'Charleston', place: 'Charleston', timing: 'late March + early April 2027', blurb: 'A local green-clay week + the Charleston Open.', status: 'waitlist' },
        { id: 'geneva', name: 'Geneva', place: 'Geneva', timing: 'May 2027', blurb: '', status: 'waitlist' },
        { id: 'mallorca', name: 'Mallorca', place: 'Mallorca', timing: 'June 2027', blurb: '', status: 'waitlist' },
        { id: 'new-york', name: 'New York', place: 'New York', timing: 'the full US Open window, 2027', blurb: '', status: 'waitlist' },
        { id: 'los-angeles', name: 'Los Angeles', place: 'Los Angeles', timing: 'the Laver Cup, September 24–26, 2027', blurb: '', status: 'waitlist' },
        { id: 'fall-residency', name: 'Fall offseason residency', place: 'To be announced', timing: 'October to the week before Thanksgiving, 2027', blurb: '', status: 'waitlist' },
      ];
      assert.equal(TRIPS.length, 7);
      expected.forEach((e, i) => {
        const trip = TRIPS[i];
        for (const [k, v] of Object.entries(e)) assert.deepEqual(trip[k], v, `${e.id}.${k}`);
        if (e.status === 'waitlist') {
          assert.equal(trip.price, null, `${e.id}: no price`);
          assert.equal(trip.photo, null, `${e.id}: gradient panel, no photo`);
          assert.deepEqual(trip.hostIds, [], `${e.id}: no host yet`);
          assert.equal(trip.link, null);
        }
      });
      assert.equal(TRIPS[0].price, 'from $2,995 per player, six nights');
      assert.equal(TRIPS[0].blurb, 'seven Sunday–Saturday weeks, January 10 – February 27, 2027');
      assert.equal(TRIPS[0].link, '/invite');
      assert.equal(TRIPS[0].photo.key, 'spain-card-43', 'the featured card uses the named crop (PHOTOS.md)');
      assert.ok(!JSON.stringify(TRIPS).includes('Miami'));
      assert.equal(WAITLIST_NOTE, 'Waitlist opens soon. Invitations go out first; check back or ask Katie.');
    });

    test('the hand-written homepage cards match trips.js field by field (polish: timing in the art, the city once, a capture form per card)', async (t) => {
      const page = await open();
      await page.goto('/');
      const cards = await page.locator('#season .trip-card').evaluateAll((els) => els.map((el) => {
        const form = el.querySelector('form.waitlist-form');
        const button = el.querySelector('button.waitlist-open');
        return {
          id: el.id,
          art: el.querySelector('.trip-art span')?.textContent.trim(),
          tag: el.querySelector('.trip-tag')?.textContent.trim(),
          name: el.querySelector('h3')?.textContent.trim(),
          timing: el.querySelector('.trip-timing')?.textContent.trim(),
          blurb: [...el.querySelectorAll('.trip-body > p:not(.trip-meta):not(.trip-tba)')].map((p) => p.textContent.trim()),
          tba: el.querySelector('.trip-tba')?.textContent.trim() ?? null,
          button: button?.textContent.trim(),
          controls: button?.getAttribute('aria-controls'),
          expanded: button?.getAttribute('aria-expanded'),
          form: form ? { trip: form.dataset.trip, source: form.dataset.source, tripName: form.dataset.tripName, title: form.querySelector('.waitlist-title')?.textContent.trim(), id: form.closest('.waitlist-capture')?.id } : null,
          hasImage: !!el.querySelector('img'),
          cityMentions: (el.textContent.match(new RegExp(el.querySelector('h3')?.textContent.trim().split(' ')[0] || '§', 'g')) || []).length,
        };
      }));
      const wanted = TRIPS.slice(1).map((trip) => ({
        id: `trip-${trip.id}`, art: trip.timing, tag: 'Waitlist', name: trip.name, timing: trip.timing,
        blurb: trip.blurb ? [trip.blurb.charAt(0).toUpperCase() + trip.blurb.slice(1)] : [], tba: trip.blurb ? null : 'To be announced',
        button: 'Join the waitlist', controls: `waitlist-${trip.id}`, expanded: 'false',
        form: { trip: trip.id, source: 'card', tripName: trip.name, title: `Join the waitlist for ${trip.name}`, id: `waitlist-${trip.id}` },
        hasImage: false,
        cityMentions: trip.id === 'charleston' ? 3 : 2, // the heading and the capture title; Charleston's blurb names the Charleston Open
      }));
      t.diagnostic(`city mentions per card: ${cards.map((c) => `${c.name} ${c.cityMentions}`).join(', ')}`);
      assert.deepEqual(cards, wanted);
      const featured = await page.evaluate(() => ({
        tag: document.querySelector('#trips .overlay .caps').textContent.trim(),
        name: document.querySelector('#trips .overlay h3').textContent.trim(),
        line: document.querySelector('#trips .overlay p').textContent.trim(),
        panel: document.querySelector('#trips .panel').textContent.replace(/\s+/g, ' ').trim(),
        alt: document.querySelector('#trips .media-card img').getAttribute('alt'),
        src: (document.querySelector('#trips .media-card img').currentSrc || '').split('/').pop(),
        link: document.querySelector('#trips .panel a.primary').getAttribute('href'),
      }));
      const spain = TRIPS[0];
      assert.equal(featured.tag, 'Invitation only');
      assert.equal(featured.name, spain.name);
      assert.equal(featured.alt, spain.photo.alt);
      assert.match(featured.src, /^spain-card-43-/, 'the featured photo is the spain-card-43 crop');
      assert.equal(featured.link, spain.link);
      // Plan 4.1 fixes the overlay line as "Costa Blanca, Spain · Winter 2027 · seven Sunday–Saturday weeks · from $2,995 per
      // player, six nights"; trips.js's blurb adds the January 10 – February 27 dates, which the card's panel carries instead.
      assert.equal(featured.line, `${spain.place} · ${spain.timing} · seven Sunday–Saturday weeks · ${spain.price}`);
      t.diagnostic(`featured overlay: "${featured.line}" | trips.js blurb: "${spain.blurb}"`);
      assert.ok(featured.panel.includes('January 10 – February 27, 2027'), 'the dates from the blurb are on the card (panel)');
      assert.ok(featured.panel.includes('Seven Sunday–Saturday weeks'), 'the week count from the blurb is on the card (panel)');
      await page.close2();
    });
  });

  describe('8. layout at 390 and 1440 (and the screenshots, item 14)', () => {
    for (const [route, name] of [['/', 'home'], ['/pros', 'pros'], ['/invite', 'invite']]) {
      for (const viewport of [MOBILE, DESKTOP]) {
        test(`${route} at ${viewport.width}px: no horizontal scroll, readable text, no stretched images, no overlapping text`, async (t) => {
          const page = await open({ viewport });
          await page.goto(route);
          await loadWholePage(page);
          const m = await page.evaluate(() => {
            // Rendered and on screen: not display:none/visibility:hidden/opacity:0 up the tree, not inside a closed <details>
            // (Chromium keeps a box for that content under content-visibility, so checkVisibility() is asked too).
            const visible = (el) => {
              const r = el.getBoundingClientRect();
              if (!r.width || !r.height) return false;
              if (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true, opacityProperty: true, contentVisibilityAuto: true })) return false;
              for (let e = el; e; e = e.parentElement) {
                const s = getComputedStyle(e);
                if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
                if (e.tagName === 'DETAILS' && !e.open && !el.closest('summary')) return false;
              }
              return true;
            };
            const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
            // Smallest font on an element that carries text of its own. .site-powered / .powered ("powered by tgl.rsvp")
            // come from Phase 1's style.css unchanged, so they are reported separately rather than failed here.
            const withText = [...document.querySelectorAll('body *')].filter((el) => visible(el) && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
            const allFonts = withText.map((el) => ({ size: parseFloat(getComputedStyle(el).fontSize), tag: el.tagName.toLowerCase(), cls: String(el.className), text: el.textContent.trim().slice(0, 30) })).sort((a, b) => a.size - b.size);
            const phase1Tiny = allFonts.filter((f) => /\b(site-)?powered\b/.test(f.cls));
            const fonts = allFonts.filter((f) => !/\b(site-)?powered\b/.test(f.cls));
            // Images: object-fit:cover ones are cropped on purpose; the rest must keep their natural ratio.
            const images = [...document.images].filter((img) => img.naturalWidth && visible(img)).map((img) => {
              const r = img.getBoundingClientRect();
              return { src: (img.currentSrc || img.src).split('/').pop(), fit: getComputedStyle(img).objectFit, natural: +(img.naturalWidth / img.naturalHeight).toFixed(3), rendered: +(r.width / r.height).toFixed(3) };
            });
            const stretched = images.filter((i) => i.fit !== 'cover' && Math.abs(i.natural / i.rendered - 1) > 0.03);
            // Text overlap: the glyph boxes (a Range over each leaf's contents, so padding that only enlarges a tap
            // target, like .pro-link's, does not count) of leaf text elements that intersect by more than 2px on both
            // axes, ancestors excluded. The sticky header floats over content by design once the page scrolls, so it
            // is left out here and checked below instead.
            const INLINE = new Set(['BR', 'EM', 'STRONG', 'SPAN', 'A', 'B', 'I', 'SMALL']);
            const stickyHeader = document.querySelector('.site-header');
            const leaves = withText.filter((el) => [...el.children].every((c) => INLINE.has(c.tagName)) && !(stickyHeader && stickyHeader.contains(el)));
            const glyphBox = (el) => { const range = document.createRange(); range.selectNodeContents(el); return range.getBoundingClientRect(); };
            const mainTop = document.querySelector('main')?.getBoundingClientRect().top ?? 0;
            const headerBottom = stickyHeader ? stickyHeader.getBoundingClientRect().bottom : 0;
            const overlaps = [];
            const boxes = leaves.map(glyphBox);
            for (let i = 0; i < leaves.length; i += 1) {
              const a = boxes[i];
              for (let j = i + 1; j < leaves.length; j += 1) {
                if (leaves[i].contains(leaves[j]) || leaves[j].contains(leaves[i])) continue;
                const b = boxes[j];
                const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
                const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
                if (x > 2 && y > 2) overlaps.push(`${leaves[i].tagName}.${leaves[i].className} "${leaves[i].textContent.trim().slice(0, 20)}" × ${leaves[j].tagName}.${leaves[j].className} "${leaves[j].textContent.trim().slice(0, 20)}" (${Math.round(x)}×${Math.round(y)}px)`);
              }
            }
            // Header children must not collide.
            const header = [...document.querySelector('.site-header, .gate-top').children].filter(visible).map((el) => el.getBoundingClientRect());
            const headerCollisions = [];
            for (let i = 0; i < header.length; i += 1) for (let j = i + 1; j < header.length; j += 1) {
              const x = Math.min(header[i].right, header[j].right) - Math.max(header[i].left, header[j].left);
              const y = Math.min(header[i].bottom, header[j].bottom) - Math.max(header[i].top, header[j].top);
              if (x > 1 && y > 1) headerCollisions.push(`${i}×${j} ${Math.round(x)}×${Math.round(y)}px`);
            }
            return { innerWidth, scrollWidth, scrollY, pageHeight: document.documentElement.scrollHeight, smallest: fonts.slice(0, 3), phase1Tiny, images, stretched, overlaps, headerCollisions, mainTop, headerBottom };
          });
          assert.equal(m.scrollY, 0, 'measured at the top of the page');
          assert.ok(m.mainTop >= m.headerBottom - 1, `main (${m.mainTop}) starts below the sticky header (${m.headerBottom})`);
          t.diagnostic(`${route} ${viewport.width}px: scrollWidth ${m.scrollWidth}/${m.innerWidth}, page ${m.pageHeight}px tall, smallest text ${m.smallest.map((f) => `${f.size}px ${f.tag}.${f.cls}`).join('; ')}; Phase 1 "powered by" line: ${m.phase1Tiny.map((f) => `${f.size}px ${f.tag}.${f.cls}`).join('; ') || 'hidden'}; images: ${m.images.map((i) => `${i.src} ${i.fit}`).join(', ')}`);
          await shot(page, `${name}-${viewport.width}`);
          assert.ok(m.scrollWidth <= m.innerWidth, `no horizontal scroll (${m.scrollWidth} > ${m.innerWidth})`);
          assert.ok(m.smallest[0].size >= 12, `smallest text ${m.smallest[0].size}px (${m.smallest[0].tag}.${m.smallest[0].cls} "${m.smallest[0].text}")`);
          assert.deepEqual(m.stretched, [], 'no image drawn off its natural ratio');
          assert.deepEqual(m.overlaps, [], 'no overlapping text');
          assert.deepEqual(m.headerCollisions, [], 'header items do not collide');
          assert.ok(m.images.length > 0, 'images rendered');
          assert.deepEqual(page.errors(), []);
          assert.deepEqual(page.external(), []);
          await page.close2();
        });
      }
    }
  });

  describe('9. accessibility (the axe scan is in polish.test.js, item 9)', () => {
    for (const route of ['/', '/pros']) {
      test(`${route}: skip link first and working, landmarks, one <h1>, alt on every <img>`, async (t) => {
        const page = await open({ viewport: DESKTOP });
        await page.goto(route);
        await page.keyboard.press('Tab');
        const first = await activeInfo(page);
        assert.equal(first.cls, 'skip-link', 'the skip link is the first thing Tab reaches');
        assert.equal(first.href, '#main');
        const shown = await page.evaluate(() => document.activeElement.getBoundingClientRect().top >= 0);
        assert.ok(shown, 'the skip link is visible while focused');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => location.hash === '#main');
        assert.equal((await activeInfo(page)).id, 'main', 'focus moves to <main>');
        await page.keyboard.press('Tab');
        const next = await activeInfo(page);
        assert.equal(next.tag, 'a', 'the next Tab lands inside main');
        assert.ok(next.text !== 'Skip to content' && !next.cls.includes('invite-pill'), `next focus is page content, got ${JSON.stringify(next)}`);
        const landmarks = await page.evaluate(() => ({
          header: document.querySelectorAll('body > header').length, main: document.querySelectorAll('main').length, footer: document.querySelectorAll('body > footer').length,
          navs: [...document.querySelectorAll('nav')].map((n) => n.getAttribute('aria-label')), h1: document.querySelectorAll('h1').length,
          imgs: document.images.length, noAlt: [...document.images].filter((i) => !i.hasAttribute('alt')).length, emptyAlt: [...document.images].filter((i) => i.getAttribute('alt') === '').length,
          lang: document.documentElement.lang,
        }));
        t.diagnostic(`${route}: ${JSON.stringify(landmarks)}`);
        assert.equal(landmarks.header, 1); assert.equal(landmarks.main, 1); assert.equal(landmarks.footer, 1);
        assert.ok(landmarks.navs.includes('Site') && landmarks.navs.includes('Footer'), 'site and footer navs are labelled');
        assert.equal(landmarks.h1, 1);
        assert.equal(landmarks.noAlt, 0, 'alt on every <img>');
        assert.equal(landmarks.lang, 'en');
        await page.close2();
      });

      test(`${route}: a :focus-visible ring on every link and button, Tab order = DOM order, the waitlist capture opens and closes by keyboard`, async (t) => {
        const page = await open({ viewport: DESKTOP });
        await page.goto(route);
        await settled(page);
        const steps = await tabWalk(page);
        const expected = await focusableInDomOrder(page);
        t.diagnostic(`${route}: ${steps.length} Tab stops`);
        assert.deepEqual(steps.map(key), expected.map(key), 'keyboard reaches every control in DOM order');
        const noRing = steps.filter((s) => !s.ring).map(key);
        assert.deepEqual(noRing, [], 'every focused control draws a focus ring (on itself or on its card frame)');
        assert.ok(steps.every((s) => s.focusVisible), ':focus-visible matched on each');
        const kinds = new Set(steps.map((s) => s.tag));
        assert.ok(kinds.has('a'), 'links were walked');
        if (route === '/') {
          // Polish plan section 3 and critic fix 4: the <details> summaries became <button aria-expanded> openers with a real form.
          assert.ok(kinds.has('button'), 'the waitlist openers are in the tab order');
          assert.equal(steps.filter((s) => s.tag === 'summary').length, 0, 'no <details>/<summary> left');
          assert.equal(steps.filter((s) => s.cls.includes('waitlist-open')).length, 7, 'six card openers and the general one');
          await page.evaluate(() => { window.scrollTo(0, 0); document.activeElement.blur(); });
          let info = null;
          for (let i = 0; i < 60; i += 1) { await page.keyboard.press('Tab'); info = await activeInfo(page); if (info && info.cls.includes('waitlist-open')) break; }
          assert.ok(info.cls.includes('waitlist-open'), 'reached the first opener');
          const state = () => page.evaluate(() => {
            const opener = document.querySelector('#trip-charleston button.waitlist-open');
            const panel = document.getElementById(opener.getAttribute('aria-controls'));
            return { expanded: opener.getAttribute('aria-expanded'), open: panel.classList.contains('is-open'), visible: panel.getClientRects().length > 0, active: document.activeElement.id || document.activeElement.className };
          });
          assert.deepEqual(await state(), { expanded: 'false', open: false, visible: false, active: 'secondary waitlist-open' });
          await page.keyboard.press('Enter');
          assert.deepEqual(await state(), { expanded: 'true', open: true, visible: true, active: 'wl-charleston-email' }, 'Enter opens the capture and focuses the email field');
          await page.keyboard.press('Escape');
          assert.deepEqual(await state(), { expanded: 'false', open: false, visible: false, active: 'secondary waitlist-open' }, 'Escape closes it and returns focus to the opener');
          await page.keyboard.press('Space');
          assert.equal((await state()).expanded, 'true', 'Space opens it again');
          const live = await page.locator('#waitlist-charleston .form-status[aria-live="polite"]').count();
          assert.equal(live, 1, 'the status line is aria-live (plan section 5)');
        }
        assert.deepEqual(page.errors(), []);
        await page.close2();
      });
    }
  });

  describe('10. performance', () => {
    for (const route of ['/', '/pros']) {
      test(`${route} at 390px: every request same-origin, total transfer under 1 MB with images, first image eager (+ preloaded on /), the rest lazy, external scripts are modules`, async (t) => {
        const page = await open({ viewport: MOBILE });
        const transfers = [];
        page.on('requestfinished', async (req) => {
          try {
            const res = await req.response();
            const sizes = await req.sizes().catch(() => null);
            const headerLen = Number(res?.headers()['content-length'] || 0);
            const body = Math.max(sizes?.responseBodySize || 0, headerLen);
            transfers.push({ url: req.url().replace(srv.base, ''), type: req.resourceType(), body, headers: sizes?.responseHeadersSize || 0 });
          } catch { /* the context closed */ }
        });
        await page.goto(route);
        await page.waitForLoadState('networkidle');
        const firstView = transfers.reduce((n, r) => n + r.body + r.headers, 0);
        await loadWholePage(page);
        const total = transfers.reduce((n, r) => n + r.body + r.headers, 0);
        const byType = {};
        for (const r of transfers) byType[r.type] = (byType[r.type] || 0) + r.body;
        t.diagnostic(`${route}: ${transfers.length} requests, first view ${(firstView / 1024).toFixed(0)} KB, whole page ${(total / 1024).toFixed(0)} KB (${Object.entries(byType).map(([k, v]) => `${k} ${(v / 1024).toFixed(0)} KB`).join(', ')})`);
        t.diagnostic(`${route}: images ${transfers.filter((r) => r.type === 'image').map((r) => `${r.url.split('/').pop()} ${(r.body / 1024).toFixed(0)} KB`).join(', ')}`);
        assert.ok(total < 1024 * 1024, `whole page ${total} bytes < 1 MB`);
        assert.deepEqual(page.external(), [], 'no third-party request');
        assert.ok(transfers.every((r) => r.url.startsWith('/')), 'every request is same-origin');

        const img = await page.evaluate(() => {
          const imgs = [...document.querySelectorAll('img')].map((i) => ({ src: (i.currentSrc || i.src).split('/').pop(), loading: i.getAttribute('loading'), priority: i.getAttribute('fetchpriority'), inMain: !!i.closest('main'), alt: i.alt }));
          const eager = imgs.filter((i) => i.inMain && i.loading !== 'lazy');
          // The hero preloads one crop per breakpoint (polish plan section 5): the link whose media matches is the one that counts.
          const preloads = [...document.querySelectorAll('link[rel="preload"][as="image"]')].map((l) => ({ media: l.getAttribute('media'), srcset: l.getAttribute('imagesrcset'), sizes: l.getAttribute('imagesizes'), matches: !l.media || matchMedia(l.media).matches }));
          const firstMainImg = document.querySelector('main img');
          const activeSource = firstMainImg ? [...firstMainImg.parentElement.querySelectorAll('source[type="image/webp"]')].find((s) => !s.media || matchMedia(s.media).matches) : null;
          return { imgs, eager, preloads, firstSrc: (firstMainImg?.currentSrc || '').split('/').pop(), activeSourceSrcset: activeSource?.getAttribute('srcset') || null, scripts: [...document.scripts].map((s) => ({ src: s.getAttribute('src'), type: s.getAttribute('type'), inline: !s.src && s.textContent.length })) };
        });
        t.diagnostic(`${route}: eager in main ${img.eager.map((i) => `${i.src} fetchpriority=${i.priority}`).join(', ') || 'none'}; preloads ${JSON.stringify(img.preloads)}; scripts ${JSON.stringify(img.scripts)}`);
        assert.equal(img.eager.length, 1, 'exactly one eager image in <main> (the hero / first portrait)');
        assert.equal(img.eager[0].loading, 'eager');
        assert.equal(img.eager[0].priority, 'high');
        const lazy = img.imgs.filter((i) => i.inMain && i.loading === 'lazy');
        assert.equal(lazy.length, img.imgs.filter((i) => i.inMain).length - 1, 'every other image in <main> is lazy');
        assert.equal(img.imgs.filter((i) => !i.inMain && i.loading !== 'lazy').length, 1, 'the header logo is the only other eager image; the footer logo is lazy');
        if (route === '/') {
          const active = img.preloads.filter((p) => p.matches);
          assert.equal(img.preloads.length, 2, 'one preload per hero crop (phones 4:5, 700px+ 3:2)');
          assert.equal(active.length, 1, 'exactly one preload matches this viewport');
          assert.equal(active[0].srcset, img.activeSourceSrcset, 'the matching preload equals the active hero <source> srcset');
          assert.match(active[0].srcset, /hero-clay-45/, 'phones preload the 4:5 crop');
        } else {
          t.diagnostic(`${route}: preload links ${img.preloads.length} (the first portrait is eager + high priority; a preload is a nicety here, not a plan item)`);
        }
        assert.ok(img.firstSrc.endsWith('.webp'), `the first image is served as WebP (${img.firstSrc})`);
        // The one-line class toggle in <head> (html.js, for the no-JS capture fallback) is inline and fetches nothing.
        assert.ok(img.scripts.filter((s) => s.src).every((s) => s.type === 'module'), 'every external script is a module (no render-blocking script)');
        assert.ok(img.scripts.filter((s) => !s.src).every((s) => s.inline < 200), 'inline scripts are one-liners');
        const preloadWarnings = page.consoleMessages().filter((m) => /preload/i.test(m));
        assert.deepEqual(preloadWarnings, [], 'no "preloaded but not used" warning');
        assert.deepEqual(page.errors(), []);
        await page.close2();
      });
    }

    test('beyond: / at 390px on a 3× screen (iPhone-like) still fits in 1 MB', async (t) => {
      const context = await browser.newContext({ baseURL: srv.base, viewport: MOBILE, deviceScaleFactor: 3, extraHTTPHeaders: { 'x-forwarded-for': freshIp() } });
      contexts.add(context);
      const page = await context.newPage();
      let total = 0;
      const images = [];
      page.on('requestfinished', async (req) => { try { const res = await req.response(); const n = Number(res.headers()['content-length'] || 0); total += n; if (req.resourceType() === 'image') images.push(`${req.url().split('/').pop()} ${(n / 1024).toFixed(0)} KB`); } catch { /* closed */ } });
      await page.goto('/');
      await loadWholePage(page);
      t.diagnostic(`/ @390 DPR3: ${(total / 1024).toFixed(0)} KB; images ${images.join(', ')}`);
      assert.ok(total < 1024 * 1024, `${total} bytes < 1 MB at DPR 3`);
      await context.close();
      contexts.delete(context);
    });
  });

  describe('11. reduced motion', () => {
    test('with prefers-reduced-motion: reduce the no-code link lands on #trips instantly and nothing animates', async () => {
      const page = await open({ viewport: MOBILE, reducedMotion: 'reduce' });
      await page.goto('/');
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), 'auto');
      assert.equal(await page.evaluate(() => document.getAnimations().length), 0, 'no hero settle under reduced motion');
      assert.deepEqual(await page.locator('.hero-copy > *').evaluateAll((els) => els.map((el) => getComputedStyle(el).opacity)), ['1', '1', '1', '1'], 'the hero copy is fully visible');
      await page.click('.hero-ctas a.no-code');
      const landed = await page.evaluate(() => {
        const el = document.getElementById('trips');
        return { hash: location.hash, top: Math.round(el.getBoundingClientRect().top), margin: parseFloat(getComputedStyle(el).scrollMarginTop), animations: document.getAnimations().length };
      });
      assert.equal(landed.hash, '#trips');
      assert.ok(Math.abs(landed.top - landed.margin) < 4, `#trips at ${landed.top}px right after the click (instant, scroll-margin ${landed.margin})`);
      assert.equal(landed.animations, 0, 'no running animations');
      await page.hover('#season .trip-card');
      await settle(page);
      const card = await page.evaluate(() => { const s = getComputedStyle(document.querySelector('#season .trip-card')); return { transition: s.transitionDuration, transform: s.transform, animations: document.getAnimations().length }; });
      assert.equal(card.transition, '0s', 'cards do not transition');
      assert.equal(card.transform, 'none', 'cards do not lift on hover');
      assert.equal(card.animations, 0);
      await loadWholePage(page);
      await shot(page, 'home-390-reduced-motion');
      assert.deepEqual(page.errors(), []);
      await page.close2();
    });
  });

  describe('12. brand', () => {
    test('marketing.css adds only the approved token block, --gold-ink and the local Georgia fallback; no webfont; Georgia on every heading', async (t) => {
      const marketing = read('public/marketing.css');
      const style = read('public/style.css');
      const hex = (css) => new Set((css.match(/#[0-9a-fA-F]{3,8}\b/g) || []).map((h) => h.toLowerCase()));
      const styleHex = hex(style);
      // The polish pass's one token block (DESIGN.md): type and space scales, --gold-ink, --ease, --header-h, --gutter, --serif.
      const rootBlocks = marketing.match(/:root\s*\{[^}]*\}/g) || [];
      assert.equal(rootBlocks.length, 2, 'one :root block at the top and one --header-h override at 700px');
      const rootHex = hex(rootBlocks.join('\n'));
      assert.deepEqual([...rootHex], ['#7d6236', '#c9a86a'], 'the token block declares the two gold text colours, --gold-ink and --gold-bright (decision 2)');
      const outsideRoot = marketing.replace(/:root\s*\{[^}]*\}/g, '');
      const marketingHex = [...hex(outsideRoot)];
      const notInStyle = marketingHex.filter((h) => !styleHex.has(h) && h !== '#7d6236' && h !== '#c9a86a');
      t.diagnostic(`marketing.css hex literals outside :root: ${marketingHex.join(', ') || 'none'}; not in style.css (and not the gold text tokens): ${notInStyle.join(', ') || 'none'}`);
      assert.deepEqual(notInStyle, [], 'no colour that style.css does not already use, other than the gold text tokens');
      // Every rgba() is a brand colour at an alpha: cream, espresso, the photo shade, gold (the input focus halo) or the shadow.
      const rgba = marketing.match(/rgba?\([^)]*\)/g) || [];
      const styleRgba = new Set(style.match(/rgba?\([^)]*\)/g) || []);
      t.diagnostic(`marketing.css rgba(): ${rgba.join(', ')}; new alpha variants vs style.css: ${rgba.filter((r) => !styleRgba.has(r)).join(', ') || 'none'}`);
      assert.ok(rgba.every((r) => /^rgba\((244,239,229|57,38,29|37,23,16|185,152,93|45,27,20),/.test(r)), 'every rgba() is a brand colour at an alpha');
      for (const file of ['public/marketing.css', 'public/style.css', 'public/index.html', 'public/pros.html', 'public/invite.html', 'public/privacy.html', 'public/404.html']) {
        assert.doesNotMatch(read(file), /@import|fonts\.googleapis|fonts\.gstatic|typekit|\.woff|url\([^)]*font/i, `${file}: no webfont, no @import`);
      }
      // The only @font-face rules are the Georgia fallback (local() sources only, size-adjusted; DESIGN.md "Type").
      const faces = marketing.match(/@font-face\s*\{[^}]*\}/g) || [];
      assert.equal(faces.length, 2, 'the fallback face: upright and italic');
      for (const face of faces) {
        assert.match(face, /font-family:'Courtside Serif Fallback'/);
        assert.match(face, /size-adjust:\s*\d+%/);
        assert.match(face, /ascent-override|descent-override/);
        assert.doesNotMatch(face, /url\(/, 'local() sources only');
        assert.ok(/src:(local\([^)]*\),?)+;/.test(face.replace(/\s+/g, '')), `src is local() only: ${face}`);
      }
      assert.match(marketing, /--serif:\s*Georgia,\s*'Courtside Serif Fallback',\s*serif/, '--serif lists Georgia, then the fallback');
      assert.doesNotMatch(style, /@font-face|Courtside Serif Fallback/, 'style.css is untouched');
      // No font-family literal outside the token block and the @font-face rules.
      const noTokens = marketing.replace(/:root\s*\{[^}]*\}/g, '').replace(/@font-face\s*\{[^}]*\}/g, '');
      const families = noTokens.match(/font-family\s*:[^;}]+/g) || [];
      assert.ok(families.every((f) => /var\(--(serif|sans)\)/.test(f)), `font-family only through tokens (${families.join(' | ')})`);
      const fontShorthands = noTokens.match(/\bfont:[^;}]+/g) || [];
      assert.ok(fontShorthands.every((f) => /var\(--serif\)|var\(--sans\)/.test(f)), `every font: shorthand ends in a token (${fontShorthands.join(' | ')})`);
      for (const route of ['/', '/pros']) {
        const page = await open();
        await page.goto(route);
        const fonts = await page.evaluate(() => [...document.querySelectorAll('h1, h2, h3, h4')].map((h) => ({ tag: h.tagName, cls: h.className, family: getComputedStyle(h).fontFamily, weight: getComputedStyle(h).fontWeight })));
        const notGeorgia = fonts.filter((f) => !/^Georgia/.test(f.family));
        t.diagnostic(`${route}: ${fonts.length} headings; not Georgia: ${notGeorgia.map((f) => `${f.tag}.${f.cls} ${f.family}`).join('; ') || 'none'}`);
        // h3.profile-label is a small-caps label in the sans stack by design (marketing.css), so it is reported, not failed.
        assert.deepEqual(notGeorgia.filter((f) => !/profile-label/.test(f.cls)), [], 'Georgia on headings');
        assert.ok(fonts.filter((f) => /^Georgia/.test(f.family)).every((f) => f.weight === '400'), 'serif headings are weight 400');
        assert.ok(fonts.filter((f) => /^Georgia/.test(f.family)).every((f) => /Courtside Serif Fallback/.test(f.family)), 'the computed stack carries the fallback face');
        await page.close2();
      }
    });

    test('style.css and gate.js are unchanged versus main; site.html gains one <style> line (view transitions, decision 4); site.js differs only in the three redirect targets', (t) => {
      let hasMain = true;
      try { execFileSync('git', ['rev-parse', '--verify', 'main'], { cwd: ROOT, stdio: 'pipe' }); } catch { hasMain = false; }
      if (!hasMain) { t.skip('no main branch to diff against'); return; }
      const frozen = execFileSync('git', ['diff', 'main', '--', 'public/style.css', 'public/js/gate.js'], { cwd: ROOT, encoding: 'utf8' });
      assert.equal(frozen, '', 'git diff main -- public/style.css public/js/gate.js is empty');
      const siteHtml = execFileSync('git', ['diff', 'main', '--', 'public/site.html'], { cwd: ROOT, encoding: 'utf8' });
      const siteLines = siteHtml.split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
      t.diagnostic(`site.html changed lines: ${JSON.stringify(siteLines)}`);
      assert.deepEqual(siteLines, ['+<style>@view-transition{navigation:auto}@media (prefers-reduced-motion:reduce){@view-transition{navigation:none}}</style>'], 'exactly one added line: the view-transition opt-in');
      const siteJs = execFileSync('git', ['diff', 'main', '--', 'public/js/site.js'], { cwd: ROOT, encoding: 'utf8' });
      const changed = siteJs.split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
      t.diagnostic(`site.js changed lines: ${changed.length}`);
      assert.equal(changed.length, 6, 'three removed + three added lines');
      assert.ok(changed.filter((l) => l.startsWith('-')).every((l) => l.includes("location.replace('/')")), 'each removed line is a redirect to /');
      assert.ok(changed.filter((l) => l.startsWith('+')).every((l) => l.includes("location.replace('/invite')")), 'each added line is a redirect to /invite');
      assert.equal(changed.filter((l) => l.startsWith('+')).length, 3);
    });
  });

  describe('13. README', () => {
    test('documents /, /pros, /invite, /privacy, the 404, the personal-link format, npm run images, the waitlist and the data files; every public/js file it names exists', (t) => {
      const readme = read('README.md');
      assert.match(readme, /\| `\/` \| `public\/index\.html` \|/, 'pages table: /');
      assert.match(readme, /\| `\/pros` \| `public\/pros\.html` \|/, 'pages table: /pros');
      assert.match(readme, /\| `\/invite` \| `public\/invite\.html` \|/, 'pages table: /invite');
      assert.match(readme, /`public\/404\.html`/, 'the 404 page is documented');
      assert.match(readme, /https:\/\/<domain>\/invite\?invite=CODE/, 'personal-link format');
      assert.match(readme, /npm run images/);
      assert.match(readme, /public\/js\/trips\.js/);
      assert.match(readme, /public\/js\/pros\.js/);
      assert.match(readme, /POST \/api\/waitlist/, 'the waitlist route is documented');
      assert.match(readme, /POST \/api\/event/, 'the event route is documented');
      assert.match(readme, /\| Waitlist \| `timestamp, email, name, trip, source` \|/, 'the Waitlist tab columns');
      const named = [...new Set([...readme.matchAll(/public\/js\/([a-z-]+\.js)/g)].map((m) => m[1]))];
      const missing = named.filter((f) => !fs.existsSync(path.join(ROOT, 'public/js', f)));
      t.diagnostic(`README names public/js/: ${named.join(', ')}; missing on disk: ${missing.join(', ') || 'none'}`);
      const tripFields = readme.match(/`public\/js\/trips\.js`[^\n]*\(([^)]*)\)/)?.[1] || '';
      const actual = Object.keys(TRIPS[0]);
      const wrong = [...tripFields.matchAll(/`([a-zA-Z]+)`/g)].map((m) => m[1]).filter((f) => !actual.includes(f));
      t.diagnostic(`README trips.js fields not in the file: ${wrong.join(', ') || 'none'} (file has ${actual.join(', ')})`);
      const widths = readme.match(/widths [^)]*\)/)?.[0] || '';
      const manifest = JSON.parse(read('public/assets/derived/manifest.json'));
      const realWidths = [...new Set(Object.values(manifest).flatMap((m) => m.variants.map((v) => v.width)))].sort((a, b) => a - b);
      t.diagnostic(`README says "${widths}"; derived/ really holds widths ${realWidths.join(', ')} (make-images caps at the original width; crops add their own)`);
      assert.deepEqual(missing, [], 'every public/js file the README names exists');
      assert.deepEqual(wrong, [], 'README lists the fields trips.js really has');
    });
  });
});
