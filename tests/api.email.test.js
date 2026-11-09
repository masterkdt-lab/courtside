// tests/api.email.test.js
// lib/email.js: log mode, Resend mode over a mocked fetch, and the two templates.

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  GMAIL_SEND_URL, RESEND_URL, _resetSentLog, confirmGuest, emailMode, notifyApplication, notifyInquiry, notifyKatie, notifyWaitlist, sendEmail, sentLog, toRecipients,
} from '../lib/email.js';

const row = {
  requestId: 'CS-ABCDEFGH',
  requestType: 'private',
  weeks: 'Feb 7–13',
  guestName: 'Ana Guest',
  guestEmail: 'ana.guest@example.com',
  guestMobile: '+1 555 0100',
  inviteCode: 'GUEST1',
  invitedBy: 'Katie',
  brief: 'THE SPANISH OFFSEASON — PRIVATE GROUP REQUEST\n\nWeek: Feb 7–13',
};

beforeEach(() => _resetSentLog());

describe('modes and recipients', () => {
  test('emailMode defaults to log; resend and its alias send select Resend', () => {
    assert.equal(emailMode({}), 'log');
    assert.equal(emailMode({ EMAIL_MODE: 'log' }), 'log');
    assert.equal(emailMode({ EMAIL_MODE: 'RESEND' }), 'resend');
    assert.equal(emailMode({ EMAIL_MODE: 'send' }), 'resend');
    assert.equal(emailMode({ EMAIL_MODE: 'smtp' }), 'log');
  });

  test('toRecipients accepts arrays and comma-separated strings', () => {
    assert.deepEqual(toRecipients('a@example.com, b@example.com ,, '), ['a@example.com', 'b@example.com']);
    assert.deepEqual(toRecipients(['a@example.com', ' b@example.com ']), ['a@example.com', 'b@example.com']);
    assert.deepEqual(toRecipients(''), []);
    assert.deepEqual(toRecipients(undefined), []);
  });
});

describe('log mode', () => {
  test('prints a delimited block and records the email on sentLog', async () => {
    const log = mock.method(console, 'log', () => {});
    try {
      const result = await sendEmail({ to: 'a@example.com, b@example.com', subject: 'Hi', text: 'Line 1\nLine 2' }, { EMAIL_MODE: 'log' });
      assert.deepEqual(result, { ok: true, id: 'log-1' });
      assert.equal(log.mock.callCount(), 1);
      assert.equal(log.mock.calls[0].arguments[0], '----- EMAIL -----\nTo: a@example.com, b@example.com\nSubject: Hi\n\nLine 1\nLine 2\n----- END -----');
      assert.equal(sentLog.length, 1);
      assert.deepEqual(sentLog[0].to, ['a@example.com', 'b@example.com']);
      assert.equal(sentLog[0].subject, 'Hi');
      assert.equal(sentLog[0].text, 'Line 1\nLine 2');
      assert.match(sentLog[0].at, /^\d{4}-\d{2}-\d{2}T/);
      _resetSentLog();
      assert.equal(sentLog.length, 0);
    } finally {
      log.mock.restore();
    }
  });
});

describe('resend mode', () => {
  const env = { EMAIL_MODE: 'resend', EMAIL_API_KEY: 're_test_123', FROM_EMAIL: 'Courtside <katie@example.com>' };

  test('posts to Resend with the bearer key and returns the id', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ id: 'email_1' }), { status: 200 }));
    try {
      const result = await sendEmail({ to: ['a@example.com'], subject: 'S', text: 'T' }, env);
      assert.deepEqual(result, { ok: true, id: 'email_1' });
      assert.equal(fetchMock.mock.callCount(), 1);
      const [url, init] = fetchMock.mock.calls[0].arguments;
      assert.equal(url, RESEND_URL);
      assert.equal(url, 'https://api.resend.com/emails');
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.Authorization, 'Bearer re_test_123');
      assert.deepEqual(JSON.parse(init.body), { from: 'Courtside <katie@example.com>', to: ['a@example.com'], subject: 'S', text: 'T' });
      assert.equal(sentLog.length, 0);
    } finally {
      fetchMock.mock.restore();
    }
  });

  test('returns ok:false (never throws) on API errors, network errors and missing config', async () => {
    const failing = mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ message: 'invalid from' }), { status: 422 }));
    try {
      assert.deepEqual(await sendEmail({ to: 'a@example.com', subject: 'S', text: 'T' }, env), { ok: false, error: 'invalid from' });
    } finally {
      failing.mock.restore();
    }
    const throwing = mock.method(globalThis, 'fetch', async () => { throw new Error('offline'); });
    try {
      assert.deepEqual(await sendEmail({ to: 'a@example.com', subject: 'S', text: 'T' }, env), { ok: false, error: 'offline' });
    } finally {
      throwing.mock.restore();
    }
    const untouched = mock.method(globalThis, 'fetch', async () => new Response('{}'));
    try {
      const noKey = await sendEmail({ to: 'a@example.com', subject: 'S', text: 'T' }, { EMAIL_MODE: 'resend' });
      assert.equal(noKey.ok, false);
      assert.match(noKey.error, /EMAIL_API_KEY/);
      const noTo = await sendEmail({ to: '', subject: 'S', text: 'T' }, env);
      assert.deepEqual(noTo, { ok: false, error: 'no recipients' });
      assert.equal(untouched.mock.callCount(), 0);
    } finally {
      untouched.mock.restore();
    }
  });
});

