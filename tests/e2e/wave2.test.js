// tests/e2e/wave2.test.js
// Concept 02 Wave 2 (CONCEPT02_WAVE2_PLAN.md section 6, "Frontend routes"): the group, attendee, concierge,
// proposal, payment and trip-home screens read and write the Sheet through the new routes, in mock mode.
// Playwright (library) drives headless Chromium against a dev server started in this process on a free port
// with a temp mock file; requests that would leave 127.0.0.1 are aborted and recorded. The organizer and the
// invited member each get their own browser context (their own cookies and client IP), so the member's
// cs_member cookie comes only from opening the personal link. "Sheet-side" edits are writes to the mock file.
//
// Run: npm run test:e2e   (needs `npx playwright install chromium`)
// Set E2E_SCREENSHOT_DIR=/some/dir to save full-page screenshots of each screen at 390 and 1440.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { editMock, freshIp, readMock, resetMock, startServer, useTempMock } from './helpers.js';

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
// The Wave 2 copy sweep: none of this may remain on a screen that now saves for real.
const DEMO_WORDS = /\b(demo|simulated|sample|prototype|walkthrough)\b|nothing (is|has been) (sent|charged|booked)|in this browser/i;
const MEMBER_LINK = /\/#\/join\/CSM-[0-9A-Z]{8}$/;
const GROUP_LINK = /\/#\/join-group\/CSG-[0-9A-Z]{8}$/;

let srv;
let browser;
const contexts = new Set();

async function open({ viewport = DESKTOP, ip = freshIp(), gated = false } = {}) {
  const context = await browser.newContext({ baseURL: srv.base, viewport, extraHTTPHeaders: { 'x-forwarded-for': ip } });
  if (!gated) await context.addInitScript(() => { try { localStorage.setItem('courtside-gate', 'iminvited'); } catch {} });
  contexts.add(context);
  const external = [];
  await context.route((url) => !url.href.startsWith(srv.base), (route) => { external.push(route.request().url()); return route.abort(); });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    // Chromium logs the 401s the find-group redirect relies on as "Failed to load resource"; those are expected.
    if (/^Failed to load resource/.test(msg.text())) return;
    errors.push(`console.error: ${msg.text()}`);
  });
  page.on('dialog', (dialog) => dialog.accept());
  page.errors = () => errors;
  page.external = () => external;
  page.context2 = context;
  page.close2 = async () => { await context.close(); contexts.delete(context); };
  return page;
}

// A fresh document every time (a goto that only changes the hash would reuse the page), so each screen is
// read from the routes as a guest arriving from a link would see it.
let visits = 0;
async function visit(page, hash) {
  await page.goto(`/?v=${++visits}${hash}`);
  await page.waitForFunction(() => document.querySelector('#main .route-fade') !== null);
}
const hashIs = (page, hash) => page.waitForFunction((h) => location.hash === h, hash, { timeout: 8000 });
const hashMatches = (page, source) => page.waitForFunction((s) => new RegExp(s).test(location.hash), source, { timeout: 8000 });
const mainText = (page) => page.locator('#main').evaluate((el) => el.innerText.replace(/\s+/g, ' ').trim());
// Wait until the live screen has painted (the loading line is gone and the text is there).
async function textShows(page, text) {
  try {
    await page.waitForFunction((t) => (document.querySelector('#main')?.innerText || '').replace(/\s+/g, ' ').includes(t), text, { timeout: 8000 });
  } catch (err) {
    const seen = await mainText(page).catch(() => '');
    throw new Error(`"${text}" not shown on ${await page.evaluate(() => location.hash)}: ${seen.slice(0, 400)}`, { cause: err });
  }
}
const rows = (section) => (fs.existsSync(process.env.MOCK_DATA_PATH) ? readMock()[section] || [] : []);
// Poll the mock file until predicate(rows) holds (a write lands a moment after the click).
async function until(section, predicate, label) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const r = rows(section);
    if (predicate(r)) return r;
    await new Promise((res) => setTimeout(res, 50));
  }
  assert.fail(`timed out waiting for ${section}: ${label}`);
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true }); };
async function cookieNamed(page, name) {
  return (await page.context2.cookies(srv.base)).find((c) => c.name === name) || null;
}
async function assertNoDemo(page, label) {
  assert.doesNotMatch(await mainText(page), DEMO_WORDS, label);
}

