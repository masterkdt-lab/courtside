// tests/api.cookie.test.js
// lib/cookie.js (sign / verify / Set-Cookie / Cookie parsing) and lib/guard.js.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  COOKIE_MAX_AGE, COOKIE_NAME, buildSetCookie, constantTimeEqual, readCookie, sign, verify,
} from '../lib/cookie.js';
import { DEV_COOKIE_SECRET, isAllowed, secretFromEnv, sessionFromRequest } from '../lib/guard.js';

const SECRET = 'test-secret';
const payload = () => ({ code: 'GUEST1', invitedBy: 'Katie', issuedTo: 'Ana Guest', exp: Date.now() + 60_000 });
const withCookie = (token, name = COOKIE_NAME) => new Request('http://localhost/site', { headers: { cookie: `${name}=${token}` } });

describe('sign / verify', () => {
  test('round-trips a payload', async () => {
    const data = payload();
    const token = await sign(data, SECRET);
    assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.deepEqual(await verify(token, SECRET), data);
  });

  test('is deterministic for the same payload and secret', async () => {
    const data = payload();
    assert.equal(await sign(data, SECRET), await sign(data, SECRET));
  });

  test('rejects a tampered body', async () => {
    const token = await sign(payload(), SECRET);
    const [body, mac] = token.split('.');
    const tampered = `${body.slice(0, -1)}${body.endsWith('A') ? 'B' : 'A'}.${mac}`;
    assert.equal(await verify(tampered, SECRET), null);
    const forged = await sign({ ...payload(), code: 'ADMIN' }, 'other-secret');
    assert.equal(await verify(`${forged.split('.')[0]}.${mac}`, SECRET), null);
  });

  test('rejects a tampered signature and the wrong secret', async () => {
    const token = await sign(payload(), SECRET);
    const [body, mac] = token.split('.');
    const flipped = `${body}.${mac.slice(0, -1)}${mac.endsWith('A') ? 'B' : 'A'}`;
    assert.equal(await verify(flipped, SECRET), null);
    assert.equal(await verify(`${body}.${mac.slice(0, -2)}`, SECRET), null);
    assert.equal(await verify(token, 'wrong-secret'), null);
  });

  test('rejects an expired payload and a payload without a numeric exp', async () => {
    assert.equal(await verify(await sign({ ...payload(), exp: Date.now() - 1 }, SECRET), SECRET), null);
    assert.equal(await verify(await sign({ code: 'GUEST1' }, SECRET), SECRET), null);
    assert.equal(await verify(await sign({ code: 'GUEST1', exp: 'soon' }, SECRET), SECRET), null);
    const fixed = await sign({ ...payload(), exp: 1_000 }, SECRET);
    assert.deepEqual((await verify(fixed, SECRET, 999)).exp, 1_000);
    assert.equal(await verify(fixed, SECRET, 1_000), null);
  });

  test('rejects malformed tokens without throwing', async () => {
    for (const bad of ['', 'abc', '.abc', 'abc.', 'a.b.c', 'a b.cd', '!!.??', null, undefined, 42, {}]) {
      assert.equal(await verify(bad, SECRET), null, String(bad));
    }
    // valid signature over a body that is not a JSON object
    const body = 'bm90LWpzb24'; // "not-json"
    const token = await sign('x', SECRET);
    assert.equal(await verify(token, SECRET), null);
    assert.equal(await verify(`${body}.${token.split('.')[1]}`, SECRET), null);
    assert.equal(await verify(await sign([1, 2], SECRET), SECRET), null);
  });

  test('constantTimeEqual compares strings of any length', () => {
    assert.equal(constantTimeEqual('abc', 'abc'), true);
    assert.equal(constantTimeEqual('abc', 'abd'), false);
    assert.equal(constantTimeEqual('abc', 'ab'), false);
    assert.equal(constantTimeEqual('', ''), true);
  });
});

describe('buildSetCookie / readCookie', () => {
  test('builds the cs_session attributes, Secure only when asked', () => {
    assert.equal(buildSetCookie('tok'), 'cs_session=tok; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000');
    assert.equal(buildSetCookie('tok', { secure: false }), 'cs_session=tok; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000');
    assert.equal(buildSetCookie('tok', { secure: true }), 'cs_session=tok; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure');
    assert.equal(COOKIE_MAX_AGE, 30 * 24 * 60 * 60);
  });

  test('reads one cookie out of many, quoted or encoded, and returns null when absent', () => {
    const req = (cookie) => new Request('http://localhost/', { headers: cookie === undefined ? {} : { cookie } });
    assert.equal(readCookie(req('a=1; cs_session=abc.def; b=2'), 'cs_session'), 'abc.def');
    assert.equal(readCookie(req('cs_session="abc.def"'), 'cs_session'), 'abc.def');
    assert.equal(readCookie(req('cs_session=a%2Eb'), 'cs_session'), 'a.b');
    assert.equal(readCookie(req('cs_session=%E0%A4%A'), 'cs_session'), '%E0%A4%A');
    assert.equal(readCookie(req('cs_sessionx=1; xcs_session=2'), 'cs_session'), null);
    assert.equal(readCookie(req('junk'), 'cs_session'), null);
    assert.equal(readCookie(req(''), 'cs_session'), null);
    assert.equal(readCookie(req(undefined), 'cs_session'), null);
    assert.equal(readCookie(req('cs_session=abc'), 'other'), null);
  });
});

describe('guard', () => {
  test('sessionFromRequest returns the payload for a valid cookie and null otherwise', async () => {
    const data = payload();
    const token = await sign(data, SECRET);
    assert.deepEqual(await sessionFromRequest(withCookie(token), SECRET), data);
    assert.equal(await sessionFromRequest(withCookie(token), 'other'), null);
    assert.equal(await sessionFromRequest(withCookie(token, 'other_cookie'), SECRET), null);
    assert.equal(await sessionFromRequest(new Request('http://localhost/site'), SECRET), null);
    assert.equal(await sessionFromRequest(withCookie(`${token}x`), SECRET), null);
    assert.equal(await sessionFromRequest(withCookie(await sign({ ...data, exp: Date.now() - 5 }, SECRET)), SECRET), null);
    assert.equal(await sessionFromRequest(withCookie(await sign({ ...data, code: '' }, SECRET)), SECRET), null);
    assert.equal(await sessionFromRequest(withCookie(await sign({ exp: Date.now() + 5000 }, SECRET)), SECRET), null);
  });

  test('isAllowed is the boolean form', async () => {
    const token = await sign(payload(), SECRET);
    assert.equal(await isAllowed(withCookie(token), SECRET), true);
    assert.equal(await isAllowed(withCookie(token), 'nope'), false);
    assert.equal(await isAllowed(new Request('http://localhost/site'), SECRET), false);
  });

  test('secretFromEnv falls back to the dev default', () => {
    assert.equal(secretFromEnv({ COOKIE_SECRET: ' abc ' }), 'abc');
    assert.equal(secretFromEnv({ COOKIE_SECRET: '' }), DEV_COOKIE_SECRET);
    assert.equal(secretFromEnv({}), DEV_COOKIE_SECRET);
    assert.equal(secretFromEnv(undefined).length > 0, true);
  });
});
