// tests/api.group.test.js
// Wave 2 identity and the group routes (CONCEPT02_WAVE2_PLAN.md section 6) in mock mode: the
// cs_member cookie (lib/access.js), the group path of POST /api/inquiry, GET/POST /api/group and
// every POST /api/member action, with the 401/403/404/400 cases, the shared "group" rate limit and
// the Log rows.

import { test, describe, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  MEMBER_COOKIE_MAX_AGE, MEMBER_COOKIE_NAME, buildMemberCookie, isOrganizerRole, memberSession, requireMember, signMember,
} from '../lib/access.js';
import { sign } from '../lib/cookie.js';
import { DEV_COOKIE_SECRET } from '../lib/guard.js';
import { _resetDoubleSubmit } from '../api/inquiry.js';
import { DUPLICATE_EMAIL, REMOVE_SELF } from '../api/member.js';
import { _resetLineupCache } from '../api/lineup.js';
import { _resetSentLog } from '../lib/email.js';
import { LIMITS, _reset as resetRateLimit } from '../lib/ratelimit.js';
import { _resetSettingsCache } from '../lib/settings.js';
import { TAB_HEADERS } from '../lib/store.columns.js';
import {
  BASE, callRoute, createGroup, editMock, freshMockPath, getRequest, memberCookieOf, readMock, tempDir, useMockEnv,
} from './api.helpers.js';

const MEMBER_ID = /^CSM-[0-9A-HJKMNP-TV-Z]{8}$/;
const GROUP_ID = /^CSG-[0-9A-HJKMNP-TV-Z]{8}$/;

let dir;
let quiet;
before(() => { dir = tempDir('courtside-group-'); useMockEnv(); quiet = mock.method(console, 'log', () => {}); });
after(() => { quiet.mock.restore(); fs.rmSync(dir, { recursive: true, force: true }); });
beforeEach(() => { freshMockPath(dir); resetRateLimit(); _resetDoubleSubmit(); _resetLineupCache(); _resetSentLog(); _resetSettingsCache(); useMockEnv(); });

const member = (body, cookie, ip) => callRoute('member', { body, cookie, ip });
const logCodes = () => readMock().log.map((l) => l.code);

// An organizer plus one added member who opened their link: -> { org, guest }
async function groupWithGuest(role = 'Player') {
  const org = await createGroup();
  const added = await member({ action: 'add', name: 'Sam Player', email: 'sam@example.com', role }, org.cookie);
  assert.equal(added.status, 200, JSON.stringify(added.json));
  const opened = await member({ action: 'open', memberId: added.json.member.memberId });
  return { org, guest: { memberId: added.json.member.memberId, cookie: memberCookieOf(opened.res) } };
}

