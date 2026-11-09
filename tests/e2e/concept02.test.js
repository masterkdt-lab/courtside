// tests/e2e/concept02.test.js
// The Concept 02 frontend (public/: index.html, pages.js, app.js) wired to the Sheets-backed routes, in
// mock mode (CONCEPT02_PLAN.md, "Tests" and "Frontend contracts"). Playwright (library) drives headless
// Chromium against a dev server started in this process on a free port with a temp mock file; every
// request that would leave 127.0.0.1 is aborted and recorded, so the suite never touches the network and
// also proves the page makes no external requests. Each test opens its own context (fresh localStorage,
// its own client IP for the rate limits) and starts from an empty mock store.
//
// Run: npm run test:e2e   (needs `npx playwright install chromium`)
// Set E2E_SCREENSHOT_DIR=/some/dir to save full-page screenshots of the wired pages at 390 and 1440.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { NOINDEX, ROOT, editMock, freshIp, http, readMock, resetMock, startServer, useTempMock } from './helpers.js';

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
// The copy sweep for the wired flows: none of these words may remain on them.
const DEMO_WORDS = /\b(demo|simulated|sample|walkthrough)\b|nothing (is|has been) sent|subscribed/i;
const REQUEST_ID = /^CS-[A-Z0-9]{8}$/;

let srv;
let browser;
const contexts = new Set();

// A context with its own IP (rate limits), external requests aborted and recorded, and a collector for
// every uncaught exception and console.error (Chromium's own "Failed to load resource" lines for the
// non-2xx API answers a test provokes on purpose are kept apart in page.resourceErrors()).
async function open({ viewport = DESKTOP, ip = freshIp() } = {}) {
  const context = await browser.newContext({ baseURL: srv.base, viewport, extraHTTPHeaders: { 'x-forwarded-for': ip } });
  contexts.add(context);
  const external = [];
  await context.route((url) => !url.href.startsWith(srv.base), (route) => { external.push(route.request().url()); return route.abort(); });
  const page = await context.newPage();
  const errors = [];
  const resources = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    (/^Failed to load resource/.test(msg.text()) ? resources : errors).push(`console.error: ${msg.text()}`);
  });
  page.errors = () => errors;
  page.resourceErrors = () => resources;
  page.external = () => external;
  page.context2 = context;
  page.close2 = async () => { await context.close(); contexts.delete(context); };
  return page;
}

// Load a hash route in a fresh document and wait for the SPA to render it.
async function visit(page, hash, { query = '' } = {}) {
  await page.goto(`/${query}${hash}`);
  await page.waitForFunction(() => document.querySelector('#main .route-fade') !== null);
}
const hashIs = (page, hash) => page.waitForFunction((h) => location.hash === h, hash, { timeout: 8000 });
// A public page has a real address and no hash route.
const pathIs = (page, p) => page.waitForFunction((x) => location.pathname === x && location.hash === '', p, { timeout: 8000 });
// Load a real page address in a fresh document and wait for the SPA to render it.
async function visitPath(page, url) {
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('#main .route-fade') !== null);
}
const mainText = (page) => page.locator('#main').evaluate((el) => el.innerText.replace(/\s+/g, ' ').trim());
// A section of the mock store, or [] while the file does not exist yet (nothing has been written since resetMock()).
const rows = (section) => (fs.existsSync(process.env.MOCK_DATA_PATH) ? readMock()[section] || [] : []);
const eyebrowHas = (page, text) => page.waitForFunction((t) => (document.querySelector('#main .eyebrow')?.textContent || '').includes(t), text);
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true }); };

async function sessionCookie(page) {
  const cookies = await page.context2.cookies(srv.base);
  return cookies.find((c) => c.name === 'cs_session') || null;
}