async function resetModules() {
  const mods = await Promise.all([
    import('../../api/inquiry.js'), import('../../api/application.js'), import('../../api/lineup.js'), import('../../lib/settings.js'),
  ]);
  mods[0]._resetDoubleSubmit?.();
  mods[1]._resetDoubleSubmit?.();
  mods[2]._resetLineupCache?.();
  mods[3]._resetSettingsCache?.();
}

async function groupRequest(page) {
  await visit(page, '#/request/group');
  await page.waitForSelector('input[name=week][value=w5]');
  await page.check('input[name=week][value=w5]');
  await page.click('form[data-draft] button.btn');
  await page.waitForSelector('select[name=players]');
  await page.selectOption('select[name=players]', '6');
  await page.selectOption('select[name=partners]', '2');
  await page.selectOption('select[name=tennis]', 'Daily tennis');
  await page.click('form[data-draft] button.btn');
  await page.waitForSelector('input[name=name]');
  await page.fill('input[name=name]', 'Olive Organizer');
  await page.fill('input[name=email]', 'olive.organizer@example.com');
  await page.click('form[data-draft] button.btn');
  await page.waitForSelector('input[name=consent]');
  await page.check('input[name=consent]');
  await page.click('form[data-draft] button.btn');
  await hashIs(page, '#/received');
}

