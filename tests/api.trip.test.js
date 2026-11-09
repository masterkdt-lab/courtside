// tests/api.trip.test.js
// Wave 2 concierge, proposal and payments routes (CONCEPT02_WAVE2_PLAN.md section 6) in mock mode:
// create/cancel/approve/decline and the status rules, proposal pricing (player vs partner, approved
// extras, the group deposit on the organizer, the balance due date from the week start, the draft
// version bump), accept creating the pending deposit, and the ledger read.

import { test, describe, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { _resetDoubleSubmit } from '../api/inquiry.js';
import { CONFLICTS as CONCIERGE_CONFLICTS, RECEIVED_LINE } from '../api/concierge.js';
import { CONFLICTS as PROPOSAL_CONFLICTS } from '../api/proposal.js';
import { _resetLineupCache } from '../api/lineup.js';
import { _resetSentLog } from '../lib/email.js';
import { BASE_PRICES, INCLUSIONS, addDays, todayYmd } from '../lib/groups.js';
import { _reset as resetRateLimit } from '../lib/ratelimit.js';
import { _resetSettingsCache } from '../lib/settings.js';
import { TAB_HEADERS } from '../lib/store.columns.js';
import { callRoute, createGroup, editMock, freshMockPath, memberCookieOf, readMock, tempDir, useMockEnv } from './api.helpers.js';

let dir;
let quiet;
before(() => { dir = tempDir('courtside-trip-'); useMockEnv(); quiet = mock.method(console, 'log', () => {}); });
after(() => { quiet.mock.restore(); fs.rmSync(dir, { recursive: true, force: true }); });
beforeEach(() => { freshMockPath(dir); resetRateLimit(); _resetDoubleSubmit(); _resetLineupCache(); _resetSentLog(); _resetSettingsCache(); useMockEnv(); });

const logCodes = () => readMock().log.map((l) => l.code);
const concierge = (body, cookie) => callRoute('concierge', { body, cookie });
const create = (cookie, o = {}) => concierge({ action: 'create', category: 'Activity', subject: 'A round of golf', details: 'Tuesday afternoon, please.', timing: 'Tuesday afternoon', ...o }, cookie);

async function groupWithGuest(role = 'Player') {
  const org = await createGroup();
  const added = await callRoute('member', { body: { action: 'add', name: 'Sam Player', email: 'sam@example.com', role }, cookie: org.cookie });
  const opened = await callRoute('member', { body: { action: 'open', memberId: added.json.member.memberId } });
  return { org, guest: { memberId: added.json.member.memberId, cookie: memberCookieOf(opened.res) } };
}

// Courtside's edit in the Sheet: status / offer / cost on one concierge row.
const courtsideSets = (conciergeId, fields) => editMock((d) => { Object.assign(d.concierge_requests.find((r) => r.concierge_id === conciergeId), fields); });

describe('concierge', () => {
  test('create: the row, the first history line, Log concierge_create; GET splits history into lines', async () => {
    const { guest } = await groupWithGuest();
    const { status, json } = await create(guest.cookie);
    assert.equal(status, 200, JSON.stringify(json));
    const r = json.request;
    assert.match(r.conciergeId, /^CSR-[0-9A-HJKMNP-TV-Z]{8}$/);
    assert.deepEqual([r.memberId, r.requesterName, r.category, r.subject, r.details, r.preferredTiming, r.status, r.offer, r.cost, r.assignedTo],
      [guest.memberId, 'Sam Player', 'Activity', 'A round of golf', 'Tuesday afternoon, please.', 'Tuesday afternoon', 'Received', '', 0, '']);
    assert.equal(r.history.length, 1);
    assert.match(r.history[0], new RegExp(`^${RECEIVED_LINE} · \\d{4}-\\d{2}-\\d{2}T`));
    assert.equal(RECEIVED_LINE, 'Request received. Courtside will review the details.');
    assert.deepEqual(Object.keys(readMock().concierge_requests[0]), [...TAB_HEADERS.ConciergeRequests]);
    assert.equal(logCodes().at(-1), 'concierge_create');
    const list = await callRoute('concierge', { cookie: guest.cookie });
    assert.deepEqual(list.json.requests.map((x) => x.conciergeId), [r.conciergeId]);
    assert.ok(Array.isArray(list.json.requests[0].history));
  });

  test('GET: members see their own rows, the organizer the whole group; 401 without a cookie', async () => {
    const { org, guest } = await groupWithGuest();
    await create(guest.cookie);
    await create(org.cookie, { subject: 'Organizer ask' });
    assert.deepEqual((await callRoute('concierge', { cookie: guest.cookie })).json.requests.map((r) => r.subject), ['A round of golf']);
    assert.deepEqual((await callRoute('concierge', { cookie: org.cookie })).json.requests.map((r) => r.subject), ['A round of golf', 'Organizer ask']);
    assert.equal((await callRoute('concierge')).status, 401);
  });

  test('a Proposal question sets the member\'s proposalStatus to Review requested', async () => {
    const { guest } = await groupWithGuest();
    await create(guest.cookie, { category: 'Proposal question', subject: 'Single room?', details: 'Can I have a single room?', timing: '' });
    assert.equal(readMock().group_members.find((m) => m.member_id === guest.memberId).proposal_status, 'Review requested');
  });

  test('validation messages', async () => {
    const { guest } = await groupWithGuest();
    const bad = await concierge({ action: 'create', category: 'Spa', subject: '', details: '', timing: 'x'.repeat(61) }, guest.cookie);
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.json.errors, {
      category: 'Choose a request type from the list.', subject: 'Give the request a subject.', details: 'Tell us what you need.', timing: 'Keep the timing under 60 characters.',
    });
    assert.equal((await create(guest.cookie, { subject: 'x'.repeat(161) })).json.errors.subject, 'Keep the subject under 160 characters.');
    assert.equal((await create(guest.cookie, { details: 'x'.repeat(4001) })).json.errors.details, 'Keep the details under 4,000 characters.');
    assert.deepEqual((await concierge({ action: 'cancel' }, guest.cookie)).json.errors, { conciergeId: 'Choose a request from your list.' });
    assert.deepEqual((await concierge({ action: 'book' }, guest.cookie)).json.errors, { action: 'That action is not available.' });
  });

  test('cancel: own request, not Confirmed; adds a history line; 403 someone else\'s, 404 unknown or another group\'s', async () => {
    const { org, guest } = await groupWithGuest();
    const mine = (await create(guest.cookie)).json.request;
    assert.equal((await concierge({ action: 'cancel', conciergeId: mine.conciergeId }, org.cookie)).status, 403, 'not even the organizer');
    const other = await createGroup({ name: 'Bea Other' });
    const theirs = (await create(other.cookie)).json.request;
    assert.equal((await concierge({ action: 'cancel', conciergeId: theirs.conciergeId }, guest.cookie)).status, 404);
    assert.equal((await concierge({ action: 'cancel', conciergeId: 'CSR-NOPE0000' }, guest.cookie)).status, 404);
    const res = await concierge({ action: 'cancel', conciergeId: mine.conciergeId }, guest.cookie);
    assert.equal(res.status, 200);
    assert.equal(res.json.request.status, 'Canceled');
    assert.equal(res.json.request.history.length, 2);
    assert.match(res.json.request.history[1], /^Request canceled by Sam Player\. · /);
    const twice = await concierge({ action: 'cancel', conciergeId: mine.conciergeId }, guest.cookie);
    assert.equal(twice.status, 409);
    assert.deepEqual(twice.json, { ok: false, ...CONCIERGE_CONFLICTS.canceled });
    const second = (await create(guest.cookie, { subject: 'Transfer' })).json.request;
    await courtsideSets(second.conciergeId, { status: 'Confirmed' });
    const confirmed = await concierge({ action: 'cancel', conciergeId: second.conciergeId }, guest.cookie);
    assert.equal(confirmed.status, 409);
    assert.deepEqual(confirmed.json, { ok: false, reason: 'confirmed', message: 'This request is already confirmed. Ask Courtside to change it.' });
    assert.ok(logCodes().includes('concierge_cancel'));
  });

  test('approve / decline only from Approval needed; history line; Log', async () => {
    const { guest } = await groupWithGuest();
    const a = (await create(guest.cookie)).json.request;
    const notYet = await concierge({ action: 'approve', conciergeId: a.conciergeId }, guest.cookie);
    assert.equal(notYet.status, 409);
    assert.deepEqual(notYet.json, { ok: false, reason: 'not_awaiting_approval', message: 'This request is not waiting for your approval.' });
    await courtsideSets(a.conciergeId, { status: 'Approval needed', offer: 'Tee time 15:00 at Las Colinas', cost: 150 });
    const ok = await concierge({ action: 'approve', conciergeId: a.conciergeId }, guest.cookie);
    assert.equal(ok.status, 200);
    assert.deepEqual([ok.json.request.status, ok.json.request.cost, ok.json.request.offer], ['Approved', 150, 'Tee time 15:00 at Las Colinas']);
    assert.match(ok.json.request.history.at(-1), /^Offer approved by Sam Player\. · /);
    assert.equal((await concierge({ action: 'decline', conciergeId: a.conciergeId }, guest.cookie)).status, 409, 'already approved');
    const b = (await create(guest.cookie, { subject: 'Spa' })).json.request;
    await courtsideSets(b.conciergeId, { status: 'Approval needed', cost: 90 });
    const no = await concierge({ action: 'decline', conciergeId: b.conciergeId }, guest.cookie);
    assert.equal(no.json.request.status, 'Declined');
    assert.match(no.json.request.history.at(-1), /^Offer declined by Sam Player\. · /);
    assert.ok(logCodes().includes('concierge_approve'));
    assert.ok(logCodes().includes('concierge_decline'));
  });
});