// The new routes keep their own double-submit maps and the lineup cache; a reset between tests mirrors
// resetServerState() in helpers.js for the modules that file predates.
async function resetConcept02Modules() {
  const [inquiry, application, lineup] = await Promise.all([
    import('../../api/inquiry.js'), import('../../api/application.js'), import('../../api/lineup.js'),
  ]);
  inquiry._resetDoubleSubmit?.();
  application._resetDoubleSubmit?.();
  lineup._resetLineupCache?.();
}

// Walk the #/request flow to the review step. weeks: week ids and/or 'flexible'.
async function fillRequest(page, { path: kind, weeks, players, partners, party, level, tennis, name, email, notes = '' }) {
  await visit(page, `#/request/${kind}`);
  await page.waitForSelector('input[name=week][value=w1]');
  for (const w of weeks) await page.check(`input[name=week][value=${w}]`);
  await page.click('form[data-draft] button.btn');
  await eyebrowHas(page, 'STEP 2');
  if (kind === 'group') {
    if (players) await page.selectOption('select[name=players]', players);
    if (partners) await page.selectOption('select[name=partners]', partners);
  } else {
    if (party) await page.selectOption('select[name=party]', party);
    if (level) await page.selectOption('select[name=level]', level);
  }
  if (tennis) await page.selectOption('select[name=tennis]', tennis);
  await page.click('form[data-draft] button.btn');
  await eyebrowHas(page, 'STEP 3');
  await page.fill('input[name=name]', name);
  await page.fill('input[name=email]', email);
  if (notes) await page.fill('textarea[name=notes]', notes);
  await page.click('form[data-draft] button.btn');
  await eyebrowHas(page, 'REVIEW');
}