describe('Concept 02 Wave 2 frontend (mock store)', { skip: playwright ? false : 'playwright is not installed' }, () => {
  before(async () => {
    useTempMock('courtside-w2-');
    srv = await startServer();
    browser = await playwright.chromium.launch();
  });

  beforeEach(async () => {
    await resetMock();
    await resetModules();
  });

  after(async () => {
    for (const context of contexts) await context.close().catch(() => {});
    await browser?.close();
    await srv?.close();
  });

  test('organizer → member → concierge → proposal → ledger → trip home, all from the Sheet', async () => {
    // 1. The group request creates the group and the organizer's row, and sets cs_member.
    const org = await open();
    await groupRequest(org);
    const groups = await until('groups', (r) => r.length === 1, 'one group');
    const group = groups[0];
    assert.match(group.group_id, /^CSG-/);
    assert.equal(group.stage, 'Inquiry');
    const [organizer] = rows('group_members');
    assert.equal(organizer.role, 'Organizer + player');
    const cookie = await cookieNamed(org, 'cs_member');
    assert.ok(cookie, 'cs_member set by the request');
    assert.ok(cookie.httpOnly);

    // 2. The receipt shows the reference and both links.
    await textShows(org, 'KEEP THESE LINKS');
    const receipt = await mainText(org);
    assert.match(receipt, new RegExp(`REQUEST RECEIVED · ${rows('requests')[0].request_id}`));
    assert.match(receipt, /group page is where you add people/);
    const links = await org.locator('.copyrow input').evaluateAll((els) => els.map((e) => e.value));
    assert.equal(links.length, 2);
    assert.match(links[0], MEMBER_LINK);
    assert.ok(links[0].endsWith(organizer.member_id));
    assert.match(links[1], GROUP_LINK);
    assert.ok(links[1].endsWith(group.group_id));
    await assertNoDemo(org, '#/received');
    await shot(org, '1440-w2-received');

    // 3. The organizer edits the group (weeks from /api/lineup).
    await org.click('#main a[href="#/group"]');
    await textShows(org, 'Your people.');
    await assertNoDemo(org, '#/group');
    await org.click('text=Update group preferences');
    await org.waitForSelector('#overlay select[name=chosenWeek] option[value=w6]', { state: 'attached' });
    await org.fill('#overlay input[name=name]', 'Olive’s Clay Crew');
    await org.selectOption('#overlay select[name=chosenWeek]', 'w6');
    await org.selectOption('#overlay select[name=tennis]', 'Four mornings');
    await org.click('#overlay form button.btn');
    const [edited] = await until('groups', (r) => r[0]?.name === 'Olive’s Clay Crew', 'group renamed');
    assert.equal(edited.chosen_week, 'w6');
    assert.equal(edited.weeks, 'Feb 14–20');
    assert.equal(edited.tennis, 'Four mornings');
    assert.equal(String(edited.review_needed).toUpperCase(), 'TRUE');
    await textShows(org, 'Courtside is reviewing');

    // 4. Add a member, then invite: the link comes back and the row says Link shared.
    await org.click('text=Add an attendee +');
    await org.fill('#overlay input[name=name]', 'Sam Member');
    await org.fill('#overlay input[name=email]', 'sam.member@example.com');
    await org.click('#overlay form button.btn');
    const added = await until('group_members', (r) => r.length === 2, 'member added');
    const sam = added[1];
    assert.equal(sam.invite_status, 'Not invited');
    await org.waitForSelector(`[data-invite="${sam.member_id}"]`);
    await org.click(`[data-invite="${sam.member_id}"]`);
    await org.click('#overlay form button.btn');
    await org.waitForSelector('#overlay .copyrow input');
    const samLink = await org.locator('#overlay .copyrow input').inputValue();
    assert.match(samLink, MEMBER_LINK);
    assert.ok(samLink.endsWith(sam.member_id));
    assert.match(await org.locator('#overlay').innerText(), /Copy their link and send it however you like/);
    await until('group_members', (r) => r[1].invite_status === 'Link shared', 'Link shared');
    await org.click('#overlay .actions button.btn');
    await org.waitForFunction((id) => document.querySelector(`[data-member="${id}"]`)?.innerText.includes('Link shared'), sam.member_id);
    await shot(org, '1440-w2-group');

    // 5. The member opens the link in a fresh context, responds and completes preferences.
    const mem = await open({ viewport: MOBILE });
    await mem.goto(samLink);
    await hashIs(mem, '#/attendee');
    assert.ok(await cookieNamed(mem, 'cs_member'), 'cs_member set by the personal link');
    await textShows(mem, 'Sam, you’re invited.');
    const invitation = await mainText(mem);
    assert.match(invitation, /Olive’s Clay Crew/);
    assert.match(invitation, /Feb 14–20, 2027/);
    await assertNoDemo(mem, '#/attendee');
    await shot(mem, '390-w2-attendee');
    await mem.click('text=I’m interested ↗');
    await hashIs(mem, '#/preferences');
    await mem.waitForSelector('form[data-preferences]');
    await assertNoDemo(mem, '#/preferences');
    await mem.selectOption('select[name=level]', '3.5');
    await mem.selectOption('select[name=room]', 'Shared room');
    await mem.check('input[name=interests][value=Golf]');
    await mem.fill('input[name=roommate]', 'Olive');
    await mem.click('form[data-preferences] button.btn');
    await hashIs(mem, '#/planning-saved');
    await textShows(mem, 'PREFERENCES SAVED');
    await assertNoDemo(mem, '#/planning-saved');
    const samRow = rows('group_members')[1];
    assert.equal(samRow.participation, 'Interested');
    assert.equal(samRow.invite_status, 'Responded');
    assert.equal(String(samRow.planning_complete).toUpperCase(), 'TRUE');
    assert.equal(samRow.level, '3.5');
    assert.equal(samRow.room, 'Shared room');
    assert.match(samRow.interests, /Golf/);

    // 6. Concierge: create two, cancel one.
    await visit(mem, '#/help/new/activity');
    await mem.waitForSelector('#main form textarea[name=details]');
    await assertNoDemo(mem, '#/help/new/activity');
    await mem.click('#main form button.btn');
    await hashMatches(mem, '^#/help/CSR-');
    const golf = (await until('concierge_requests', (r) => r.length === 1, 'first request'))[0];
    assert.equal(golf.status, 'Received');
    assert.equal(golf.category, 'Activity');
    await visit(mem, '#/help/new/other');
    await mem.waitForSelector('#main form textarea[name=details]');
    await mem.fill('#main input[name=subject]', 'Late checkout');
    await mem.fill('#main textarea[name=details]', 'Could I keep my room until 2pm on Saturday?');
    await mem.click('#main form button.btn');
    await hashMatches(mem, '^#/help/CSR-');
    await mem.waitForSelector('[data-cancel-request]');
    await mem.click('[data-cancel-request]');
    await until('concierge_requests', (r) => r[1]?.status === 'Canceled', 'second request canceled');
    await textShows(mem, 'Request canceled by Sam Member.');
    await visit(mem, '#/help');
    await textShows(mem, 'Late checkout');
    await assertNoDemo(mem, '#/help');

    // 7. A Sheet-side edit offers an option with a cost; the detail page shows it and the guest approves.
    await editMock((d) => {
      const r = d.concierge_requests.find((x) => x.concierge_id === golf.concierge_id);
      r.status = 'Approval needed';
      r.offer = 'Tuesday golf at 14:30 at Las Colinas, with transport.';
      r.cost = 175;
      r.assigned_to = 'Jeffery';
      r.history = `${r.history}\nCourtside found a tee time. · 2026-11-08T12:00:00.000Z`;
    });
    await visit(mem, `#/help/${golf.concierge_id}`);
    await textShows(mem, 'Tuesday golf at 14:30');
    const detail = await mainText(mem);
    assert.match(detail, /\$175/);
    assert.match(detail, /Jeffery/);
    assert.match(detail, /Approval needed/);
    assert.match(detail, /Courtside found a tee time\./);
    await assertNoDemo(mem, '#/help/<id>');
    await mem.click('text=Approve this option ↗');
    await until('concierge_requests', (r) => r[0].status === 'Approved', 'approved');
    await textShows(mem, 'Offer approved by Sam Member.');

    // 8. The proposal: base + extras, the deposit from the Settings tab.
    await editMock((d) => { d.settings.find((s) => s.key === 'deposit_per_person').value = 350; });
    await resetModules();
    await visit(mem, '#/proposal');
    await mem.waitForSelector('[data-accept]');
    const prop = await mainText(mem);
    assert.match(prop, /Base price \$2,995/);
    assert.match(prop, /Approved extras \$175/);
    assert.match(prop, /Package total \$3,170/);
    assert.match(prop, /Deposit on acceptance \$350/);
    assert.match(prop, /Add-ons A round of golf/);
    assert.match(prop, /Balance due Dec 16, 2026/, 'Feb 14 minus 60 days');
    await assertNoDemo(mem, '#/proposal');
    await shot(mem, '390-w2-proposal');
    const [draft] = rows('proposals');
    assert.equal(draft.status, 'draft');

    // 9. Accept: a pending deposit row, shown on the ledger.
    await mem.click('[data-accept]');
    await hashIs(mem, '#/payment');
    const [pay] = await until('payments', (r) => r.length === 1, 'deposit row');
    assert.equal(pay.type, 'deposit');
    assert.equal(Number(pay.amount), 350);
    assert.equal(pay.status, 'pending');
    assert.equal(rows('proposals')[0].status, 'accepted');
    assert.equal(rows('group_members')[1].proposal_status, 'Payment pending');
    await mem.waitForSelector(`[data-payment="${pay.payment_id}"]`);
    const ledger = await mainText(mem);
    assert.match(ledger, /Deposit \$350 USD Pending/);
    assert.match(ledger, /No card details collected/);
    assert.match(ledger, /Courtside will send payment instructions/);
    assert.equal(await mem.locator('#main a[href="#/trip-home"]').count(), 1, 'Back to my week');
    await assertNoDemo(mem, '#/payment');

    // 10. Trip home opens with the payment status, and follows a Sheet-side "paid".
    await visit(mem, '#/trip-home');
    await textShows(mem, 'YOUR TRIP HOME');
    assert.match(await mainText(mem), /Deposit pending/);
    await assertNoDemo(mem, '#/trip-home');
    await editMock((d) => { d.payments[0].status = 'paid'; d.payments[0].paid_at = '2026-11-09'; });
    await visit(mem, '#/trip-home');
    await textShows(mem, 'Deposit paid');
    await mem.click('nav.tabs button:has-text("Our group")');
    await textShows(mem, 'Olive Organizer');
    await mem.click('nav.tabs button:has-text("Arrangements")');
    await textShows(mem, 'A round of golf');
    await assertNoDemo(mem, '#/trip-home arrangements');

    // 11. Arrival saves to the member row.
    await visit(mem, '#/arrival');
    await mem.waitForSelector('#main input[name=flight]');
    await assertNoDemo(mem, '#/arrival');
    await mem.fill('#main input[name=airport]', 'Alicante (ALC)');
    await mem.fill('#main input[name=flight]', 'IB3412');
    await mem.fill('#main input[name=date]', '2027-02-14');
    await mem.fill('#main input[name=time]', '14:30');
    await mem.click('#main form button.btn');
    await hashIs(mem, '#/trip-home');
    const arrived = await until('group_members', (r) => r[1].arrival_flight === 'IB3412', 'arrival saved');
    assert.equal(arrived[1].arrival_airport, 'Alicante (ALC)');
    assert.equal(arrived[1].arrival_date, '2027-02-14');
    assert.equal(arrived[1].arrival_time, '14:30');
    await shot(mem, '390-w2-trip-home');

    // 12. Nothing of the group is kept in localStorage.
    for (const page of [org, mem]) {
      const stored = await page.evaluate(() => localStorage.getItem('courtside-concept-v2') || '');
      assert.doesNotMatch(stored, /CSG-|CSM-|CSR-|CSP-|CSY-/, 'no Wave 2 ids in localStorage');
    }

    assert.deepEqual(org.errors(), [], 'organizer page errors');
    assert.deepEqual(mem.errors(), [], 'member page errors');
    assert.deepEqual([...org.external(), ...mem.external()], [], 'no external requests');
    await org.close2();
    await mem.close2();
  });

  test('the shared join link adds a member and goes to preferences', async () => {
    const org = await open();
    await groupRequest(org);
    const [group] = await until('groups', (r) => r.length === 1, 'group');
    const page = await open({ viewport: MOBILE });
    await visit(page, `#/join-group/${group.group_id}`);
    await assertNoDemo(page, '#/join-group');
    await page.fill('#main input[name=name]', 'Jo Joiner');
    await page.fill('#main input[name=email]', 'jo.joiner@example.com');
    await page.selectOption('#main select[name=role]', 'Non-playing partner');
    await page.check('#main input[name=consent]');
    await page.click('#main form button.btn');
    await hashIs(page, '#/preferences');
    const members = await until('group_members', (r) => r.length === 2, 'joined');
    assert.equal(members[1].name, 'Jo Joiner');
    assert.equal(members[1].role, 'Non-playing partner');
    assert.equal(members[1].participation, 'Interested');
    assert.ok(await cookieNamed(page, 'cs_member'));
    assert.deepEqual(page.errors(), []);
    await org.close2();
    await page.close2();
  });

  test('without a member cookie the group screens land on #/find-group; a bad personal link says so', async () => {
    const page = await open();
    for (const hash of ['#/group', '#/attendee', '#/trip-home', '#/proposal', '#/payment', '#/help']) {
      await visit(page, hash);
      await hashIs(page, '#/find-group');
      await textShows(page, 'Your group page opens from your personal link.');
    }
    const text = await mainText(page);
    assert.match(text, /receipt/);
    assert.match(text, /organizer/);
    assert.doesNotMatch(text, DEMO_WORDS);
    await visit(page, '#/join/CSM-ZZZZZZZZ');
    await textShows(page, 'We couldn’t find an invitation for this link.');
    assert.equal(await cookieNamed(page, 'cs_member'), null);
    assert.deepEqual(page.errors(), []);
    await page.close2();
  });

  test('the demo-flag screens still render their own local sample data', async () => {
    const page = await open();
    await visit(page, '#/operations?demo=1');
    await textShows(page, 'COURTSIDE TEAM');
    await visit(page, '#/host-desk');
    await textShows(page, 'HOST HOME');
    assert.doesNotMatch(await mainText(page), /JEFF/);
    await visit(page, '#/guide');
    await textShows(page, 'WALKTHROUGH');
    assert.equal(rows('groups').length, 0, 'the sample group never reaches the store');
    assert.deepEqual(page.errors(), []);
    await page.close2();
  });
});
