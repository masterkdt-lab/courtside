// tests/e2e/browser.test.js
// Section 8 of COURTSIDE_PHASE1_PLAN.md in a real browser: Playwright (library) driving headless
// Chromium against a dev server started in this process on a free port, mock store in a temp
// file, log-mode email. Remote images (the three https URLs in js/images.js) are answered with a
// 1x1 PNG so the suite never touches the network and no resource errors reach the console.
//
// Run: npm run test:e2e   (needs `npm i -D playwright && npx playwright install chromium`)
// Set E2E_SCREENSHOT_DIR=/some/dir to also save the 380 px screenshots.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import {
  WEEK_LABELS, freshIp, http, login, privateBody, readMock, resetMock, resetServerState, sentEmails, setAllWeeks, setTripStatus,
  setWeekStatus, startServer, useTempMock,
} from './helpers.js';

let playwright = null;
try {
  playwright = await import('playwright');
} catch {
  playwright = null;
}

const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const SHOTS = process.env.E2E_SCREENSHOT_DIR || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

let srv;
let browser;
const contexts = new Set();

// A context with its own IP (rate limits), optional cookie, stubbed remote images, and a console /
// page-error collector. page.errors() lists uncaught exceptions and console.error output (minus
// Chromium's own "Failed to load resource" lines, which page.resourceErrors() lists instead).
async function open({ cookie = null, viewport = { width: 1280, height: 900 }, ip = freshIp() } = {}) {
  const context = await browser.newContext({ baseURL: srv.base, viewport, extraHTTPHeaders: { 'x-forwarded-for': ip } });
  contexts.add(context);
  await context.route(/^https:\/\//, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1x1 }));
  if (cookie) await context.addCookies([{ name: 'cs_session', value: cookie, url: srv.base }]);
  const page = await context.newPage();
  const errors = [];
  const resources = []; // Chromium logs every non-2xx fetch/resource as "Failed to load resource"; kept apart from JS errors
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    (/^Failed to load resource/.test(msg.text()) ? resources : errors).push(`console.error: ${msg.text()}`);
  });
  page.errors = () => errors;
  page.resourceErrors = () => resources;
  page.close2 = async () => { await context.close(); contexts.delete(context); };
  return page;
}

async function loginToken(code = 'GUEST1') {
  return (await login(srv.base, code)).token;
}

// Navigate and wait for the page's own GET /api/trips to answer, then one frame for the render.
async function gotoSite(page, url = '/site') {
  const trips = page.waitForResponse((r) => r.url().endsWith('/api/trips'));
  await page.goto(url);
  const res = await trips;
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))));
  return res;
}

async function reloadSite(page) {
  const trips = page.waitForResponse((r) => r.url().endsWith('/api/trips'));
  await page.reload();
  await trips;
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))));
}

// textContent, not innerText: .caps and .primary render uppercase through CSS text-transform.
const text = (page, sel) => page.locator(sel).first().evaluate((el) => el.textContent.trim());
const texts = (page, sel) => page.locator(sel).evaluateAll((els) => els.map((el) => el.textContent.trim()));
const active = (page) => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
const scrollWidth = (page) => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
const inViewport = (page, sel) => page.evaluate((s) => {
  const r = document.querySelector(s).getBoundingClientRect();
  return r.top < innerHeight && r.bottom > 0 && r.left >= 0 && r.right <= innerWidth;
}, sel);
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };

async function sendFromModal(page, { dblclick = false } = {}) {
  await page.check('#consent');
  if (dblclick) await page.dblclick('#sendRequest');
  else await page.click('#sendRequest');
  await page.waitForFunction(() => document.querySelector('#requestModal .modal-card h2#modalTitle')?.textContent === "You're on our list.");
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
beforeEach(async () => { if (playwright) await resetMock(); });

describe('browser suite', { skip: playwright ? false : 'playwright is not installed: npm i -D playwright && npx playwright install chromium' }, () => {
  describe('8.3 the gate', () => {
    test('a valid code shows "Welcome, Ana Guest." and opens /site; the cookie is HttpOnly', async () => {
      const page = await open();
      await page.goto('/');
      assert.equal(await text(page, '#inviteMessage'), 'Your code is in your invitation from Katie.');
      await page.fill('#inviteCode', 'guest1');
      await page.click('#enterButton');
      await page.waitForFunction(() => document.querySelector('#inviteMessage').textContent === 'Welcome, Ana Guest.');
      assert.equal(await page.isDisabled('#enterButton'), true, 'Enter is disabled while leaving');
      await page.waitForURL(/\/site$/);
      assert.ok(await page.isVisible('#site'));
      const cookies = await page.context().cookies();
      const session = cookies.find((c) => c.name === 'cs_session');
      assert.ok(session, 'cs_session set');
      assert.equal(session.httpOnly, true);
      assert.equal(session.sameSite, 'Lax');
      assert.equal(await page.evaluate(() => document.cookie), '', 'not readable from JS');
      assert.deepEqual(page.errors(), []);
      await page.close2();
    });

    test('invalid, paused, used-up and empty show distinct messages and stay on /', async () => {
      const page = await open();
      await page.goto('/');
      const messages = {};
      for (const [label, code] of [['empty', ''], ['invalid', 'NOPE'], ['paused', 'PAUSED1'], ['used_up', 'ONCE1']]) {
        if (label === 'used_up') {
          const other = await open();
          await other.goto('/');
          await other.fill('#inviteCode', 'ONCE1');
          await other.click('#enterButton');
          await other.waitForURL(/\/site$/);
          await other.close2();
        }
        await page.fill('#inviteCode', code);
        await page.click('#enterButton');
        await page.waitForFunction((idle) => {
          const m = document.querySelector('#inviteMessage').textContent;
          return m && m !== idle && m !== 'Checking your invitation…';
        }, 'Your code is in your invitation from Katie.');
        messages[label] = await text(page, '#inviteMessage');
        assert.ok(await page.locator('#inviteMessage').evaluate((el) => el.classList.contains('is-error')), `${label} is styled as an error`);
        assert.equal(await page.isEnabled('#enterButton'), true, `${label}: Enter re-enabled`);
        assert.equal(await active(page), 'inviteCode', `${label}: focus back on the input`);
        assert.match(page.url(), /\/$/, `${label}: still on the gate`);
      }
      assert.equal(messages.empty, 'Enter your invitation code.');
      assert.equal(messages.invalid, "We couldn't find that invitation. Check the code and try again.");
      assert.equal(messages.paused, 'This invitation is paused. Reach out to Katie.');
      assert.equal(messages.used_up, 'This invitation has already been used.');
      assert.equal(new Set(Object.values(messages)).size, 4, 'four distinct messages');
      assert.deepEqual(page.errors(), [], 'no JS errors');
      assert.equal(page.resourceErrors().length, 3, 'only Chromium\'s own lines for the three 401s');
      await page.close2();
    });

    test('/?invite=GUEST1 enters without typing; /?code= is an alias; ?guest= is ignored', async () => {
      const page = await open();
      await page.goto('/?invite=GUEST1&guest=Mallory');
      await page.waitForURL(/\/site$/);
      const session = await page.evaluate(() => fetch('/api/session').then((r) => r.json()));
      assert.deepEqual(session, { ok: true, code: 'GUEST1', invitedBy: 'Katie', issuedTo: 'Ana Guest' });
      await page.close2();

      const alias = await open();
      await alias.goto('/?code=guest1');
      await alias.waitForURL(/\/site$/);
      assert.deepEqual(alias.errors(), []);
      await alias.close2();
    });

    test('/?invite=PAUSED1 falls back to the visible input with the paused message', async () => {
      const page = await open();
      await page.goto('/?invite=PAUSED1');
      await page.waitForFunction(() => document.querySelector('#inviteMessage').textContent === 'This invitation is paused. Reach out to Katie.');
      assert.match(page.url(), /\/\?invite=PAUSED1$/);
      assert.equal(await page.locator('.invite-card').evaluate((el) => el.classList.contains('recognized-invite')), false);
      assert.ok(await page.isVisible('#inviteCode'), 'input visible again');
      assert.equal(await page.inputValue('#inviteCode'), 'PAUSED1');
      assert.equal(await text(page, '#enterButton'), 'Enter Courtside');
      assert.equal(await page.isEnabled('#enterButton'), true);
      assert.match(await text(page, '#inviteIntro'), /^Katie invited you to preview/);
      await page.close2();
    });

    test('a visitor on /site with no cookie is sent to /', async () => {
      const page = await open();
      await page.goto('/site');
      await page.waitForURL(/\/$/);
      assert.ok(await page.isVisible('#inviteForm'));
      await page.close2();
    });
  });

  describe('8.6–8.9 requests from the page', () => {
    test('8.6 private request through the modal: double-click Send creates one row with every private column, two emails', async () => {
      const page = await open({ cookie: await loginToken('GUEST1') });
      await gotoSite(page, '/site#build');
      const emails = await sentEmails();
      // Default w5; change room, add two add-ons (one per-player, one group), set a note.
      await page.click('#roomOptions label:has(input[value="club"])');
      await page.check('.addon[data-id="eva"] input[type=checkbox]');
      await page.fill('.addon[data-id="eva"] .addon-qty input', '4');
      await page.check('.addon[data-id="driver"] input[type=checkbox]');
      await page.fill('#singleRooms', '2');
      await page.dispatchEvent('#singleRooms', 'change');
      await page.fill('#notes', 'One player has a knee issue.');
      assert.equal(await text(page, '#summaryDates'), 'Feb 7–13 · 6 nights');
      const playerRange = await text(page, '#playerRange');
      const partnerRange = (await text(page, '#partnerRange')).replace(/^Non-playing partner:\s*/, '');
      const groupRange = await text(page, '#groupRange');

      await page.click('#requestBtn');
      await page.waitForSelector('#requestModal.open');
      assert.equal(await page.getAttribute('#site', 'inert'), '', '#site is inert while the modal is open');
      assert.equal(await text(page, '#identityLine'), 'Requesting as Ana Guest · invited by Katie');
      const brief = await page.locator('#tripBrief').textContent();
      assert.match(brief, /^THE SPANISH OFFSEASON — PRIVATE GROUP REQUEST\n\nWeek: Feb 7–13, 2027 \(Sunday–Saturday\)/);
      assert.ok(brief.includes('Stay: Club View · 2 single-occupancy room(s)'));
      assert.ok(brief.includes('Add-ons: Extra session with Eva, Private 6-hour driver / excursion'));
      assert.ok(brief.includes('Notes: One player has a knee issue.'));
      assert.doesNotMatch(brief, /prototype/i);
      assert.equal(await page.getAttribute('#consent', 'required'), '');
      assert.deepEqual(await texts(page, '.modal-actions button'), ['Send to Katie', 'Copy trip brief', 'Close']);
      // Playwright's isVisible() counts opacity:0 / off-screen as visible, so check the computed style.
      const hp = await page.locator('#website').evaluate((el) => ({ opacity: getComputedStyle(el).opacity, left: el.getBoundingClientRect().left, tabIndex: el.tabIndex, ariaHidden: el.getAttribute('aria-hidden') }));
      assert.deepEqual(hp, { opacity: '0', left: -9999, tabIndex: -1, ariaHidden: 'true' }, 'honeypot off-screen, transparent, out of the tab order');

      // Send without consent: error line, nothing sent.
      await page.click('#sendRequest');
      assert.equal(await text(page, '#modalError'), 'Please agree to the privacy notice to send your request.');
      assert.equal(readMock().requests.length, 0);

      await sendFromModal(page, { dblclick: true });
      const card = page.locator('#requestModal .modal-card');
      assert.equal(await text(page, '#requestModal .modal-card .eyebrow'), 'Request received');
      const line = await text(page, '#requestModal .modal-card p');
      assert.match(line, /^Request CS-[0-9A-HJKMNP-TV-Z]{8}\. Katie reviews each request personally\.$/);
      assert.equal((await texts(page, '#requestModal .modal-card p'))[1], 'A confirmation email is on its way to the email on your invitation.');
      assert.deepEqual(await texts(page, '#requestModal .modal-card button'), ['Close'], 'Close button only');
      assert.equal(await active(page), 'modalTitle', 'focus moves to the success heading');

      const rows = readMock().requests;
      assert.equal(rows.length, 1, 'double-click created exactly one row');
      const row = rows[0];
      assert.equal(line.includes(row.request_id), true);
      assert.equal(row.request_type, 'private');
      assert.equal(row.weeks, 'Feb 7–13');
      assert.equal(row.guest_name, 'Ana Guest');
      assert.equal(row.guest_email, 'ana.guest@example.com');
      assert.equal(row.guest_mobile, '+1 555 0100');
      assert.equal(row.players, 6);
      assert.equal(row.partners, 2);
      assert.equal(row.room, 'Club View');
      assert.equal(row.single_rooms, 2);
      assert.equal(row.tennis, '4 mornings + Eva');
      assert.equal(row.addons, 'Extra session with Eva ×4, Private 6-hour driver / excursion');
      assert.equal(row.note, 'One player has a knee issue.');
      assert.equal(row.player_estimate, playerRange);
      assert.equal(row.partner_estimate, partnerRange);
      assert.equal(row.group_estimate, groupRange);
      assert.equal(row.brief, brief);
      assert.equal(row.invite_code, 'GUEST1');
      assert.equal(row.invited_by, 'Katie');
      assert.equal(row.status, 'New');
      for (const c of ['party_type', 'level', 'tennis_style', 'travel_style', 'priorities', 'owner', 'internal_notes']) assert.equal(row[c], '', c);
      assert.equal(emails.length, 2, 'two emails, once');
      assert.deepEqual(emails.map((e) => e.to), [['notify@example.com'], ['ana.guest@example.com']]);

      await page.click('#closeModal');
      assert.equal(await page.locator('#requestModal').evaluate((el) => el.classList.contains('open')), false);
      assert.equal(await page.getAttribute('#site', 'inert'), null);
      assert.equal(await active(page), 'requestBtn', 'focus returns to the opener');
      // Reopening shows a fresh pre-send modal, not the old success state.
      await page.click('#requestBtn');
      assert.ok(await page.isVisible('#sendRequest'));
      assert.equal(await page.isChecked('#consent'), false);
      assert.deepEqual(page.errors(), []);
      await page.close2();
    });

    test('8.7 vetted request through the modal: one row with every vetted column, two emails', async () => {
      const page = await open({ cookie: await loginToken('GUEST1') });
      await gotoSite(page, '/site#build');
      const emails = await sentEmails();
      await page.click('.path-toggle-btn[data-mode="vetted"]');
      assert.ok(await page.isVisible('#vettedFlow'));
      assert.equal(await page.isVisible('#privateFlow'), false);
      await page.click('#vettedFlow .vetted-weeks label:has(input[value="w2"])');
      await page.click('#vettedFlow .vetted-weeks label:has(input[value="w3"])');
      assert.equal(await text(page, '#vettedWeekSummary'), 'Jan 17–23 · Jan 24–30');
      await page.click('#partyType label:has(input[value="Couple"])');
      await page.selectOption('#vettedLevel', '4.0');
      await page.selectOption('#vettedTennisStyle', 'Competitive / serious');
      await page.click('#travelStyle label:has(input[value="Independent"])');
      await page.click('.priority-grid label:has(input[value="Great tennis"])');
      await page.click('.priority-grid label:has(input[value="Golf"])');
      await page.fill('#vettedNotes', 'Competitive doubles, no 7am.');
      await page.click('#vettedRequestBtn');
      await page.waitForSelector('#requestModal.open');
      const brief = await page.locator('#tripBrief').textContent();
      assert.match(brief, /^THE SPANISH OFFSEASON — VETTED GROUP REQUEST\n\nWeeks that work: Jan 17–23, Jan 24–30\nComing as: Couple\nTennis: 4\.0 · Competitive \/ serious\nTravel style: Independent\nPriorities: Great tennis, Golf\nWhat Katie should know: Competitive doubles, no 7am\./);
      await sendFromModal(page);
      const rows = readMock().requests;
      assert.equal(rows.length, 1);
      const row = rows[0];
      assert.equal(row.request_type, 'vetted');
      assert.equal(row.weeks, 'Jan 17–23, Jan 24–30');
      assert.equal(row.party_type, 'Couple');
      assert.equal(row.level, '4.0');
      assert.equal(row.tennis_style, 'Competitive / serious');
      assert.equal(row.travel_style, 'Independent');
      assert.equal(row.priorities, 'Great tennis, Golf');
      assert.equal(row.note, 'Competitive doubles, no 7am.');
      assert.equal(row.brief, brief);
      assert.equal(row.guest_email, 'ana.guest@example.com');
      for (const c of ['players', 'partners', 'room', 'single_rooms', 'tennis', 'addons', 'player_estimate', 'partner_estimate', 'group_estimate']) assert.equal(row[c], '', c);
      assert.equal(emails.length, 2);
      assert.deepEqual(page.errors(), []);
      await page.close2();
    });

    test('8.8 COURTSIDE (no guest email): one email, and the confirmation does not promise one', async () => {
      const page = await open({ cookie: await loginToken('COURTSIDE') });
      await gotoSite(page, '/site#build');
      const emails = await sentEmails();
      await page.click('#requestBtn');
      assert.equal(await text(page, '#identityLine'), 'Requesting as Shared test code · invited by Katie');
      await sendFromModal(page);
      const cardText = await text(page, '#requestModal .modal-card');
      assert.match(cardText, /Request received[\s\S]*You're on our list\.[\s\S]*Katie reviews each request personally\./);
      assert.doesNotMatch(cardText, /email/i, 'no email promised');
      assert.equal(readMock().requests.length, 1);
      assert.equal(readMock().requests[0].guest_email, '');
      assert.equal(emails.length, 1);
      assert.ok(emails[0].text.includes('Email: no guest email on this invite'));
      await page.close2();
    });

    test('beyond: keyboard only, Escape, focus trap and focus return', async () => {
      const page = await open({ cookie: await loginToken('GUEST1') });
      await gotoSite(page, '/site#build');
      // Tab from the top of the document until the private Request button has focus.
      await page.evaluate(() => { document.body.focus(); window.scrollTo(0, 0); });
      let tabs = 0;
      while ((await active(page)) !== 'requestBtn' && tabs < 150) { await page.keyboard.press('Tab'); tabs += 1; }
      assert.equal(await active(page), 'requestBtn', `reached the Request button by Tab (${tabs} tabs)`);
      await page.keyboard.press('Enter');
      await page.waitForSelector('#requestModal.open');
      assert.equal(await active(page), 'consent', 'first focusable in the modal is the consent box');
      // Escape closes and returns focus to the opener.
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#requestModal').evaluate((el) => el.classList.contains('open')), false);
      assert.equal(await active(page), 'requestBtn');
      assert.equal(await page.getAttribute('#site', 'inert'), null);
      // Open again, check the trap, then send with the keyboard.
      await page.keyboard.press('Enter');
      await page.waitForSelector('#requestModal.open');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await active(page), 'closeModal', 'Shift+Tab from the first control wraps to the last');
      await page.keyboard.press('Tab');
      assert.equal(await active(page), 'consent', 'Tab from the last control wraps to the first');
      await page.keyboard.press('Space');
      assert.equal(await page.isChecked('#consent'), true);
      await page.keyboard.press('Tab'); // privacy link
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute('href')), '/privacy');
      await page.keyboard.press('Tab');
      assert.equal(await active(page), 'sendRequest');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('#modalTitle')?.textContent === "You're on our list.");
      assert.equal(await active(page), 'modalTitle');
      await page.keyboard.press('Tab');
      assert.equal(await active(page), 'closeModal');
      await page.keyboard.press('Enter');
      assert.equal(await active(page), 'requestBtn');
      assert.equal(readMock().requests.length, 1);
      // Clicking the backdrop also closes.
      await page.click('#requestBtn');
      await page.mouse.click(5, 5);
      assert.equal(await page.locator('#requestModal').evaluate((el) => el.classList.contains('open')), false);
      assert.deepEqual(page.errors(), []);
      await page.close2();
    });
  });

  describe('8.10–8.11 closed week and closed trip in the page', () => {
    test('8.10 w5 closed: ribbon, private picker and vetted picker show it disabled with the tag; default moves to w1', async () => {
      const page = await open({ cookie: await loginToken('GUEST1') });
      await gotoSite(page, '/site');
      assert.equal(await page.locator('.is-closed').count(), 0);
      await setWeekStatus('w5', 'closed');
      await reloadSite(page);
      await page.waitForSelector('#join .week-ribbon .week-chip.is-closed');
      // Ribbon
      const ribbon = page.locator('#join .week-ribbon .week-chip');
      assert.equal(await ribbon.count(), 7);
      const closedChip = page.locator('#join .week-ribbon .week-chip.is-closed');
      assert.equal(await closedChip.count(), 1);
      assert.match(await closedChip.evaluate((el) => el.textContent), /W5Feb 7–13Closed/);
      const tag = closedChip.locator('.closed-tag');
      assert.equal(await tag.count(), 1);
      assert.equal(await tag.evaluate((el) => getComputedStyle(el).textTransform), 'uppercase', 'renders as CLOSED');
      assert.ok((await closedChip.evaluate((el) => Number(getComputedStyle(el).opacity))) < 1, 'greyed');
      assert.equal(await closedChip.evaluate((el) => getComputedStyle(el).cursor), 'not-allowed');
      assert.equal(await page.locator('#join .week-ribbon .week-chip:not(.is-closed) .closed-tag').count(), 0, 'open chips have no tag');
      // Private picker
      const w5 = page.locator('#privateWeeks input[value="w5"]');
      assert.equal(await w5.isDisabled(), true);
      assert.equal(await w5.isChecked(), false);
      assert.ok(await page.locator('#privateWeeks label.is-closed:has(input[value="w5"]) .closed-tag').count() === 1);
      assert.equal(await page.locator('#privateWeeks input:checked').getAttribute('value'), 'w1', 'default moved to the first open week');
      assert.equal(await page.locator('#privateWeeks label.selected').count(), 1);
      assert.equal(await text(page, '#summaryDates'), 'Jan 10–16 · 6 nights');
      await page.click('#privateWeeks label:has(input[value="w5"])', { force: true });
      assert.equal(await page.locator('#privateWeeks input:checked').getAttribute('value'), 'w1', 'clicking the closed chip changes nothing');
      assert.equal(await text(page, '#summaryDates'), 'Jan 10–16 · 6 nights');
      await page.click('#privateWeeks label:has(input[value="w6"])');
      assert.equal(await text(page, '#summaryDates'), 'Feb 14–20 · 6 nights', 'open chips still select');
      // Vetted picker
      await page.click('.path-toggle-btn[data-mode="vetted"]');
      const v5 = page.locator('#vettedFlow .vetted-weeks input[value="w5"]');
      assert.equal(await v5.isDisabled(), true);
      assert.equal(await page.locator('#vettedFlow .vetted-weeks label.is-closed:has(input[value="w5"]) .closed-tag').count(), 1);
      await page.click('#vettedFlow .vetted-weeks label:has(input[value="w5"])', { force: true });
      assert.equal(await v5.isChecked(), false, 'cannot be checked');
      assert.equal(await text(page, '#vettedWeekSummary'), 'Choose the weeks that work');
      await page.click('#vettedFlow .vetted-weeks label:has(input[value="w4"])');
      assert.equal(await text(page, '#vettedWeekSummary'), 'Jan 31–Feb 6');
      // The private brief now carries the new default week.
      await page.click('.path-toggle-btn[data-mode="private"]');
      await page.click('#privateWeeks label:has(input[value="w1"])');
      await page.click('#requestBtn');
      assert.match(await page.locator('#tripBrief').textContent(), /Week: Jan 10–16, 2027/);
      assert.deepEqual(page.errors(), []);
      await page.close2();
    });

    test('8.10 forced POST for a closed week is 409 and the modal says "Requests for Feb 7–13 are closed."', async () => {
      const page = await open({ cookie: await loginToken('GUEST1') });
      await gotoSite(page, '/site#build'); // w5 open and selected
      await setWeekStatus('w5', 'closed'); // Katie closes it after the page loaded
      const forced = await page.evaluate((body) => fetch('/api/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => [r.status, await r.json()]), privateBody({ weeks: ['w5'] }));
      assert.deepEqual(forced, [409, { ok: false, reason: 'week_closed', weeks: ['w5'] }]);
      await page.click('#requestBtn');
      await sendFromModalExpectingError(page, 'Requests for Feb 7–13 are closed.');
      await page.waitForSelector('#privateWeeks label.is-closed:has(input[value="w5"])');
      assert.equal(await page.locator('#privateWeeks input:checked').getAttribute('value'), 'w1', 'weeks refreshed behind the modal');
      assert.equal(await page.isEnabled('#sendRequest'), true, 'Send re-enabled');
      assert.equal(await text(page, '#sendRequest'), 'Send to Katie');
      assert.equal(readMock().requests.length, 0);
      await page.close2();
    });

    test('8.11 trip closed: #build is replaced by the closed message only; POST is 409 trip_closed', async () => {
      const page = await open({ cookie: await loginToken('GUEST1') });
      await setTripStatus('closed');
      await gotoSite(page, '/site#build');
      await page.waitForSelector('#build .closed-card');
      const inner = page.locator('#build .section-inner');
      assert.deepEqual(await inner.locator(':scope > *').evaluateAll((els) => els.map((e) => e.tagName + (e.className ? `.${e.className.replace(/\s+/g, '.')}` : ''))), ['DIV.eyebrow', 'H2', 'ARTICLE.path-card.closed-card']);
      assert.equal(await text(page, '#build .closed-card'), 'Requests for The Spanish Offseason are closed.');
      assert.equal(await page.locator('#privateFlow, #vettedFlow, .path-toggle, #requestBtn, #vettedRequestBtn').count(), 0);
      assert.ok(await inViewport(page, '#build'), '#build still the anchor');
      const forced = await page.evaluate((body) => fetch('/api/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => [r.status, await r.json()]), privateBody({ weeks: ['w1'] }));
      assert.deepEqual(forced, [409, { ok: false, reason: 'trip_closed' }]);
      // Hero and path-card CTAs still just jump to #build.
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.click('.hero-ctas a[data-path="private"]');
      await page.waitForFunction(() => location.hash === '#build');
      assert.deepEqual(page.errors(), []);
      await page.close2();

      // Trip open but every week closed: the week message is used.
      await setTripStatus('open');
      await setAllWeeks('closed');
      const page2 = await open({ cookie: await loginToken('GUEST1') });
      await gotoSite(page2, '/site');
      await page2.waitForSelector('#build .closed-card');
      assert.equal(await text(page2, '#build .closed-card'), 'Requests for this week are closed.');
      assert.equal(await page2.locator('#join .week-ribbon .week-chip.is-closed').count(), 7);
      await page2.close2();
    });

    test('8.11 trip closed while the modal is open: the 409 shows the closed message and replaces the builder', async () => {
      const page = await open({ cookie: await loginToken('GUEST1') });
      await gotoSite(page, '/site#build');
      await page.click('#requestBtn');
      await setTripStatus('closed');
      await sendFromModalExpectingError(page, 'Requests for The Spanish Offseason are closed.');
      await page.click('#closeModal');
      await page.waitForSelector('#build .closed-card');
      assert.equal(await page.locator('#requestBtn').count(), 0);
      await page.close2();
    });
  });

  describe('8.12 back, refresh and a pasted /site#build link', () => {
    test('enter, go to #build, refresh, back, forward; then /site#build pasted into a tab that has the cookie', async () => {
      const page = await open();
      await page.goto('/');
      await page.fill('#inviteCode', 'GUEST1');
      const trips = page.waitForResponse((r) => r.url().endsWith('/api/trips'));
      await page.click('#enterButton');
      await page.waitForURL(/\/site$/);
      await trips;
      await page.click('.site-nav a.invite-pill[href="#build"]');
      await page.waitForFunction(() => location.hash === '#build');
      // html{scroll-behavior:smooth} is on, so give the scroll a moment to arrive.
      await page.waitForFunction(() => document.getElementById('build').getBoundingClientRect().top < innerHeight);
      assert.ok(await inViewport(page, '#build'));
      await reloadSite(page);
      assert.match(page.url(), /\/site#build$/);
      assert.ok(await page.isVisible('#privateFlow'), 'still logged in after refresh');
      await page.waitForFunction(() => Math.abs(document.getElementById('build').getBoundingClientRect().top) < 4);
      await page.goBack();
      await page.waitForFunction(() => location.hash === '');
      assert.match(page.url(), /\/site$/);
      assert.ok(await page.isVisible('#site'), 'back keeps the site (no redirect to the gate)');
      await page.goBack();
      await page.waitForURL(/\/$/);
      assert.ok(await page.isVisible('#inviteForm'), 'back again reaches the gate');
      await page.goForward();
      await page.waitForURL(/\/site$/);
      assert.ok(await page.isVisible('#site'));
      assert.deepEqual(page.errors(), []);
      await page.close2();

      const pasted = await open({ cookie: await loginToken('GUEST1') });
      await gotoSite(pasted, '/site#build');
      await pasted.waitForFunction(() => Math.abs(document.getElementById('build').getBoundingClientRect().top) < 4);
      assert.ok((await pasted.evaluate(() => window.scrollY)) > 500, 'scrolled down to the builder');
      assert.equal(await pasted.locator('#privateWeeks input:checked').getAttribute('value'), 'w5');
      await pasted.close2();
    });
  });

  describe('8.13–8.14 served pages in the browser', () => {
    test('no "prototype" in the DOM, noindex on every page, no console errors', async () => {
      const token = await loginToken('GUEST1');
      for (const [p, cookie] of [['/', null], ['/privacy', null], ['/site', token]]) {
        const page = await open({ cookie });
        if (p === '/site') await gotoSite(page, p); else await page.goto(p);
        assert.equal(await page.getAttribute('meta[name="robots"]', 'content'), 'noindex,nofollow', `${p} noindex`);
        assert.doesNotMatch(await page.content(), /prototype/i, `${p} DOM`);
        assert.deepEqual(page.errors(), [], `${p} console`);
        assert.deepEqual(page.resourceErrors(), [], `${p} resources`);
        await page.close2();
      }
    });

    test('beyond: the privacy link from the modal opens /privacy with the placeholder notice', async () => {
      const page = await open({ cookie: await loginToken('GUEST1') });
      await gotoSite(page, '/site#build');
      await page.click('#requestBtn');
      const [popup] = await Promise.all([page.waitForEvent('popup'), page.click('.consent a[href="/privacy"]')]);
      await popup.waitForLoadState();
      assert.match(popup.url(), /\/privacy$/);
      assert.match(await popup.locator('.placeholder-notice').evaluate((el) => el.textContent), /^Placeholder — final wording to come from Courtside/);
      await page.close2();
    });
  });

  describe('beyond: motion', () => {
    test('prefers-reduced-motion turns off smooth scroll and the gate fade; the default keeps them', async () => {
      // The fade is the gap between the /api/code answer and the request for /site (gate.js waits
      // 600 ms, or 0 under reduced motion), measured by the browser rather than by page load time.
      const fadeGap = async (page) => {
        const answered = page.waitForResponse((r) => r.url().endsWith('/api/code')).then(() => Date.now());
        const navigated = page.waitForRequest((r) => /\/site$/.test(r.url()) && r.isNavigationRequest()).then(() => Date.now());
        await page.fill('#inviteCode', 'GUEST1');
        await page.click('#enterButton');
        const [a, b] = await Promise.all([answered, navigated]);
        await page.waitForURL(/\/site$/);
        return b - a;
      };

      const normal = await open();
      await normal.goto('/');
      assert.equal(await normal.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), 'smooth');
      assert.notEqual(await normal.evaluate(() => getComputedStyle(document.getElementById('gate')).transitionProperty), 'none');
      const normalGap = await fadeGap(normal);
      assert.ok(normalGap >= 500, `default: ~600 ms fade before /site (measured ${normalGap} ms)`);
      await normal.close2();

      const context = await browser.newContext({ baseURL: srv.base, reducedMotion: 'reduce', extraHTTPHeaders: { 'x-forwarded-for': freshIp() } });
      contexts.add(context);
      const page = await context.newPage();
      await page.goto('/');
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), 'auto');
      assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('gate')).transitionProperty), 'none');
      const reducedGap = await fadeGap(page);
      assert.ok(reducedGap < 300, `reduced motion: no fade before /site (measured ${reducedGap} ms)`);
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), 'auto');
      await context.close();
      contexts.delete(context);
    });
  });

  describe('8.15 380 px width', () => {
    const mobile = { width: 380, height: 760 };
    test('gate: no horizontal scroll, the form is reachable, the flow works', async () => {
      const page = await open({ viewport: mobile });
      await page.goto('/');
      assert.ok((await scrollWidth(page)) <= 380, `gate scrollWidth ${await scrollWidth(page)}`);
      await page.locator('#enterButton').scrollIntoViewIfNeeded();
      assert.ok(await inViewport(page, '#inviteCode'));
      assert.ok(await inViewport(page, '#enterButton'));
      await shot(page, 'gate-380');
      await page.fill('#inviteCode', 'GUEST1');
      await page.click('#enterButton');
      await page.waitForURL(/\/site$/);
      await page.close2();
    });

    test('site, both builder paths and the open modal: no horizontal scroll, controls reachable', async () => {
      const page = await open({ cookie: await loginToken('GUEST1'), viewport: mobile });
      await gotoSite(page, '/site');
      assert.ok((await scrollWidth(page)) <= 380, `site scrollWidth ${await scrollWidth(page)}`);
      await shot(page, 'site-380');
      await page.locator('#join .week-ribbon').scrollIntoViewIfNeeded();
      assert.ok((await scrollWidth(page)) <= 380, 'ribbon');
      await shot(page, 'ribbon-380');
      await page.locator('#build').scrollIntoViewIfNeeded();
      assert.ok((await scrollWidth(page)) <= 380, 'builder');
      await shot(page, 'builder-private-380');
      for (const sel of ['#privateWeeks label:has(input[value="w3"])', '[data-counter="players"][data-dir="1"]', '#roomOptions label:has(input[value="junior"])', '.addon[data-id="golf"] input[type=checkbox]', '#requestBtn']) {
        await page.locator(sel).scrollIntoViewIfNeeded();
        assert.ok(await inViewport(page, sel), `${sel} reachable`);
      }
      await page.click('#privateWeeks label:has(input[value="w3"])');
      assert.equal(await text(page, '#summaryDates'), 'Jan 24–30 · 6 nights');
      await page.click('.path-toggle-btn[data-mode="vetted"]');
      await page.locator('#vettedFlow').scrollIntoViewIfNeeded();
      assert.ok((await scrollWidth(page)) <= 380, 'vetted');
      await shot(page, 'builder-vetted-380');
      await page.locator('#vettedRequestBtn').scrollIntoViewIfNeeded();
      assert.ok(await inViewport(page, '#vettedRequestBtn'));
      await page.click('.path-toggle-btn[data-mode="private"]');
      await page.locator('#requestBtn').scrollIntoViewIfNeeded();
      await page.click('#requestBtn');
      await page.waitForSelector('#requestModal.open');
      assert.ok((await scrollWidth(page)) <= 380, 'modal open');
      const cardBox = await page.locator('#requestModal .modal-card').boundingBox();
      assert.ok(cardBox.x >= 0 && cardBox.x + cardBox.width <= 380, `modal card within 380 (x ${cardBox.x}, w ${cardBox.width})`);
      await shot(page, 'modal-380');
      await page.locator('#sendRequest').scrollIntoViewIfNeeded();
      assert.ok(await inViewport(page, '#sendRequest'), 'Send reachable');
      assert.ok(await inViewport(page, '#closeModal') || await page.locator('#closeModal').scrollIntoViewIfNeeded().then(() => inViewport(page, '#closeModal')), 'Close reachable');
      await shot(page, 'modal-actions-380');
      await sendFromModal(page);
      await shot(page, 'success-380');
      assert.ok((await scrollWidth(page)) <= 380, 'success');
      assert.equal(readMock().requests.length, 1);
      assert.deepEqual(page.errors(), []);
      await page.close2();
    });
  });
});

async function sendFromModalExpectingError(page, message) {
  await page.check('#consent');
  await page.click('#sendRequest');
  await page.waitForFunction((m) => document.querySelector('#modalError')?.textContent === m, message);
}