describe('Concept 02 frontend (mock store)', { skip: playwright ? false : 'playwright is not installed' }, () => {
  before(async () => {
    useTempMock('courtside-c02-');
    srv = await startServer();
    browser = await playwright.chromium.launch();
  });

  beforeEach(async () => {
    await resetMock();
    await resetConcept02Modules();
  });

  after(async () => {
    for (const context of contexts) await context.close().catch(() => {});
    await browser?.close();
    await srv?.close();
  });

  test('the shell: head tags, no prototype bar, no public links to the demo views', async () => {
    const res = await http(srv.base, '/');
    assert.equal(res.status, 200);
    const html = res.text;
    assert.doesNotMatch(html, NOINDEX, 'the homepage is indexable');
    assert.match(html, /<meta name="robots" content="index,follow/);
    assert.match(html, /<script type="application\/ld\+json">/);
    assert.match(html, /<title>Courtside Travel Co\. — Hosted tennis trips with your pro<\/title>/);
    assert.match(html, /<link rel="icon" href="\/favicon\.svg"/);
    assert.match(html, /<link rel="apple-touch-icon" href="\/assets\/icons\/apple-touch-icon\.png">/);
    assert.match(html, /<link rel="canonical" href="https:\/\/courtsidetravel\.co\/">/);
    assert.match(html, /property="og:image" content="https:\/\/courtsidetravel\.co\/assets\/og\/home\.jpg"/);
    assert.match(html, /<link rel="stylesheet" href="\/styles\.css">/);
    assert.match(html, /<script src="\/app\.js">/);
    assert.doesNotMatch(html, /prototypebar|data-view=|#\/guide|#\/host-desk|#\/operations/);
    assert.doesNotMatch(html, /https?:\/\/(?!courtsidetravel\.co|schema\.org)/, 'no external URLs in the shell (schema.org is the JSON-LD vocabulary, not a request)');

    const page = await open();
    await visit(page, '#/');
    assert.equal(await page.locator('.prototypebar').count(), 0);
    assert.equal(await page.locator('a[href="#/guide"], a[href="#/host-desk"], a[href="#/operations"]').count(), 0);
    await visit(page, '#/apply');
    assert.equal(await page.locator('a[href="#/host-desk"]').count(), 0, 'the apply hero has no "Preview a host’s view"');
    await page.close2();
  });

  test('no page errors, no console errors and no external requests on the public pages, at 390 and 1440', async () => {
    for (const viewport of [MOBILE, DESKTOP]) {
      const page = await open({ viewport });
      for (const url of ['/', '/trips', '/trips/spanish-offseason', '/hosts/katie', '/about', '/apply', '/invite', '/#/start', '/#/waitlist', '/#/application']) {
        await visitPath(page, url);
        await page.waitForTimeout(150);
        await shot(page, `${viewport.width}-${url.replace(/[#/]+/g, '-').replace(/^-|-$/g, '') || 'home'}`);
      }
      await page.goto('/privacy');
      await page.waitForTimeout(150);
      assert.deepEqual(page.errors(), [], `errors at ${viewport.width}`);
      assert.deepEqual(page.resourceErrors(), [], `resource errors at ${viewport.width}`);
      assert.deepEqual(page.external(), [], `external requests at ${viewport.width}`);
      await page.close2();
    }
  });

  test('invite: GUEST1 sets the session cookie and lands on the trip page', async () => {
    const page = await open();
    await visit(page, '#/invite');
    const text = await mainText(page);
    assert.doesNotMatch(text, /JEFF/);
    assert.doesNotMatch(text, DEMO_WORDS);
    assert.equal(await page.locator('input[name=website]').count(), 1, 'honeypot present');
    await page.fill('input[name=code]', 'guest1');
    await page.click('#main form button.btn');
    await pathIs(page, '/trips/spanish-offseason');
    const cookie = await sessionCookie(page);
    assert.ok(cookie, 'cs_session cookie set');
    assert.ok(cookie.httpOnly);
    assert.equal(rows('invites').find((i) => i.code === 'GUEST1').uses, 1);
    assert.deepEqual(page.errors(), []);
    await page.close2();
  });

  test('invite: a bogus code lands on #/invite-unavailable; a paused code says so', async () => {
    const page = await open();
    await visit(page, '#/invite');
    await page.fill('input[name=code]', 'NOPE999');
    await page.click('#main form button.btn');
    await hashIs(page, '#/invite-unavailable');
    let text = await mainText(page);
    assert.match(text, /That code isn’t recognized\./);
    assert.doesNotMatch(text, /JEFF/);
    assert.doesNotMatch(text, DEMO_WORDS);
    assert.equal(await sessionCookie(page), null);

    await page.click('#main a[href="/invite"]');
    await pathIs(page, '/invite');
    await page.fill('input[name=code]', 'PAUSED1');
    await page.click('#main form button.btn');
    await hashIs(page, '#/invite-unavailable');
    text = await mainText(page);
    assert.match(text, /This invitation is paused\. Reach out to Katie\./);
    assert.deepEqual(page.errors(), []);
    await page.close2();
  });

  test('invite: #/invite?code=GUEST1 prefills and auto-submits; /invite?code=, /?invite= and /?code= get there too', async () => {
    for (const url of ['/#/invite?code=GUEST1', '/invite?code=GUEST1', '/invite?invite=GUEST1', '/?invite=GUEST1', '/?code=GUEST1']) {
      const page = await open();
      await page.goto(url);
      await pathIs(page, '/trips/spanish-offseason');
      assert.ok(await sessionCookie(page), url);
      assert.match(await page.title(), /^The Spanish Offseason/, url);
      assert.deepEqual(page.errors(), [], url);
      await page.close2();
    }
  });

  test('request: a group request writes one private Requests row and shows the reference', async () => {
    const page = await open();
    await fillRequest(page, {
      path: 'group', weeks: ['w5', 'w6'], players: '6', partners: '2', tennis: 'Daily tennis',
      name: 'Group Tester', email: 'Group.Tester@example.com', notes: 'A birthday that week.',
    });
    let text = await mainText(page);
    assert.match(text, /Possible dates Feb 7–13, Feb 14–20/, 'the review step shows the week labels');
    assert.doesNotMatch(text, DEMO_WORDS);
    assert.match(text, /Send request/);
    assert.equal(await page.locator('form[data-draft] a[href="/privacy"][target=_blank]').count(), 1, 'consent line links /privacy');
    await page.check('input[name=consent]');
    await page.click('form[data-draft] button.btn');
    await hashIs(page, '#/received');

    const requests = rows('requests');
    assert.equal(requests.length, 1);
    const row = requests[0];
    assert.match(row.request_id, REQUEST_ID);
    assert.equal(row.trip_id, 'spain');
    assert.equal(row.request_type, 'private');
    assert.equal(row.weeks, 'Feb 7–13, Feb 14–20');
    assert.equal(row.guest_name, 'Group Tester');
    assert.equal(row.guest_email, 'group.tester@example.com');
    assert.equal(String(row.players), '6');
    assert.equal(String(row.partners), '2');
    assert.equal(row.tennis, 'Daily tennis');
    assert.equal(row.note, 'A birthday that week.');
    assert.equal(row.party_type, '');
    assert.equal(row.level, '');
    assert.equal(row.status, 'New');
    assert.equal(row.invite_code, '', 'no cookie: the trip page is public');

    text = await mainText(page);
    assert.match(text, new RegExp(`REQUEST RECEIVED · ${row.request_id}`));
    assert.match(text, /Feb 7–13, Feb 14–20/);
    assert.doesNotMatch(text, DEMO_WORDS);
    assert.equal(await page.locator('#main a[href="#/operations"]').count(), 0);
    await shot(page, '1440-received');
    assert.deepEqual(page.errors(), []);
    await page.close2();
  });

  test('request: a match request writes one vetted Requests row and lands on #/match-home', async () => {
    const page = await open();
    await fillRequest(page, {
      path: 'match', weeks: ['flexible'], party: 'Couple', level: '4.0', tennis: 'Four mornings',
      name: 'Match Tester', email: 'match.tester@example.com',
    });
    assert.match(await mainText(page), /Possible dates Flexible/);
    await page.check('input[name=consent]');
    await page.click('form[data-draft] button.btn');
    await hashIs(page, '#/match-home');

    const requests = rows('requests');
    assert.equal(requests.length, 1);
    const row = requests[0];
    assert.match(row.request_id, REQUEST_ID);
    assert.equal(row.request_type, 'vetted');
    assert.equal(row.weeks, 'Flexible');
    assert.equal(row.guest_name, 'Match Tester');
    assert.equal(row.guest_email, 'match.tester@example.com');
    assert.equal(row.party_type, 'Couple');
    assert.equal(row.level, '4.0');
    assert.equal(row.tennis, 'Four mornings');
    assert.equal(String(row.players), '');
    assert.equal(row.status, 'New');

    const text = await mainText(page);
    assert.match(text, new RegExp(`YOUR GROUP REQUEST · ${row.request_id}`));
    assert.match(text, /Possible dates Flexible/);
    assert.doesNotMatch(text, DEMO_WORDS);
    assert.equal(await page.locator('#main a[href="#/operations"]').count(), 0);
    await shot(page, '1440-match-home');
    assert.deepEqual(page.errors(), []);
    await page.close2();
  });

  test('request: a week that closes before the send is reported inline and goes back to step 1 unchecked', async () => {
    const page = await open();
    await fillRequest(page, {
      path: 'group', weeks: ['w3'], tennis: 'Four mornings', name: 'Closed Week', email: 'closed.week@example.com',
    });
    await editMock((d) => { d.weeks.find((w) => w.week_id === 'w3').status = 'closed'; });
    await resetConcept02Modules();
    await page.check('input[name=consent]');
    await page.click('form[data-draft] button.btn');
    await eyebrowHas(page, 'STEP 1');
    await page.waitForSelector('.form-status.error');
    assert.match(await page.locator('.form-status.error').textContent(), /closed/i);
    await page.waitForFunction(() => document.querySelector('input[name=week][value=w3]')?.disabled === true);
    assert.equal(await page.locator('input[name=week][value=w3]').isChecked(), false);
    assert.equal(rows('requests').length, 0);
    assert.deepEqual(page.errors(), []);
    await page.close2();
  });

  test('request: week options come from the lineup; a closed week is disabled with its message', async () => {
    await editMock((d) => {
      const w1 = d.weeks.find((w) => w.week_id === 'w1');
      w1.status = 'closed';
      w1.closed_message = 'This week is full.';
    });
    await resetConcept02Modules();
    const page = await open();
    await visit(page, '#/request/group');
    await page.waitForSelector('input[name=week][value=w7]');
    assert.equal(await page.locator('input[name=week]').count(), 8, 'seven weeks + flexible');
    assert.equal(await page.locator('input[name=week][value=w1]').isDisabled(), true);
    assert.match(await page.locator('label.option.disabled').first().textContent(), /This week is full\./);
    assert.equal(await page.locator('input[name=week][value=flexible]').count(), 1);
    assert.doesNotMatch(await mainText(page), DEMO_WORDS);
    await page.close2();
  });

  test('waitlist page and home form each write a Waitlist row with their source', async () => {
    let page = await open();
    await visit(page, '#/waitlist');
    let text = await mainText(page);
    assert.doesNotMatch(text, DEMO_WORDS);
    assert.match(text, /Keep me posted/);
    await page.fill('input[name=name]', 'Waitlist Tester');
    await page.fill('input[name=email]', 'waitlist.tester@example.com');
    await page.selectOption('select[name=interest]', 'Charleston · future idea');
    await page.check('input[name=consent]');
    await page.click('#main form button.btn');
    await hashIs(page, '#/waitlist-done');
    text = await mainText(page);
    assert.match(text, /Courtside will be in touch about the trips you chose\./);
    assert.doesNotMatch(text, DEMO_WORDS);
    assert.deepEqual(page.errors(), []);
    await page.close2();

    page = await open();
    await visit(page, '#/');
    text = await page.locator('.newsletter').evaluate((el) => el.textContent);
    assert.doesNotMatch(text, DEMO_WORDS);
    await page.fill('.newsletter input[name=email]', 'home.tester@example.com');
    await page.check('.newsletter input[name=consent]');
    await page.click('.newsletter form button.btn');
    await hashIs(page, '#/waitlist-done');
    assert.deepEqual(page.errors(), []);
    await page.close2();

    const waitlist = rows('waitlist');
    assert.equal(waitlist.length, 2);
    assert.equal(waitlist[0].email, 'waitlist.tester@example.com');
    assert.equal(waitlist[0].name, 'Waitlist Tester');
    assert.equal(waitlist[0].source, 'concept02-waitlist');
    assert.equal(waitlist[0].trip, 'Charleston');
    assert.equal(waitlist[1].email, 'home.tester@example.com');
    assert.equal(waitlist[1].source, 'concept02-home');
    assert.equal(waitlist[1].trip, 'Future Courtside experiences');
  });

  test('waitlist: a server error stays on the form with an inline message', async () => {
    const page = await open();
    await visit(page, '#/waitlist');
    await page.route('**/api/waitlist', (route) => route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ ok: false, reason: 'rate_limited' }) }));
    await page.fill('input[name=email]', 'limited@example.com');
    await page.check('input[name=consent]');
    await page.click('#main form button.btn');
    await page.waitForSelector('.form-status.error');
    assert.equal(await page.locator('.form-status.error').textContent(), 'Too many attempts. Try again in a few minutes.');
    assert.equal(await page.evaluate(() => location.hash), '#/waitlist');
    assert.equal(await page.locator('#main form button.btn').isDisabled(), false, 'the button is re-enabled');
    assert.equal(rows('waitlist').length, 0);
    assert.deepEqual(page.errors(), []);
    await page.close2();
  });

  test('application writes one HostApplications row and shows the received page', async () => {
    const page = await open();
    await visit(page, '#/application');
    let text = await mainText(page);
    assert.doesNotMatch(text, DEMO_WORDS);
    assert.match(text, /Send application/);
    await page.fill('input[name=name]', 'Application Tester');
    await page.fill('input[name=email]', 'application.tester@example.com');
    await page.fill('input[name=club]', 'Test Club, Austin');
    await page.fill('input[name=referral]', 'Katie');
    await page.fill('textarea[name=background]', 'Fifteen years coaching.');
    await page.fill('textarea[name=community]', 'Forty regulars.');
    await page.fill('input[name=destination]', 'Portugal');
    await page.check('input[name=consent]');
    await page.click('#main form button.btn');
    await hashIs(page, '#/application-done');
    text = await mainText(page);
    assert.match(text, /Katie and Courtside review every application and will be in touch to arrange a conversation\./);
    assert.doesNotMatch(text, DEMO_WORDS);
    assert.equal(await page.locator('#main a[href="/trips/spanish-offseason"]').count(), 1);
    assert.equal(await page.locator('#main a[href="/"]').count(), 1);
    assert.equal(await page.locator('#main a[href="#/host-desk"], #main a[href="#/operations"]').count(), 0);

    const apps = rows('host_applications');
    assert.equal(apps.length, 1);
    assert.equal(apps[0].name, 'Application Tester');
    assert.equal(apps[0].email, 'application.tester@example.com');
    assert.equal(apps[0].club, 'Test Club, Austin');
    assert.equal(apps[0].referral, 'Katie');
    assert.equal(apps[0].background, 'Fifteen years coaching.');
    assert.equal(apps[0].community, 'Forty regulars.');
    assert.equal(apps[0].destination, 'Portugal');
    assert.match(apps[0].timestamp, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(page.errors(), []);
    await page.close2();
  });

  test('demo views: #/host-desk shows the home page without the flag and the desk with ?demo=1', async () => {
    const page = await open();
    await visit(page, '#/host-desk');
    assert.match(await mainText(page), /Tennis takes you further\./);
    await visit(page, '#/operations');
    assert.match(await mainText(page), /Tennis takes you further\./);
    await visit(page, '#/guide');
    assert.match(await mainText(page), /Tennis takes you further\./);

    await visit(page, '#/host-desk?demo=1');
    assert.match(await mainText(page), /HOST HOME/);
    assert.equal(await page.evaluate(() => localStorage.getItem('courtside-demo')), '1');
    await visit(page, '#/operations');
    assert.match(await mainText(page), /COURTSIDE TEAM/);
    await visit(page, '#/guide');
    assert.match(await mainText(page), /WALKTHROUGH/);
    assert.deepEqual(page.errors(), []);
    await page.close2();
  });

  test('copy sweep: the footer and the wired pages carry no demo wording', async () => {
    const page = await open();
    await visit(page, '#/');
    const footer = await page.locator('footer.foot').evaluate((el) => el.textContent);
    assert.doesNotMatch(footer, DEMO_WORDS);
    assert.equal(await page.locator('footer.foot a[href="#/guide"]').count(), 0);
    for (const hash of ['#/invite', '#/start', '#/waitlist', '#/application', '#/application-done', '#/waitlist-done']) {
      await visit(page, hash);
      assert.doesNotMatch(await mainText(page), DEMO_WORDS, hash);
    }
    assert.deepEqual(page.errors(), []);
    await page.close2();
  });

  test('privacy.html and 404.html are still served and link the real page paths', async () => {
    const privacy = await http(srv.base, '/privacy');
    assert.equal(privacy.status, 200);
    assert.match(privacy.text, NOINDEX);
    assert.doesNotMatch(privacy.text, /href="\/pros"|href="\/?#\/(trip|trips|host|about|apply|invite)"/);
    const missing = await http(srv.base, '/nothing-here');
    assert.equal(missing.status, 404);
    assert.match(missing.text, /href="\/invite"/);
    assert.doesNotMatch(missing.text, /href="\/#\//);
    assert.ok(fs.existsSync(path.join(ROOT, 'public', 'js', 'trips.js')), 'public/js/trips.js stays for lib/lineup.js');
  });
});