describe('lib/access.js (cs_member)', () => {
  test('the cookie: name, 90 days, HttpOnly, SameSite=Lax, Secure only when asked', () => {
    assert.equal(MEMBER_COOKIE_NAME, 'cs_member');
    assert.equal(MEMBER_COOKIE_MAX_AGE, 7_776_000);
    assert.equal(buildMemberCookie('t'), 'cs_member=t; Path=/; HttpOnly; SameSite=Lax; Max-Age=7776000');
    assert.equal(buildMemberCookie('t', { secure: true }), 'cs_member=t; Path=/; HttpOnly; SameSite=Lax; Max-Age=7776000; Secure');
  });

  test('round trip, and anything else is null: wrong scope, wrong secret, expired, missing ids, the invite cookie', async () => {
    const req = (token, name = 'cs_member') => getRequest('/api/group', { cookie: `${name}=${token}` });
    const token = await signMember({ groupId: 'CSG-1', memberId: 'CSM-1' }, DEV_COOKIE_SECRET);
    const payload = await memberSession(req(token), DEV_COOKIE_SECRET);
    assert.equal(payload.scope, 'member');
    assert.deepEqual([payload.groupId, payload.memberId], ['CSG-1', 'CSM-1']);
    assert.ok(payload.exp > Date.now() + 89 * 86400_000);
    assert.equal(await memberSession(req(token), 'other-secret'), null);
    assert.equal(await memberSession(req(token, 'cs_session'), DEV_COOKIE_SECRET), null, 'cs_session is not a member cookie');
    const wrongScope = await sign({ code: 'GUEST1', groupId: 'CSG-1', memberId: 'CSM-1', exp: Date.now() + 60_000 }, DEV_COOKIE_SECRET);
    assert.equal(await memberSession(req(wrongScope), DEV_COOKIE_SECRET), null, 'an invite payload is not a member payload');
    const expired = await sign({ scope: 'member', groupId: 'CSG-1', memberId: 'CSM-1', exp: Date.now() - 1 }, DEV_COOKIE_SECRET);
    assert.equal(await memberSession(req(expired), DEV_COOKIE_SECRET), null);
    const noIds = await sign({ scope: 'member', groupId: '', memberId: 'CSM-1', exp: Date.now() + 60_000 }, DEV_COOKIE_SECRET);
    assert.equal(await memberSession(req(noIds), DEV_COOKIE_SECRET), null);
    assert.equal(await memberSession(getRequest('/api/group'), DEV_COOKIE_SECRET), null);
  });

  test('requireMember: the context for a live member, 401 when the member is removed, unknown or in another group', async () => {
    const org = await createGroup();
    const ctx = await requireMember(getRequest('/api/group', { cookie: org.cookie }));
    assert.equal(ctx.groupId, org.groupId);
    assert.equal(ctx.memberId, org.memberId);
    assert.equal(ctx.isOrganizer, true);
    assert.equal(ctx.group.stage, 'Inquiry');
    assert.equal(isOrganizerRole('Organizer + partner'), true);
    assert.equal(isOrganizerRole('Player'), false);

    const forged = `cs_member=${await signMember({ groupId: 'CSG-OTHER000', memberId: org.memberId }, DEV_COOKIE_SECRET)}`;
    const wrongGroup = await requireMember(getRequest('/api/group', { cookie: forged }));
    assert.equal(wrongGroup.status, 401);
    assert.deepEqual(await wrongGroup.json(), { ok: false, reason: 'unauthorized' });
    const ghost = `cs_member=${await signMember({ groupId: org.groupId, memberId: 'CSM-NOPE0000' }, DEV_COOKIE_SECRET)}`;
    assert.equal((await requireMember(getRequest('/api/group', { cookie: ghost }))).status, 401);
    await editMock((d) => { d.group_members[0].removed = 'TRUE'; });
    assert.equal((await requireMember(getRequest('/api/group', { cookie: org.cookie }))).status, 401);
  });
});