describe('GET /api/proposal (draft on first read, pricing rules)', () => {
  test('a player: base 2995, no extras, deposit_per_person, balance due 60 days before the week start, version 1', async () => {
    const { guest } = await groupWithGuest();
    const { status, json } = await callRoute('proposal', { cookie: guest.cookie });
    assert.equal(status, 200, JSON.stringify(json));
    assert.deepEqual(Object.keys(json), ['ok', 'proposal', 'settings']);
    assert.deepEqual(json.settings, { depositDueDays: 7 });
    const p = json.proposal;
    assert.match(p.proposalId, /^CSP-/);
    assert.deepEqual(
      [p.memberId, p.tripId, p.week, p.role, p.players, p.partners, p.inclusions, p.addons, p.basePrice, p.extrasTotal, p.packageTotal, p.currency, p.depositAmount, p.balanceDueDate, p.status, p.version],
      [guest.memberId, 'spain', 'Feb 7–13', 'Player', '6', '2', INCLUSIONS, '', 2995, 0, 2995, 'USD', 300, '2026-12-09', 'draft', 1],
    );
    assert.equal(addDays('2027-02-07', -60), '2026-12-09');
    assert.equal(p.requestId, readMock().groups[0].request_id);
    assert.deepEqual(Object.keys(readMock().proposals[0]), [...TAB_HEADERS.Proposals]);
    assert.equal(INCLUSIONS, 'Six-night resort stay; Four tennis mornings; Daily breakfast; Scheduled club transfers; Welcome + farewell dinners; Courtside trip support');
    const again = await callRoute('proposal', { cookie: guest.cookie });
    assert.equal(again.json.proposal.proposalId, p.proposalId);
    assert.equal(again.json.proposal.version, 1, 'nothing changed, no bump');
    assert.equal(readMock().proposals.length, 1);
  });

  test('a non-playing partner: base 1995; the room comes from the member', async () => {
    const { guest } = await groupWithGuest('Non-playing partner');
    await callRoute('member', { body: { action: 'preferences', participation: 'Interested', role: 'Non-playing partner', level: '', tennis: 'Non-playing partner', room: 'Private room', roommate: '', interests: [], care: '', complete: true }, cookie: guest.cookie });
    const p = (await callRoute('proposal', { cookie: guest.cookie })).json.proposal;
    assert.deepEqual([p.basePrice, p.packageTotal, p.role, p.room], [BASE_PRICES.partner, 1995, 'Non-playing partner', 'Private room']);
  });

  test('approved concierge extras add to the package; while draft a change bumps the version; base stays as stored', async () => {
    const { guest } = await groupWithGuest();
    await callRoute('proposal', { cookie: guest.cookie });
    const golf = (await create(guest.cookie)).json.request;
    const spa = (await create(guest.cookie, { subject: 'Spa morning' })).json.request;
    await courtsideSets(golf.conciergeId, { status: 'Approval needed', cost: 150 });
    await courtsideSets(spa.conciergeId, { status: 'Approval needed', cost: '$90' });
    await concierge({ action: 'approve', conciergeId: golf.conciergeId }, guest.cookie);
    await concierge({ action: 'approve', conciergeId: spa.conciergeId }, guest.cookie);
    const unapproved = (await create(guest.cookie, { subject: 'Not yet' })).json.request;
    await courtsideSets(unapproved.conciergeId, { status: 'Approval needed', cost: 999 });
    const p = (await callRoute('proposal', { cookie: guest.cookie })).json.proposal;
    assert.deepEqual([p.addons, p.extrasTotal, p.packageTotal, p.version], ['A round of golf, Spa morning', 240, 3235, 2]);
    await editMock((d) => { d.proposals[0].base_price = 2800; });
    const q = (await callRoute('proposal', { cookie: guest.cookie })).json.proposal;
    assert.deepEqual([q.basePrice, q.packageTotal, q.version], [2800, 3040, 3], 'Courtside\'s base survives; the total follows it');
    await editMock((d) => { d.proposals[0].status = 'sent'; });
    await courtsideSets(unapproved.conciergeId, { status: 'Approved' });
    const sent = (await callRoute('proposal', { cookie: guest.cookie })).json.proposal;
    assert.deepEqual([sent.extrasTotal, sent.version, sent.status], [240, 3, 'sent'], 'a sent proposal is returned as stored');
  });

  test('group payment: deposit_per_group on the organizer, 0 for the others; Settings drive the numbers; flexible → no due date', async () => {
    const { org, guest } = await groupWithGuest();
    await editMock((d) => {
      d.groups[0].payment_mode = 'Organizer requests group payment';
      d.settings.find((s) => s.key === 'deposit_per_group').value = 2500;
      d.settings.find((s) => s.key === 'balance_due_days_before').value = 30;
      d.settings.find((s) => s.key === 'currency').value = 'eur';
    });
    const o = (await callRoute('proposal', { cookie: org.cookie })).json.proposal;
    assert.deepEqual([o.depositAmount, o.currency, o.balanceDueDate, o.role], [2500, 'EUR', '2027-01-08', 'Organizer + player']);
    const g = (await callRoute('proposal', { cookie: guest.cookie })).json.proposal;
    assert.equal(g.depositAmount, 0);
    const flex = await createGroup({ name: 'Flo Flex', weeks: ['flexible'] });
    const f = (await callRoute('proposal', { cookie: flex.cookie })).json.proposal;
    assert.deepEqual([f.week, f.balanceDueDate], ['Flexible', '']);
    assert.equal((await callRoute('proposal')).status, 401);
  });
});

