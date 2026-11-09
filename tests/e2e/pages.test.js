// tests/e2e/pages.test.js
// Real page addresses for the public pages and the consent banner + GA4 (2026-11-09), in mock mode against a
// dev server started in this process. Every request that would leave 127.0.0.1 is aborted and recorded, except
// in the consent tests, which serve public/analytics.js with a fake measurement ID and answer the
// googletagmanager.com request with a stub (Google is never contacted).
//
// Run: npm run test:e2e   (needs `npx playwright install chromium`)

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { NOINDEX, ROOT, freshIp, http, readMock, resetMock, startServer, useTempMock } from './helpers.js';
import { PAGES } from '../../scripts/make-pages.js';

let playwright = null;
try {
  playwright = await import('playwright');
} catch {
  playwright = null;
}

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };
const FAKE_ID = 'G-TEST12345';
const ANALYTICS = fs.readFileSync(path.join(ROOT, 'public', 'analytics.js'), 'utf8');
const HOME_TITLE = 'Courtside Travel Co. — Hosted tennis trips with your pro';

let srv;
let browser;
const contexts = new Set();

async function open({ viewport = DESKTOP, ip = freshIp(), gaId = '' } = {}) {
  const context = await browser.newContext({ baseURL: srv.base, viewport, extraHTTPHeaders: { 'x-forwarded-for': ip } });
  contexts.add(context);
  const external = [];
  const gtm = [];
  await context.route((url) => !url.href.startsWith(srv.base), (route) => { external.push(route.request().url()); return route.abort(); });
  if (gaId) {
    // Registered later, so these run first (Playwright runs matching routes in reverse registration order).
    await context.route(/^https:\/\/www\.googletagmanager\.com\//, (route) => {
      gtm.push(route.request().url());
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.__gtagStub=(window.__gtagStub||0)+1;' });
    });
    await context.route(`${srv.base}/analytics.js`, (route) => route.fulfill({
      status: 200, contentType: 'text/javascript; charset=utf-8', body: ANALYTICS.replace(/const GA_MEASUREMENT_ID = '[^']*';/, `const GA_MEASUREMENT_ID = '${gaId}';`),
    }));
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/^Failed to load resource/.test(msg.text())) errors.push(`console.error: ${msg.text()}`);
  });
  page.errors = () => errors;
  page.external = () => external;
  page.gtm = () => gtm;
  page.close2 = async () => { await context.close(); contexts.delete(context); };
  return page;
}

const rendered = (page) => page.waitForFunction(() => document.querySelector('#main .route-fade') !== null);
async function visit(page, url) {
  await page.goto(url);
  await rendered(page);
}
const pathIs = (page, p) => page.waitForFunction((x) => location.pathname === x && location.hash === '', p, { timeout: 8000 });
const hashIs = (page, h) => page.waitForFunction((x) => location.pathname === '/' && location.hash === x, h, { timeout: 8000 });
const mainText = (page) => page.locator('#main').evaluate((el) => el.innerText.replace(/\s+/g, ' ').trim());
const textShows = (page, t) => page.waitForFunction((x) => (document.querySelector('#main')?.innerText || '').replace(/\s+/g, ' ').includes(x), t, { timeout: 8000 });
const dataLayer = (page) => page.evaluate(() => (window.dataLayer || []).map((a) => JSON.parse(JSON.stringify(Array.from(a)))));
const pageViews = async (page) => (await dataLayer(page)).filter((a) => a[0] === 'event' && a[1] === 'page_view').map((a) => a[2]);
const consent = (page) => page.evaluate(() => localStorage.getItem('courtside-consent'));
const bannerVisible = (page) => page.evaluate(() => { const b = document.getElementById('cs-consent'); return !!b && !b.hidden && b.getBoundingClientRect().height > 0; });