describe('POST /api/inquiry, group path', () => {
  test('creates the Groups row and the organizer row, sets cs_member, adds groupId and memberId, logs group_create + member_add', async () => {
    const org = await createGroup({ name: '  Ana Guest ', email: 'Ana.Guest@Example.com', weeks: ['w5'], players: '6', partners: '2', notes: 'A birthday week.' });
    assert.match(org.groupId, GROUP_ID);
    assert.match(org.memberId, MEMBER_ID);
    assert.match(org.cookie, /^cs_member=/);
    const { requests, groups, group_members: members } = readMock();
    assert.equal(groups.length, 1);
    const g = groups[0];
    assert.deepEqual(Object.keys(g), [...TAB_HEADERS.Groups]);
    assert.deepEqual({ ...g, created_at: 'T', updated_at: 'T' }, {
      group_id: org.groupId, request_id: org.requestId, trip_id: 'spain', name: 'Ana’s Spain group',
      organizer_name: 'Ana Guest', organizer_email: 'ana.guest@example.com', weeks: 'Feb 7–13', chosen_week: 'w5',
      players: 6, partners: 2, tennis: 'Daily tennis', payment_mode: 'Individual travelers', notes: 'A birthday week.',
      stage: 'Inquiry', review_needed: 'FALSE', created_at: 'T', updated_at: 'T',
    });
    assert.equal(requests[0].request_id, org.requestId);
    assert.equal(members.length, 1);
    const m = members[0];
    assert.deepEqual(Object.keys(m), [...TAB_HEADERS.GroupMembers]);
    assert.deepEqual([m.member_id, m.group_id, m.name, m.email, m.role, m.invite_status, m.participation, m.planning_complete, m.tennis, m.proposal_status, m.payment_status, m.removed],
      [org.memberId, org.groupId, 'Ana Guest', 'ana.guest@example.com', 'Organizer + player', 'Responded', 'Interested', 'FALSE', 'Daily tennis', 'Draft', 'Not due', 'FALSE']);
    assert.ok(m.joined_at);
    assert.deepEqual(logCodes(), ['inquiry_submit', 'group_create', 'member_add']);
    assert.deepEqual(readMock().log.slice(1).map((l) => l.result), [org.groupId, org.memberId]);
  });

  test('flexible stores chosen_week flexible; the match path, the honeypot and a double submit create no group', async () => {
    const flex = await createGroup({ weeks: ['flexible'] });
    assert.equal(readMock().groups[0].chosen_week, 'flexible');
    assert.equal(readMock().groups[0].weeks, 'Flexible');
    const { POST } = await import('../api/inquiry.js');
    const { jsonRequest } = await import('./api.helpers.js');
    const send = (body) => POST(jsonRequest('/api/inquiry', body, { headers: { 'x-forwarded-for': '198.51.100.9' } }));
    const matchRes = await send({ path: 'match', weeks: ['w2'], party: 'Solo', level: '', tennis: 'Four mornings', name: 'M', email: 'm@example.com', consent: true });
    assert.deepEqual(Object.keys(await matchRes.json()), ['ok', 'requestId']);
    assert.equal(memberCookieOf(matchRes), null);
    const pot = await send({ path: 'group', weeks: ['w5'], players: '', partners: '', tennis: 'Daily tennis', name: 'B', email: 'b@example.com', consent: true, website: 'x' });
    assert.deepEqual(Object.keys(await pot.json()), ['ok', 'requestId']);
    assert.equal(readMock().groups.length, 1, 'only the flexible group');
    const body = { path: 'group', weeks: ['flexible'], players: '6', partners: '2', tennis: 'Daily tennis', name: 'Ana Guest', email: readMock().groups[0].organizer_email, notes: 'A birthday week.', consent: true };
    const again = await (await send(body)).json();
    assert.equal(again.groupId, flex.groupId, 'the double submit returns the first response, group ids included');
    assert.equal(readMock().groups.length, 1);
  });
});

describe('GET /api/group', () => {
  test('401 without a cookie', async () => {
    const res = await callRoute('group');
    assert.equal(res.status, 401);
    assert.deepEqual(res.json, { ok: false, reason: 'unauthorized' });
    assert.equal(res.res.headers.get('cache-control'), 'no-store');
  });

  test('the organizer sees the group, me, every non-removed member with every column, and the week labels', async () => {
    const { org, guest } = await groupWithGuest();
    await member({ action: 'add', name: 'Gone', email: 'gone@example.com', role: 'Player' }, org.cookie);
    const goneId = readMock().group_members.at(-1).member_id;
    await member({ action: 'remove', memberId: goneId }, org.cookie);
    const { status, json } = await callRoute('group', { cookie: org.cookie });
    assert.equal(status, 200);
    assert.deepEqual(Object.keys(json), ['ok', 'group', 'me', 'members', 'weekLabels']);
    assert.equal(json.group.groupId, org.groupId);
    assert.equal(json.group.reviewNeeded, false);
    assert.equal(json.me.memberId, org.memberId);
    assert.equal(json.me.role, 'Organizer + player');
    assert.equal(json.me.isOrganizer, true);
    assert.ok(json.group.organizerEmail, 'the organizer sees their own email');
    assert.deepEqual(json.members.map((m) => m.memberId), [org.memberId, guest.memberId]);
    assert.equal(Object.keys(json.members[1]).length, TAB_HEADERS.GroupMembers.length);
    assert.equal(json.members[1].email, 'sam@example.com');
    assert.equal(json.members[1].paymentStatus, 'Not due');
    assert.equal(json.weekLabels.w5, 'Feb 7–13');
    assert.equal(Object.keys(json.weekLabels).length, 7);
  });

  test('other members get the trimmed member shape only', async () => {
    const { guest } = await groupWithGuest();
    const { json } = await callRoute('group', { cookie: guest.cookie });
    assert.equal(json.me.isOrganizer, false);
    assert.equal(json.group.organizerEmail, '', 'members never receive the organizer email');
    assert.equal(json.me.memberId, guest.memberId);
    assert.equal(json.me.email, 'sam@example.com', 'me is the member\'s own full row');
    for (const m of json.members) assert.deepEqual(Object.keys(m), ['memberId', 'name', 'role', 'participation', 'planningComplete']);
  });
});

