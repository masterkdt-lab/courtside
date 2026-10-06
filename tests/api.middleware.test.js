// tests/api.middleware.test.js
// middleware.js: matcher, redirect without a cookie, pass-through with one, and an import graph
// free of node: modules so it can run on Vercel's middleware runtime.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import middleware, { config } from '../middleware.js';
import { sign } from '../lib/cookie.js';
import { DEV_COOKIE_SECRET } from '../lib/guard.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const request = (url, cookie) => new Request(url, { headers: cookie ? { cookie } : {} });

test('config matches /site and /site.html only', () => {
  assert.deepEqual(config, { matcher: ['/site', '/site.html'] });
});

test('redirects to / (302) without a valid cookie', async () => {
  const res = await middleware(request('https://courtside.example/site'));
  assert.ok(res instanceof Response);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), 'https://courtside.example/');
  const tampered = await middleware(request('https://courtside.example/site.html', 'cs_session=abc.def'));
  assert.equal(tampered.status, 302);
  const expired = await sign({ code: 'GUEST1', invitedBy: 'Katie', issuedTo: 'Ana', exp: Date.now() - 1 }, DEV_COOKIE_SECRET);
  assert.equal((await middleware(request('https://courtside.example/site', `cs_session=${expired}`))).status, 302);
});

test('lets a valid cookie through with the x-middleware-next pass-through response', async () => {
  const token = await sign({ code: 'GUEST1', invitedBy: 'Katie', issuedTo: 'Ana', exp: Date.now() + 60_000 }, DEV_COOKIE_SECRET);
  const res = await middleware(request('https://courtside.example/site', `cs_session=${token}`));
  assert.ok(res instanceof Response);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-middleware-next'), '1');
  assert.equal(res.headers.get('location'), null);
  assert.equal(res.body, null);
});

test('honours COOKIE_SECRET from the environment', async () => {
  process.env.COOKIE_SECRET = 'prod-secret';
  try {
    const token = await sign({ code: 'GUEST1', invitedBy: 'Katie', issuedTo: 'Ana', exp: Date.now() + 60_000 }, 'prod-secret');
    assert.equal((await middleware(request('https://courtside.example/site', `cs_session=${token}`))).status, 200);
    const devSigned = await sign({ code: 'GUEST1', invitedBy: 'Katie', issuedTo: 'Ana', exp: Date.now() + 60_000 }, DEV_COOKIE_SECRET);
    assert.equal((await middleware(request('https://courtside.example/site', `cs_session=${devSigned}`))).status, 302);
  } finally {
    delete process.env.COOKIE_SECRET;
  }
});

test('middleware.js and everything it imports avoid node: modules and the store', () => {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /from\s+['"]node:/, `${path.relative(ROOT, file)} imports a node: module`);
    assert.doesNotMatch(source, /require\(/, `${path.relative(ROOT, file)} uses require`);
    for (const m of source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) visit(path.resolve(path.dirname(file), m[1]));
  };
  visit(path.join(ROOT, 'middleware.js'));
  assert.deepEqual([...seen].map((f) => path.relative(ROOT, f)).sort(), ['lib/cookie.js', 'lib/guard.js', 'middleware.js']);
});