describe('Real page addresses and consent (mock store)', { skip: playwright ? false : 'playwright is not installed' }, () => {
  before(async () => {
    useTempMock('courtside-pages-');
    srv = await startServer();
    browser = await playwright.chromium.launch();
  });
  beforeEach(async () => { await resetMock(); });
  after(async () => {
    for (const context of contexts) await context.close().catch(() => {});
    await browser?.close();
    await srv?.close();
  });

  test('each public path returns 200 HTML with its own title, canonical and noscript, and the SPA renders that view', async () => {
    const seen = new Set();
    const page = await open();
    for (const p of PAGES) {
      const res = await http(srv.base, p.path);
      assert.equal(res.status, 200, p.path);
      assert.match(res.headers.get('content-type'), /^text\/html/);
      const title = res.text.match(/<title>([^<]*)<\/title>/)[1];
      assert.ok(!seen.has(title), `${p.path} has its own title`);
      seen.add(title);
      assert.match(res.text, new RegExp(`<link rel="canonical" href="https://courtsidetravel\\.co${p.path}">`));
      assert.match(res.text, /<noscript><section class="wrap"><h1>/);
      if (p.path === '/invite') assert.match(res.text, NOINDEX);
      else assert.doesNotMatch(res.text, NOINDEX);
      await visit(page, p.path);
      assert.equal(await page.title(), p.title, `${p.path}: the SPA keeps the page title`);
      assert.equal(await page.locator('#main noscript').count(), 0, 'the view replaced the summary');
    }
    await visit(page, '/');
    assert.equal(await page.title(), HOME_TITLE);
    assert.match(await mainText(page), /Tennis takes you further\./);
    await visit(page, '/trips/spanish-offseason');
    assert.match(await mainText(page), /Request your place/);
    await visit(page, '/hosts/katie');
    assert.match(await mainText(page), /Katie’s full bio is coming soon\./);
    assert.match(await mainText(page), /A LONG-TERM AMBITION/);
    await visit(page, '/trips');
    assert.match(await mainText(page), /More journeys coming soon\./);
    assert.equal(await page.locator('#main .image-tag', { hasText: 'COMING SOON' }).count(), 2);
    assert.deepEqual(page.errors(), []);
    // The real ID is configured (KC, 2026-11-09): the banner and Cookie settings are present, and still
    // nothing is requested from Google until the visitor clicks Allow.
    assert.deepEqual(page.external(), [], 'no external requests before consent');
    assert.equal(await page.locator('#cs-consent').count(), 1, 'the consent banner is present');
    assert.equal(await page.locator('#cs-cookie-settings').count(), 1, 'Cookie settings is in the footer');
    assert.equal(await page.evaluate(() => document.querySelectorAll('script[src*="googletagmanager"]').length), 0, 'gtag.js is not loaded before Allow');
    const consentDefault = await page.evaluate(() => (window.dataLayer || []).map((e) => Array.from(e)).find((e) => e[0] === 'consent' && e[1] === 'default'));
    assert.equal(consentDefault?.[2]?.analytics_storage, 'denied', 'Consent Mode defaults to denied');
    await page.close2();
  });

  test('the sitemap lists the six indexable paths', async () => {
    const res = await http(srv.base, '/sitemap.xml');
    assert.equal(res.status, 200);
    const locs = [...res.text.matchAll(/<loc>https:\/\/courtsidetravel\.co([^<]*)<\/loc>/g)].map((m) => m[1]);
    assert.deepEqual(locs, ['/', '/trips', '/trips/spanish-offseason', '/hosts/katie', '/about', '/apply']);
  });

  test('old /#/trip-style links land on the new path (the address is replaced, not pushed)', async () => {
    const page = await open();
    const map = [['#/trip', '/trips/spanish-offseason'], ['#/trips', '/trips'], ['#/host', '/hosts/katie'], ['#/about', '/about'], ['#/apply', '/apply'], ['#/', '/']];
    for (const [hash, target] of map) {
      await page.goto('about:blank');
      await visit(page, `/${hash}`);
      await pathIs(page, target);
      assert.equal(await page.title(), PAGES.find((p) => p.path === target)?.title || HOME_TITLE, hash);
      await page.goBack();
      assert.equal(await page.evaluate(() => location.href), 'about:blank', `${hash}: the old address is not left in history`);
    }
    // In-page: an old hash link clicked inside the SPA moves to the path as well.
    await visit(page, '/');
    await page.evaluate(() => { location.hash = '/trip'; });
    await pathIs(page, '/trips/spanish-offseason');
    await textShows(page, 'Request your place');
    assert.deepEqual(page.errors(), []);
    await page.close2();
  });

  test('navigation: links stay in the page, back/forward and a refresh on a deep path work, private flows keep hash routes', async () => {
    const page = await open();
    await visit(page, '/');
    await page.evaluate(() => { window.__sameDocument = true; });
    await page.click('header a[href="/trips"]');
    await pathIs(page, '/trips');
    await textShows(page, 'Where tennis');
    await page.click('#main a[href="/trips/spanish-offseason"]');
    await pathIs(page, '/trips/spanish-offseason');
    await textShows(page, 'Request your place');
    assert.equal(await page.title(), PAGES.find((p) => p.route === 'trip').title);
    await page.click('#main a.hostinline');
    await pathIs(page, '/hosts/katie');
    await textShows(page, 'Katie Delich.');
    assert.equal(await page.evaluate(() => window.__sameDocument), true, 'no full page load so far');

    await page.goBack();
    await pathIs(page, '/trips/spanish-offseason');
    await textShows(page, 'The week, at a glance.');
    await page.goBack();
    await pathIs(page, '/trips');
    await textShows(page, 'Where tennis');
    await page.goForward();
    await pathIs(page, '/trips/spanish-offseason');
    await textShows(page, 'The week, at a glance.');

    await page.reload();
    await rendered(page);
    await textShows(page, 'The week, at a glance.');
    assert.equal(await page.title(), PAGES.find((p) => p.route === 'trip').title);

    // Into the private flow: the hash route lives at /#/…
    await page.evaluate(() => { window.__sameDocument = true; });
    await page.click('#main a[href="#/start"]');
    await hashIs(page, '#/start');
    await textShows(page, 'How would you');
    await page.click('#main a[href="#/request/group"]');
    await hashIs(page, '#/request/group');
    await page.waitForSelector('input[name=week][value=w1]');
    assert.equal(await page.evaluate(() => window.__sameDocument), true);
    await page.goBack();
    await hashIs(page, '#/start');
    await page.goBack();
    await pathIs(page, '/trips/spanish-offseason');
    await textShows(page, 'The week, at a glance.');

    // The breadcrumb and the footer.
    await page.click('#main .breadcrumb a[href="/trips"]');
    await pathIs(page, '/trips');
    await page.click('footer a[href="/about"]');
    await pathIs(page, '/about');
    await textShows(page, 'Travel with');
    await page.click('footer a[href="/privacy"]');
    await page.waitForURL(`${srv.base}/privacy`);
    assert.match(await page.locator('main h1').textContent(), /Privacy notice/);
    assert.equal(await page.evaluate(() => window.__sameDocument), undefined, '/privacy is its own page');
    assert.deepEqual(page.errors(), []);
    assert.deepEqual(page.external(), []);
    await page.close2();
  });

  test('a group request started from the trip page goes end to end through the hash routes', async () => {
    const page = await open();
    await visit(page, '/trips/spanish-offseason');
    await page.click('#main a[href="#/start"]');
    await hashIs(page, '#/start');
    await page.click('#main a[href="#/request/group"]');
    await page.waitForSelector('input[name=week][value=w2]');
    await page.check('input[name=week][value=w2]');
    await page.click('form[data-draft] button.btn');
    await textShows(page, 'STEP 2');
    await page.click('form[data-draft] button.btn');
    await textShows(page, 'STEP 3');
    await page.fill('input[name=name]', 'Path Tester');
    await page.fill('input[name=email]', 'path.tester@example.com');
    await page.click('form[data-draft] button.btn');
    await textShows(page, 'REVIEW');
    await page.check('input[name=consent]');
    await page.click('form[data-draft] button.btn');
    await hashIs(page, '#/received');
    const rows = readMock().requests;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].guest_email, 'path.tester@example.com');
    assert.equal(rows[0].weeks, 'Jan 17–23');
    assert.deepEqual(page.errors(), []);
    await page.close2();
  });

  test('the mobile menu links to the real paths and closes after navigating', async () => {
    const page = await open({ viewport: MOBILE });
    await visit(page, '/trips/spanish-offseason');
    await page.click('#navtoggle');
    assert.equal(await page.locator('#mobilenav').isVisible(), true);
    await page.click('#mobilenav a[href="/hosts/katie"]');
    await pathIs(page, '/hosts/katie');
    assert.equal(await page.locator('#mobilenav').isVisible(), false);
    await page.click('#navtoggle');
    await page.click('#mobilenav a[href="/#/group"]');
    await page.waitForFunction(() => location.pathname === '/' && ['#/group', '#/find-group'].includes(location.hash));
    assert.deepEqual(page.errors(), []);
    await page.close2();
  });

  test('consent with a measurement ID: nothing loads before Allow; Allow loads gtag.js and sends clean page views', async () => {
    const page = await open({ gaId: FAKE_ID });
    await visit(page, '/trips');
    await page.waitForSelector('#cs-consent:not([hidden])');
    const banner = page.locator('#cs-consent');
    assert.equal(await banner.getAttribute('aria-label'), 'Cookie choice');
    assert.match(await banner.innerText(), /We use analytics cookies to understand how people find Courtside\. Allow them\?/);
    assert.equal(await banner.locator('a[href="/privacy"]').count(), 1);
    assert.equal(await banner.locator('button').count(), 2);
    assert.equal(await page.locator('footer #cs-cookie-settings').count(), 1);
    await page.waitForTimeout(400);
    assert.deepEqual(page.gtm(), [], 'gtag.js is not requested before Allow');
    const layer = await dataLayer(page);
    assert.deepEqual(layer[0], ['consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' }]);
    assert.equal(layer.filter((a) => a[0] === 'event').length, 0, 'no events while undecided');
    assert.deepEqual((await page.context().cookies()).filter((c) => c.name.startsWith('_ga')), []);

    // Keyboard: Allow with Enter.
    await banner.locator('[data-consent=granted]').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__gtagStub === 1);
    assert.equal(page.gtm().length, 1);
    assert.equal(page.gtm()[0], `https://www.googletagmanager.com/gtag/js?id=${FAKE_ID}`);
    assert.equal(await consent(page), 'granted');
    assert.equal(await bannerVisible(page), false);
    let after = await dataLayer(page);
    assert.ok(after.some((a) => a[0] === 'consent' && a[1] === 'update' && a[2].analytics_storage === 'granted'));
    assert.ok(after.some((a) => a[0] === 'config' && a[1] === FAKE_ID && a[2].send_page_view === false));
    assert.deepEqual((await pageViews(page)).map((v) => v.page_location), [`${srv.base}/trips`]);

    // SPA navigations: public paths as they are, private hash routes as the route name only.
    await page.click('#main a[href="/trips/spanish-offseason"]');
    await pathIs(page, '/trips/spanish-offseason');
    await page.evaluate(() => { location.hash = '/join/CSM-ABCDEFGH'; });
    await page.waitForFunction(() => location.hash.startsWith('#/join') || location.hash === '#/find-group');
    await page.evaluate(() => { location.hash = '/invite?code=GUEST1'; });
    await page.waitForFunction(() => location.pathname === '/trips/spanish-offseason' && location.hash === '');
    await page.waitForTimeout(200);
    const views = (await pageViews(page)).map((v) => v.page_location.slice(srv.base.length));
    assert.deepEqual(views.slice(0, 3), ['/trips', '/trips/spanish-offseason', '/#/join']);
    assert.ok(views.includes('/#/invite'), views.join(' '));
    const serialized = JSON.stringify(await dataLayer(page));
    assert.doesNotMatch(serialized, /CSM-|CSG-|GUEST1|@/, 'no ids, codes or emails reach analytics');

    // A successful waitlist sign-up sends generate_lead with no personal data.
    await visit(page, '/#/waitlist');
    await page.fill('#main input[name=email]', 'lead.tester@example.com');
    await page.check('#main input[name=consent]');
    await page.click('#main form button.btn');
    await hashIs(page, '#/waitlist-done');
    const leads = (await dataLayer(page)).filter((a) => a[0] === 'event' && a[1] === 'generate_lead');
    assert.deepEqual(leads, [['event', 'generate_lead', { lead_type: 'waitlist' }]]);
    assert.doesNotMatch(JSON.stringify(await dataLayer(page)), /lead\.tester/);

    // Next visit: gtag.js loads on load, no banner.
    await visit(page, '/about');
    await page.waitForFunction(() => window.__gtagStub === 1);
    assert.equal(await bannerVisible(page), false);
    assert.deepEqual(page.external(), []);
    assert.deepEqual(page.errors(), []);
    await page.close2();
  });

  test('consent: No thanks loads nothing and is remembered; Cookie settings reopens the banner', async () => {
    const page = await open({ gaId: FAKE_ID, viewport: MOBILE });
    await visit(page, '/');
    await page.waitForSelector('#cs-consent:not([hidden])');
    await page.click('#cs-consent [data-consent=denied]');
    assert.equal(await consent(page), 'denied');
    assert.equal(await bannerVisible(page), false);
    await page.reload();
    await rendered(page);
    await page.waitForTimeout(400);
    assert.equal(await bannerVisible(page), false, 'the choice is remembered');
    assert.deepEqual(page.gtm(), []);

    await page.click('#cs-cookie-settings');
    assert.equal(await bannerVisible(page), true);
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.consent), 'granted', 'focus moves into the banner');
    await page.keyboard.press('Escape');
    assert.equal(await bannerVisible(page), false);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'cs-cookie-settings', 'focus returns to Cookie settings');
    assert.deepEqual(page.gtm(), []);

    await page.click('#cs-cookie-settings');
    await page.click('#cs-consent [data-consent=granted]');
    await page.waitForFunction(() => window.__gtagStub === 1);
    assert.equal(await consent(page), 'granted');

    // And back to No thanks: consent is withdrawn and any _ga cookie removed.
    await page.evaluate(() => { document.cookie = '_ga=GA1.1.123; path=/'; });
    await page.click('#cs-cookie-settings');
    await page.click('#cs-consent [data-consent=denied]');
    const last = (await dataLayer(page)).filter((a) => a[0] === 'consent').at(-1);
    assert.deepEqual(last, ['consent', 'update', { analytics_storage: 'denied' }]);
    assert.equal(await page.evaluate(() => document.cookie.includes('_ga=')), false);
    assert.deepEqual(page.errors(), []);
    await page.close2();
  });

  test('consent on /privacy: the banner and Cookie settings are there; Allow sends the /privacy page view', async () => {
    const page = await open({ gaId: FAKE_ID });
    await page.goto('/privacy');
    await page.waitForSelector('#cs-consent:not([hidden])');
    assert.equal(await page.locator('footer #cs-cookie-settings').count(), 1);
    assert.deepEqual(page.gtm(), []);
    await page.click('#cs-consent [data-consent=granted]');
    await page.waitForFunction(() => window.__gtagStub === 1);
    assert.deepEqual((await pageViews(page)).map((v) => v.page_location), [`${srv.base}/privacy`]);
    assert.deepEqual(page.errors(), []);
    await page.close2();
  });
});