describe('POST /api/group update', () => {
  const update = (o = {}) => ({ action: 'update', name: 'Spain 2027', chosenWeek: 'w3', tennis: 'Four mornings', paymentMode: 'Organizer requests group payment', ...o });

  test('the organizer updates the group: weeks becomes the label, reviewNeeded TRUE, Log group_update', async () => {
    const org = await createGroup();
    const { status, json } = await callRoute('group', { body: update(), cookie: org.cookie });
    assert.equal(status, 200, JSON.stringify(json));
    assert.deepEqual([json.group.name, json.group.chosenWeek, json.group.weeks, json.group.tennis, json.group.paymentMode, json.group.reviewNeeded],
      ['Spain 2027', 'w3', 'Jan 24–30', 'Four mornings', 'Organizer requests group payment', true]);
    assert.equal(readMock().groups[0].review_needed, 'TRUE');
    const flex = await callRoute('group', { body: update({ chosenWeek: 'flexible' }), cookie: org.cookie });
    assert.equal(flex.json.group.weeks, 'Flexible');
    assert.equal(logCodes().at(-1), 'group_update');
    assert.equal(readMock().log.at(-1).result, org.groupId);
  });

  test('400s with complete sentences; 403 for a member; 401 without a cookie', async () => {
    const { org, guest } = await groupWithGuest();
    const bad = await callRoute('group', { body: { action: 'rename', name: '', chosenWeek: 'w9', tennis: 'Daily Tennis', paymentMode: 'Card' }, cookie: org.cookie });
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.json.errors, {
      action: 'That action is not available.', name: 'Enter a group name.', chosenWeek: 'Choose a week from the list, or Flexible.',
      tennis: 'Choose a tennis rhythm from the list.', paymentMode: 'Choose how the group will pay.',
    });
    assert.equal((await callRoute('group', { body: update({ name: 'x'.repeat(121) }), cookie: org.cookie })).json.errors.name, 'Keep the group name under 120 characters.');
    assert.equal((await callRoute('group', { body: update(), cookie: guest.cookie })).status, 403);
    assert.deepEqual((await callRoute('group', { body: update(), cookie: guest.cookie })).json, { ok: false, reason: 'forbidden' });
    assert.equal((await callRoute('group', { body: update() })).status, 401);
    const notJson = await callRoute('group', { body: '{oops', cookie: org.cookie });
    assert.deepEqual(notJson.json, { ok: false, errors: { body: 'Send the request as JSON.' } });
  });
});