describe('POST /api/proposal accept', () => {
  test('accepted, the member to Payment pending / Deposit pending, one pending deposit due in deposit_due_days, the stage to Proposal sent', async () => {
    const { org } = await groupWithGuest();
    const p = (await callRoute('proposal', { cookie: org.cookie })).json.proposal;
    const { status, json } = await callRoute('proposal', { body: { action: 'accept', proposalId: p.proposalId }, cookie: org.cookie });
    assert.equal(status, 200, JSON.stringify(json));
    assert.deepEqual(Object.keys(json), ['ok', 'proposal', 'payment']);
    assert.equal(json.proposal.status, 'accepted');
    assert.ok(json.proposal.acceptedAt);
    const pay = json.payment;
    assert.match(pay.paymentId, /^CSY-[0-9A-HJKMNP-TV-Z]{8}$/);
    assert.deepEqual(
      [pay.proposalId, pay.memberId, pay.payerName, pay.payerEmail, pay.type, pay.amount, pay.currency, pay.method, pay.providerRef, pay.status, pay.dueDate, pay.paidAt, pay.notes],
      [p.proposalId, org.memberId, 'Ana Guest', readMock().groups[0].organizer_email, 'deposit', 300, 'USD', '', '', 'pending', addDays(todayYmd(), 7), '', ''],
    );
    assert.deepEqual(Object.keys(readMock().payments[0]), [...TAB_HEADERS.Payments]);
    const m = readMock().group_members.find((x) => x.member_id === org.memberId);
    assert.deepEqual([m.proposal_status, m.payment_status], ['Payment pending', 'Deposit pending']);
    assert.equal(readMock().groups[0].stage, 'Proposal sent');
    assert.deepEqual(logCodes().slice(-2), ['proposal_accept', 'payment_create']);
    const twice = await callRoute('proposal', { body: { action: 'accept', proposalId: p.proposalId }, cookie: org.cookie });
    assert.equal(twice.status, 409);
    assert.deepEqual(twice.json, { ok: false, ...PROPOSAL_CONFLICTS.accepted });
    assert.equal(readMock().payments.length, 1);
  });

  test('a member\'s accept leaves the stage; a zero deposit writes no payment; sent is acceptable, declined is not; someone else\'s is 404', async () => {
    const { org, guest } = await groupWithGuest();
    await editMock((d) => { d.groups[0].payment_mode = 'Organizer requests group payment'; });
    const p = (await callRoute('proposal', { cookie: guest.cookie })).json.proposal;
    const orgP = (await callRoute('proposal', { cookie: org.cookie })).json.proposal;
    assert.equal((await callRoute('proposal', { body: { action: 'accept', proposalId: orgP.proposalId }, cookie: guest.cookie })).status, 404);
    await editMock((d) => { d.proposals.find((x) => x.proposal_id === p.proposalId).status = 'sent'; });
    const res = await callRoute('proposal', { body: { action: 'accept', proposalId: p.proposalId }, cookie: guest.cookie });
    assert.equal(res.status, 200);
    assert.equal(res.json.payment, null);
    assert.equal(readMock().payments.length, 0);
    assert.equal(readMock().groups[0].stage, 'Inquiry', 'only the organizer moves the stage');
    const host = readMock().groups[0].organizer_name;
    assert.equal(readMock().group_members.find((x) => x.member_id === guest.memberId).payment_status, `Group host ${host} owes`, 'never "Not due" when the host pays');
    await editMock((d) => { d.proposals.find((x) => x.proposal_id === orgP.proposalId).status = 'declined'; });
    const declined = await callRoute('proposal', { body: { action: 'accept', proposalId: orgP.proposalId }, cookie: org.cookie });
    assert.equal(declined.status, 409);
    assert.equal(declined.json.reason, 'declined');
  });

  test('a stage Courtside already moved to Confirmed stays; validation; 401', async () => {
    const org = await createGroup();
    const p = (await callRoute('proposal', { cookie: org.cookie })).json.proposal;
    await editMock((d) => { d.groups[0].stage = 'Confirmed'; });
    await callRoute('proposal', { body: { action: 'accept', proposalId: p.proposalId }, cookie: org.cookie });
    assert.equal(readMock().groups[0].stage, 'Confirmed');
    assert.deepEqual((await callRoute('proposal', { body: { action: 'accept' }, cookie: org.cookie })).json.errors, { proposalId: 'Open your proposal again.' });
    assert.deepEqual((await callRoute('proposal', { body: { action: 'pay', proposalId: p.proposalId }, cookie: org.cookie })).json.errors, { action: 'That action is not available.' });
    assert.equal((await callRoute('proposal', { body: { action: 'accept', proposalId: p.proposalId } })).status, 401);
  });
});