describe('templates', () => {
  test('notifyKatie lists the request, the guest, the invite, the brief and the Sheet link', () => {
    const { subject, text } = notifyKatie(row, { sheetUrl: 'https://docs.google.com/spreadsheets/d/abc' });
    assert.equal(subject, 'New request CS-ABCDEFGH · private · Feb 7–13');
    for (const line of [
      'Request ID: CS-ABCDEFGH', 'Type: private', 'Weeks: Feb 7–13', 'Guest: Ana Guest', 'Email: ana.guest@example.com',
      'Mobile: +1 555 0100', 'Invite code: GUEST1 (invited by Katie)', row.brief, 'Sheet: https://docs.google.com/spreadsheets/d/abc',
    ]) assert.ok(text.includes(line), line);
    assert.ok(text.indexOf('Invite code') < text.indexOf(row.brief), 'brief comes after the header lines');
    assert.ok(text.indexOf(row.brief) < text.indexOf('Sheet:'), 'sheet link comes last');
  });

  test('notifyKatie says when there is no guest email or Sheet URL', () => {
    const { text } = notifyKatie({ ...row, guestEmail: '', guestMobile: '', guestName: 'Shared test code' });
    assert.ok(text.includes('Email: no guest email on this invite'));
    assert.ok(text.includes('Mobile: —'));
    assert.ok(text.includes('Sheet: (SHEET_URL is not set)'));
  });

  test('notifyInquiry names the Concept 02 path, the guest, the invite (or its absence), the brief and the Sheet link', () => {
    const inquiry = {
      requestId: 'CS-ABCDEFGH', requestType: 'private', weeks: 'Feb 7–13', guestName: 'Ana Guest', guestEmail: 'ana.guest@example.com',
      guestMobile: '', inviteCode: '', invitedBy: '', brief: 'CONCEPT 02 REQUEST · Private group\nTrip: The Spanish Offseason (Spain with Katie + Eva)',
    };
    const { subject, text } = notifyInquiry(inquiry, { sheetUrl: 'https://docs.google.com/spreadsheets/d/abc' });
    assert.equal(subject, 'New request CS-ABCDEFGH · Private group · Feb 7–13');
    for (const line of [
      'New Concept 02 request for The Spanish Offseason', 'Request ID: CS-ABCDEFGH', 'Type: Private group', 'Weeks: Feb 7–13', 'Name: Ana Guest',
      'Email: ana.guest@example.com', 'Invite code: none (public trip page)', inquiry.brief, 'Sheet: https://docs.google.com/spreadsheets/d/abc',
    ]) assert.ok(text.includes(line), line);
    assert.ok(text.indexOf('Invite code') < text.indexOf(inquiry.brief), 'brief comes after the header lines');
    assert.ok(text.indexOf(inquiry.brief) < text.indexOf('Sheet:'), 'sheet link comes last');

    const match = notifyInquiry({ ...inquiry, requestType: 'vetted', weeks: 'Flexible', inviteCode: 'GUEST1', invitedBy: 'Katie' });
    assert.equal(match.subject, 'New request CS-ABCDEFGH · Group match · Flexible');
    assert.ok(match.text.includes('Type: Group match'));
    assert.ok(match.text.includes('Invite code: GUEST1 (invited by Katie)'));
    assert.ok(match.text.includes('Sheet: (SHEET_URL is not set)'));
    assert.ok(notifyInquiry({ ...inquiry, inviteCode: 'COURTSIDE', invitedBy: '' }).text.includes('Invite code: COURTSIDE (invited by —)'));
  });

  test("confirmGuest starts with \"You're on our list.\" and carries the request ID and brief", () => {
    const { subject, text } = confirmGuest(row);
    assert.equal(subject, "You're on our list — The Spanish Offseason (CS-ABCDEFGH)");
    assert.ok(text.startsWith("You're on our list."));
    assert.ok(text.includes('Hi Ana Guest, your request CS-ABCDEFGH'));
    assert.ok(text.includes('Katie reviews each request personally'));
    assert.ok(text.includes(row.brief));
    assert.ok(confirmGuest({ ...row, guestName: '' }).text.includes('Your request CS-ABCDEFGH'));
  });
});