describe('POST /api/member', () => {
  test('add: appends Not invited and returns the link; a duplicate email is a 400; Log member_add', async () => {
    const org = await createGroup();
    const { status, json } = await member({ action: 'add', name: 'Sam Player', email: 'Sam@Example.com', role: 'Non-playing partner' }, org.cookie);
    assert.equal(status, 200);
    assert.deepEqual(Object.keys(json), ['ok', 'member', 'link']);
    assert.match(json.member.memberId, MEMBER_ID);
    assert.equal(json.link, `/#/join/${json.member.memberId}`);
    assert.deepEqual([json.member.inviteStatus, json.member.participation, json.member.role, json.member.email, json.member.proposalStatus],
      ['Not invited', '', 'Non-playing partner', 'sam@example.com', 'Draft']);
    const dup = await member({ action: 'add', name: 'Again', email: 'sam@example.com', role: 'Player' }, org.cookie);
    assert.equal(dup.status, 400);
    assert.deepEqual(dup.json.errors, { email: 'That email is already in your group.' });
    assert.equal(DUPLICATE_EMAIL, 'That email is already in your group.');
    const orgDup = await member({ action: 'add', name: 'Me', email: readMock().groups[0].organizer_email, role: 'Player' }, org.cookie);
    assert.equal(orgDup.status, 400, 'the organizer\'s own email counts');
    assert.equal(logCodes().filter((c) => c === 'member_add').length, 2, 'the organizer row and Sam');
  });

  test('invite sets Link shared, invitedAt and an optional new email; cancel and remove; the organizer is protected', async () => {
    const { org, guest } = await groupWithGuest();
    const inv = await member({ action: 'invite', memberId: guest.memberId, email: 'sam.new@example.com' }, org.cookie);
    assert.equal(inv.status, 200);
    assert.deepEqual([inv.json.member.inviteStatus, inv.json.member.email, inv.json.link], ['Link shared', 'sam.new@example.com', `/#/join/${guest.memberId}`]);
    assert.ok(inv.json.member.invitedAt);
    const noEmail = await member({ action: 'invite', memberId: guest.memberId }, org.cookie);
    assert.equal(noEmail.json.member.email, 'sam.new@example.com', 'resend keeps the email');
    const cancel = await member({ action: 'cancel', memberId: guest.memberId }, org.cookie);
    assert.deepEqual([cancel.json.member.inviteStatus, cancel.json.member.participation], ['Invitation canceled', '']);
    assert.deepEqual((await member({ action: 'remove', memberId: org.memberId }, org.cookie)).json.errors, { memberId: REMOVE_SELF });
    const removed = await member({ action: 'remove', memberId: guest.memberId }, org.cookie);
    assert.equal(removed.json.member.removed, true);
    assert.equal(readMock().group_members.length, 2, 'never deleted');
    assert.equal((await member({ action: 'invite', memberId: guest.memberId }, org.cookie)).status, 404, 'a removed member is gone');
    assert.equal((await member({ action: 'open', memberId: guest.memberId })).status, 404);
    for (const code of ['member_invite', 'member_cancel', 'member_remove']) assert.ok(logCodes().includes(code), code);
  });

  test('organizer actions: 403 for a member, 404 for a member of another group, 401 without a cookie', async () => {
    const { org, guest } = await groupWithGuest();
    const other = await createGroup({ name: 'Bea Other' });
    for (const body of [{ action: 'add', name: 'X', email: 'x@example.com', role: 'Player' }, { action: 'invite', memberId: org.memberId }, { action: 'cancel', memberId: org.memberId }, { action: 'remove', memberId: org.memberId }]) {
      assert.equal((await member(body, guest.cookie)).status, 403, body.action);
      assert.equal((await member(body)).status, 401, body.action);
    }
    assert.equal((await member({ action: 'invite', memberId: other.memberId }, org.cookie)).status, 404);
    assert.deepEqual((await member({ action: 'remove', memberId: other.memberId }, org.cookie)).json, { ok: false, reason: 'not_found' });
  });

  test('open: sets cs_member, returns the public group and the member; unknown → 404; Log member_open', async () => {
    const { org, guest } = await groupWithGuest();
    const res = await member({ action: 'open', memberId: guest.memberId });
    assert.equal(res.status, 200);
    assert.match(memberCookieOf(res.res), /^cs_member=/);
    assert.match(res.res.headers.get('set-cookie'), /HttpOnly; SameSite=Lax; Max-Age=7776000$/, 'no Secure on http://localhost');
    assert.deepEqual(Object.keys(res.json), ['ok', 'group', 'member', 'isOrganizer']);
    assert.deepEqual(res.json.group, { groupId: org.groupId, name: 'Ana’s Spain group', organizerName: 'Ana Guest', chosenWeek: 'w5', weekLabel: 'Feb 7–13', tennis: 'Daily tennis', stage: 'Inquiry' });
    assert.equal(res.json.member.memberId, guest.memberId);
    assert.equal(res.json.isOrganizer, false);
    assert.equal((await member({ action: 'open', memberId: org.memberId })).json.isOrganizer, true);
    assert.equal((await member({ action: 'open', memberId: 'CSM-NOPE0000' })).status, 404);
    assert.deepEqual((await member({ action: 'open' })).json.errors, { memberId: 'Open your personal link again.' });
    assert.ok(logCodes().includes('member_open'));
  });

  test('join: appends a member (Responded, Interested) or reuses one with the same email; unknown group → 404', async () => {
    const { org, guest } = await groupWithGuest();
    const res = await member({ action: 'join', groupId: org.groupId, name: 'Jo New', email: 'jo@example.com', role: 'Player' });
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.json), ['ok', 'memberId', 'member', 'group', 'isOrganizer']);
    assert.match(res.json.memberId, MEMBER_ID);
    assert.deepEqual([res.json.member.inviteStatus, res.json.member.participation], ['Responded', 'Interested']);
    assert.ok(res.json.member.joinedAt);
    assert.match(memberCookieOf(res.res), /^cs_member=/);
    const reuse = await member({ action: 'join', groupId: org.groupId, name: 'Sam P', email: 'SAM@example.com', role: 'Player' });
    assert.equal(reuse.json.memberId, guest.memberId);
    assert.equal(reuse.json.member.inviteStatus, 'Responded');
    assert.equal(readMock().group_members.length, 3);
    assert.equal((await member({ action: 'join', groupId: 'CSG-NOPE0000', name: 'A', email: 'a@example.com', role: 'Player' })).status, 404);
    const bad = await member({ action: 'join', groupId: org.groupId, name: '', email: 'nope', role: 'Organizer + player' });
    assert.deepEqual(bad.json.errors, { name: 'Enter your name.', email: 'Enter a valid email address.', role: 'Choose Player or Non-playing partner.' });
    assert.ok(logCodes().includes('member_join'));
  });

  test('respond: participation, Responded and joinedAt once', async () => {
    const { guest } = await groupWithGuest();
    const a = await member({ action: 'respond', participation: 'Still deciding' }, guest.cookie);
    assert.deepEqual([a.json.member.participation, a.json.member.inviteStatus], ['Still deciding', 'Responded']);
    const joined = a.json.member.joinedAt;
    assert.ok(joined);
    const b = await member({ action: 'respond', participation: 'Not attending' }, guest.cookie);
    assert.equal(b.json.member.joinedAt, joined);
    assert.deepEqual((await member({ action: 'respond', participation: 'Maybe' }, guest.cookie)).json.errors, { participation: 'Choose Interested, Still deciding or Not attending.' });
    assert.equal((await member({ action: 'respond', participation: 'Interested' })).status, 401);
    assert.ok(logCodes().includes('member_respond'));
  });

  test('preferences: every column; the organizer keeps the Organizer prefix; validation', async () => {
    const { org, guest } = await groupWithGuest();
    const prefs = { action: 'preferences', participation: 'Interested', role: 'Non-playing partner', level: '3.5', tennis: 'Non-playing partner', room: 'Shared room', roommate: 'Ana', interests: ['Food + wine', 'Spa'], care: 'No shellfish.', complete: true };
    const g = await member(prefs, guest.cookie);
    assert.equal(g.status, 200, JSON.stringify(g.json));
    assert.deepEqual([g.json.member.role, g.json.member.level, g.json.member.room, g.json.member.roommate, g.json.member.interests, g.json.member.careNotes, g.json.member.planningComplete],
      ['Non-playing partner', '3.5', 'Shared room', 'Ana', 'Food + wine, Spa', 'No shellfish.', true]);
    assert.equal(readMock().group_members[1].planning_complete, 'TRUE');
    const o = await member({ ...prefs, level: 'Not sure yet', complete: false }, org.cookie);
    assert.deepEqual([o.json.member.role, o.json.member.level, o.json.member.planningComplete], ['Organizer + partner', '', false]);
    assert.equal((await member({ ...prefs, role: 'Player' }, org.cookie)).json.member.role, 'Organizer + player');
    const bad = await member({ action: 'preferences', participation: '', role: 'Coach', level: '6.0', tennis: 'Lots', room: 'Suite', interests: ['Skydiving'], care: 'x'.repeat(1001), complete: 'yes' }, guest.cookie);
    assert.deepEqual(bad.json.errors, {
      participation: 'Choose Interested, Still deciding or Not attending.', role: 'Choose Player or Non-playing partner.', level: 'Choose a tennis level from the list.',
      tennis: 'Choose a tennis rhythm from the list.', room: 'Choose a room preference from the list.', interests: 'Choose interests from the list.',
      care: 'Keep the care notes under 1,000 characters.', complete: 'Say whether your planning is complete.',
    });
    assert.equal((await member({ ...prefs, interests: ['Golf', 'Golf'] }, guest.cookie)).json.errors.interests, 'Each interest can be chosen once.');
    assert.ok(logCodes().includes('member_preferences'));
  });

  test('arrival: the four columns; date YYYY-MM-DD or a short note', async () => {
    const { guest } = await groupWithGuest();
    const a = await member({ action: 'arrival', airport: 'ALC', date: '2027-02-07', flight: 'IB 1234', time: '14:05' }, guest.cookie);
    assert.deepEqual([a.json.member.arrivalAirport, a.json.member.arrivalDate, a.json.member.arrivalFlight, a.json.member.arrivalTime], ['ALC', '2027-02-07', 'IB 1234', '14:05']);
    assert.equal((await member({ action: 'arrival', airport: '', date: 'The Saturday before', flight: '', time: '' }, guest.cookie)).status, 200);
    const bad = await member({ action: 'arrival', airport: 'x'.repeat(121), date: 'x'.repeat(41), flight: '', time: '' }, guest.cookie);
    assert.deepEqual(bad.json.errors, { airport: 'Keep the airport under 120 characters.', date: 'Enter the arrival date as YYYY-MM-DD or a note under 40 characters.' });
    assert.ok(logCodes().includes('member_arrival'));
  });

  test('an unknown action is a 400; every action answers JSON with no-store', async () => {
    const org = await createGroup();
    const res = await member({ action: 'delete' }, org.cookie);
    assert.equal(res.status, 400);
    assert.deepEqual(res.json, { ok: false, errors: { action: 'That action is not available.' } });
    assert.equal(res.res.headers.get('cache-control'), 'no-store');
  });
});

