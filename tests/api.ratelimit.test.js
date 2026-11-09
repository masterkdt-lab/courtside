// tests/api.ratelimit.test.js
// lib/ratelimit.js, lib/ids.js and lib/env.js.

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LIMITS, _reset, check } from '../lib/ratelimit.js';
import { CROCKFORD, clientIp, ipHash, requestId } from '../lib/ids.js';
import { _resetSecretWarning, getSecret, loadEnv, parseEnv } from '../lib/env.js';
import { DEV_COOKIE_SECRET } from '../lib/guard.js';
import { tempDir } from './api.helpers.js';

describe('ratelimit', () => {
  beforeEach(() => _reset());

  test('buckets carry the plan limits', () => {
    assert.deepEqual(LIMITS, {
      code: { limit: 10, windowMs: 600_000 },
      request: { limit: 5, windowMs: 600_000 },
      waitlist: { limit: 5, windowMs: 600_000 },
      application: { limit: 3, windowMs: 600_000 },
      event: { limit: 60, windowMs: 600_000 },
      group: { limit: 30, windowMs: 600_000 },
    });
  });

  test('allows up to the limit, then refuses, per bucket and per ip', () => {
    for (let i = 1; i <= 10; i += 1) {
      const r = check('code', 'ip-a');
      assert.equal(r.allowed, true, `attempt ${i}`);
      assert.equal(r.remaining, 10 - i);
    }
    assert.deepEqual(check('code', 'ip-a').allowed, false);
    assert.equal(check('code', 'ip-a').remaining, 0);
    assert.equal(check('code', 'ip-b').allowed, true);
    assert.equal(check('request', 'ip-a').allowed, true);
    for (let i = 0; i < 4; i += 1) check('request', 'ip-a');
    assert.equal(check('request', 'ip-a').allowed, false);
    for (let i = 0; i < 5; i += 1) assert.equal(check('waitlist', 'ip-a').allowed, true, `waitlist ${i + 1}`);
    assert.equal(check('waitlist', 'ip-a').allowed, false);
    for (let i = 0; i < 60; i += 1) assert.equal(check('event', 'ip-a').allowed, true, `event ${i + 1}`);
    assert.equal(check('event', 'ip-a').allowed, false);
    assert.equal(check('event', 'ip-b').allowed, true);
  });

  test('the window resets', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 2; i += 1) check('x', 'ip', { limit: 2, windowMs: 1000 }, t0);
    assert.equal(check('x', 'ip', { limit: 2, windowMs: 1000 }, t0 + 999).allowed, false);
    assert.equal(check('x', 'ip', { limit: 2, windowMs: 1000 }, t0 + 1000).allowed, true);
  });

  test('_reset clears state and unknown buckets throw', () => {
    for (let i = 0; i < 11; i += 1) check('code', 'ip');
    assert.equal(check('code', 'ip').allowed, false);
    _reset();
    assert.equal(check('code', 'ip').allowed, true);
    assert.throws(() => check('nope', 'ip'), /no limits for bucket "nope"/);
  });
});

describe('ids', () => {
  test('requestId is CS- plus 8 Crockford base32 characters, and unique', () => {
    const ids = new Set();
    for (let i = 0; i < 2000; i += 1) {
      const id = requestId();
      assert.match(id, /^CS-[0-9A-HJKMNP-TV-Z]{8}$/);
      ids.add(id);
    }
    assert.equal(ids.size, 2000);
    assert.equal(CROCKFORD.length, 32);
    assert.equal(/[ILOU]/.test(CROCKFORD), false);
  });

  test('ipHash is the first 16 hex chars of SHA-256(ip + secret)', async () => {
    const a = await ipHash('203.0.113.9', 's1');
    assert.match(a, /^[0-9a-f]{16}$/);
    assert.equal(a, await ipHash('203.0.113.9', 's1'));
    assert.notEqual(a, await ipHash('203.0.113.9', 's2'));
    assert.notEqual(a, await ipHash('203.0.113.8', 's1'));
    // SHA-256("local" + "x") = known prefix, computed independently with node:crypto
    const { createHash } = await import('node:crypto');
    assert.equal(await ipHash('local', 'x'), createHash('sha256').update('localx').digest('hex').slice(0, 16));
  });

  test('clientIp prefers x-forwarded-for, then x-real-ip, then "local"', () => {
    const req = (headers) => new Request('http://localhost/', { headers });
    assert.equal(clientIp(req({ 'x-forwarded-for': '198.51.100.7, 10.0.0.1', 'x-real-ip': '10.0.0.2' })), '198.51.100.7');
    assert.equal(clientIp(req({ 'x-real-ip': ' 10.0.0.2 ' })), '10.0.0.2');
    assert.equal(clientIp(req({ 'x-forwarded-for': ' , 10.0.0.1', 'x-real-ip': '10.0.0.2' })), '10.0.0.2');
    assert.equal(clientIp(req({})), 'local');
  });
});

describe('env', () => {
  test('parseEnv handles comments, quotes, export and keeps literal \\n', () => {
    const parsed = parseEnv([
      '# comment',
      '',
      'DATA_BACKEND=mock',
      'export COOKIE_SECRET="abc def"',
      "FROM_EMAIL='Courtside <k@example.com>'",
      'NOTIFY_EMAILS=a@example.com,b@example.com # people',
      'GOOGLE_PRIVATE_KEY="-----BEGIN\\nMIDDLE\\nEND-----"',
      'EMPTY=',
      'not a pair',
      '  SPACED = padded  ',
    ].join('\n'));
    assert.deepEqual(parsed, {
      DATA_BACKEND: 'mock',
      COOKIE_SECRET: 'abc def',
      FROM_EMAIL: 'Courtside <k@example.com>',
      NOTIFY_EMAILS: 'a@example.com,b@example.com',
      GOOGLE_PRIVATE_KEY: '-----BEGIN\\nMIDDLE\\nEND-----',
      EMPTY: '',
      SPACED: 'padded',
    });
  });

  test('loadEnv reads a file into env without overriding set values, and is a no-op without a file', () => {
    const dir = tempDir('courtside-env-');
    const file = path.join(dir, '.env');
    fs.writeFileSync(file, 'A=from-file\nB=from-file\n');
    const env = { A: 'already' };
    assert.deepEqual(loadEnv({ file, env }), { B: 'from-file' });
    assert.deepEqual(env, { A: 'already', B: 'from-file' });
    assert.deepEqual(loadEnv({ file: path.join(dir, 'missing.env'), env }), {});
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('getSecret returns COOKIE_SECRET, or the dev default with a single warning', () => {
    _resetSecretWarning();
    const warn = mock.method(console, 'warn', () => {});
    try {
      assert.equal(getSecret({ COOKIE_SECRET: 'real' }), 'real');
      assert.equal(warn.mock.callCount(), 0);
      assert.equal(getSecret({}), DEV_COOKIE_SECRET);
      assert.equal(getSecret({ COOKIE_SECRET: '' }), DEV_COOKIE_SECRET);
      assert.equal(warn.mock.callCount(), 1);
      assert.match(warn.mock.calls[0].arguments[0], /COOKIE_SECRET/);
    } finally {
      warn.mock.restore();
    }
  });
});