describe('EMAIL_MODE=gmail', () => {
  const env = { EMAIL_MODE: 'gmail', FROM_EMAIL: 'team@courtsidetravel.co', GOOGLE_SERVICE_ACCOUNT_EMAIL: 'sa@x.iam.gserviceaccount.com', GOOGLE_PRIVATE_KEY: 'k' };

  test('posts a base64url RFC 2822 message to the Gmail API as FROM_EMAIL, with encoded non-ASCII headers', async () => {
    const calls = [];
    const fetch = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ id: 'g-1' }), { status: 200 }); };
    const res = await sendEmail({ to: 'a@example.com, b@example.com', subject: 'Waitlist · Spain – TEST', text: 'Hello ’there’', replyTo: 'guest@example.com' }, env, { fetch, getToken: async () => 'tok' });
    assert.deepEqual(res, { ok: true, id: 'g-1' });
    assert.equal(calls[0].url, GMAIL_SEND_URL);
    assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
    const raw = JSON.parse(calls[0].init.body).raw;
    assert.doesNotMatch(raw, /[+/=]/, 'base64url, unpadded');
    const mime = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    assert.match(mime, /^From: Courtside Travel Co\. <team@courtsidetravel\.co>\r\n/);
    assert.match(mime, /\r\nTo: a@example\.com, b@example\.com\r\n/);
    assert.match(mime, /\r\nReply-To: guest@example\.com\r\n/);
    assert.match(mime, /\r\nSubject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=\r\n/);
    const body = mime.split('\r\n\r\n')[1].replace(/\r\n/g, '');
    assert.equal(Buffer.from(body, 'base64').toString('utf8'), 'Hello ’there’');
  });

  test('missing config, no recipients and a Gmail error are reported, never thrown', async () => {
    assert.match((await sendEmail({ to: 'a@example.com', subject: 's', text: 't' }, { EMAIL_MODE: 'gmail' })).error, /FROM_EMAIL/);
    assert.equal((await sendEmail({ to: '', subject: 's', text: 't' }, env, { getToken: async () => 't' })).error, 'no recipients');
    const fetch = async () => new Response(JSON.stringify({ error: { message: 'Precondition check failed.' } }), { status: 400 });
    assert.deepEqual(await sendEmail({ to: 'a@example.com', subject: 's', text: 't' }, env, { fetch, getToken: async () => 't' }), { ok: false, error: 'Precondition check failed.' });
    const broken = await sendEmail({ to: 'a@example.com', subject: 's', text: 't' }, env, { getToken: async () => { throw new Error('unauthorized_client'); } });
    assert.deepEqual(broken, { ok: false, error: 'unauthorized_client' });
  });

  test('emailMode recognises gmail; the waitlist and application templates carry a reply-to', () => {
    assert.equal(emailMode({ EMAIL_MODE: 'Gmail' }), 'gmail');
    const w = notifyWaitlist({ email: 'g@example.com', name: '', trip: 'Geneva', source: 'concept02-waitlist' });
    assert.equal(w.subject, 'Waitlist · Geneva · g@example.com');
    assert.equal(w.replyTo, 'g@example.com');
    const a = notifyApplication({ name: 'Pat Pro', email: 'p@example.com', club: 'Club X', referral: '', destination: 'Mallorca', background: 'b', community: 'c' });
    assert.equal(a.subject, 'Host application · Pat Pro · Club X');
    assert.match(a.text, /Would love to take them to: Mallorca/);
  });
});