describe('rate limit (bucket "group", 30 writes per 10 minutes per IP hash)', () => {
  test('the 31st write from one IP is 429, shared across /api/member, /api/group, /api/concierge and /api/proposal; another IP is fine', async () => {
    assert.deepEqual(LIMITS.group, { limit: 30, windowMs: 600_000 });
    const org = await createGroup();
    const ip = '192.0.2.77';
    for (let i = 0; i < 10; i += 1) assert.equal((await callRoute('member', { body: { action: 'respond', participation: 'Interested' }, cookie: org.cookie, ip })).status, 200);
    for (let i = 0; i < 10; i += 1) assert.equal((await callRoute('group', { body: { action: 'update', name: `G${i}`, chosenWeek: 'w5', tennis: 'Daily tennis', paymentMode: 'Individual travelers' }, cookie: org.cookie, ip })).status, 200);
    for (let i = 0; i < 9; i += 1) assert.equal((await callRoute('concierge', { body: { action: 'create', category: 'Other', subject: `S${i}`, details: 'D' }, cookie: org.cookie, ip })).status, 200);
    assert.equal((await callRoute('proposal', { body: { action: 'accept', proposalId: 'CSP-NOPE0000' }, cookie: org.cookie, ip })).status, 404, 'the 30th still counts');
    const limited = await callRoute('member', { body: { action: 'respond', participation: 'Interested' }, cookie: org.cookie, ip });
    assert.equal(limited.status, 429);
    assert.deepEqual(limited.json, { ok: false, reason: 'rate_limited' });
    assert.equal((await callRoute('member', { body: { action: 'open', memberId: org.memberId }, ip })).status, 429, 'open counts too');
    assert.equal((await callRoute('group', { cookie: org.cookie, ip })).status, 200, 'reads are not limited');
    assert.equal((await callRoute('member', { body: { action: 'respond', participation: 'Interested' }, cookie: org.cookie, ip: '192.0.2.78' })).status, 200);
  });
});

describe('store failures', () => {
  test('a broken store is 500 server_error', async () => {
    const org = await createGroup();
    const errors = mock.method(console, 'error', () => {});
    try {
      const file = process.env.MOCK_DATA_PATH;
      process.env.MOCK_DATA_PATH = dir;
      assert.deepEqual((await callRoute('group', { cookie: org.cookie })).json, { ok: false, reason: 'server_error' });
      assert.equal((await member({ action: 'open', memberId: org.memberId })).status, 500);
      process.env.MOCK_DATA_PATH = file;
    } finally {
      errors.mock.restore();
    }
  });
});

void BASE;