describe('GET /api/payments', () => {
  test('own rows for a member, the group\'s for the organizer; Courtside\'s paid status shows on the next read', async () => {
    const { org, guest } = await groupWithGuest();
    for (const who of [org, guest]) {
      const p = (await callRoute('proposal', { cookie: who.cookie })).json.proposal;
      await callRoute('proposal', { body: { action: 'accept', proposalId: p.proposalId }, cookie: who.cookie });
    }
    const mine = await callRoute('payments', { cookie: guest.cookie });
    assert.equal(mine.status, 200);
    assert.deepEqual(Object.keys(mine.json), ['ok', 'payments']);
    assert.deepEqual(mine.json.payments.map((p) => p.memberId), [guest.memberId]);
    assert.equal((await callRoute('payments', { cookie: org.cookie })).json.payments.length, 2);
    await editMock((d) => { d.payments[1].status = 'paid'; d.payments[1].paid_at = '2026-11-10T10:00:00Z'; });
    const after = (await callRoute('payments', { cookie: guest.cookie })).json.payments[0];
    assert.deepEqual([after.status, after.paidAt, after.amount], ['paid', '2026-11-10T10:00:00Z', 300]);
    assert.equal((await callRoute('payments')).status, 401);
    const other = await createGroup({ name: 'Bea Other' });
    assert.deepEqual((await callRoute('payments', { cookie: other.cookie })).json.payments, []);
  });
});
