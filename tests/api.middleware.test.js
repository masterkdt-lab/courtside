// tests/api.middleware.test.js
// middleware.js: matcher, the legacy /?invite=CODE redirect on /, the /site guard (redirect to
// /invite without a cookie, pass-through with one), and an import graph free of node: modules so
// it can run on Vercel's middleware runtime.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import middleware, { GATE_PATH, config, legacyInviteRedirect } from '../middleware.js';
import { sign } from '../lib/cookie.js';
import { DEV_COOKIE_SECRET } from '../lib/guard.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ORIGIN = 'https://courtside.example';
const request = (url, cookie) => new Request(url, { headers: cookie ? { cookie } : {} });
const validCookie = async (secret = DEV_COOKIE_SECRET) => `cs_session=${await sign({ code: 'GUEST1', invitedBy: 'Katie', issuedTo: 'Ana', exp: Date.now() + 60_000 }, secret)}`;

function expectPassThrough(res) {
  assert.ok(res instanceof Response);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-middleware-next'), '1');
  assert.equal(res.headers.get('location'), null);
  assert.equal(res.body, null);
}

// -> the Location header as a same-origin path + query ("/invite?invite=X").
function expectRedirect(res, pathAndQuery) {
  assert.ok(res instanceof Response);
  assert.equal(res.status, 302);
  const location = new URL(res.headers.get('location'));
  assert.equal(location.origin, ORIGIN, 'redirects stay on the request origin');
  assert.equal(location.pathname + location.search, pathAndQuery);
}

test('config matches /, /site and /site.html only, each as an exact path', () => {
  assert.deepEqual(config, { matcher: ['/', '/site', '/site.html'] });
  assert.equal(GATE_PATH, '/invite');
});

test('/ without an invite query passes through to the homepage', async () => {
  expectPassThrough(await middleware(request(`${ORIGIN}/`)));
  expectPassThrough(await middleware(request(`${ORIGIN}/?utm_source=x`)));
  expectPassThrough(await middleware(request(`${ORIGIN}/?guest=Ana`)));
  // A cookie makes no difference on the homepage.
  expectPassThrough(await middleware(request(`${ORIGIN}/`, await validCookie())));
});

test('/?invite=X and /?code=X redirect (302) to /invite with the query string kept verbatim', async () => {
  expectRedirect(await middleware(request(`${ORIGIN}/?invite=GUEST1`)), '/invite?invite=GUEST1');
  expectRedirect(await middleware(request(`${ORIGIN}/?code=GUEST1`)), '/invite?code=GUEST1');
  expectRedirect(await middleware(request(`${ORIGIN}/?invite=GUEST1&guest=x`)), '/invite?invite=GUEST1&guest=x');
  expectRedirect(await middleware(request(`${ORIGIN}/?guest=x&code=guest1`)), '/invite?guest=x&code=guest1');
  expectRedirect(await middleware(request(`${ORIGIN}/?invite=`)), '/invite?invite=');
  // Also with a valid cookie: the link still lands on the gate, which re-enters with the code.
  expectRedirect(await middleware(request(`${ORIGIN}/?invite=GUEST1`, await validCookie())), '/invite?invite=GUEST1');
});

test('legacyInviteRedirect (shared with the dev server) returns the target or null', () => {
  assert.equal(legacyInviteRedirect(new URL('http://localhost:3000/')), null);
  assert.equal(legacyInviteRedirect(new URL('http://localhost:3000/?x=1')), null);
  assert.equal(legacyInviteRedirect(new URL('http://localhost:3000/?invite=GUEST1&guest=x')), '/invite?invite=GUEST1&guest=x');
  assert.equal(legacyInviteRedirect(new URL('http://localhost:3000/?code=guest1')), '/invite?code=guest1');
});

test('/site and /site.html redirect to /invite (302) without a valid cookie', async () => {
  expectRedirect(await middleware(request(`${ORIGIN}/site`)), '/invite');
  expectRedirect(await middleware(request(`${ORIGIN}/site.html`)), '/invite');
  expectRedirect(await middleware(request(`${ORIGIN}/site.html`, 'cs_session=abc.def')), '/invite');
  const expired = await sign({ code: 'GUEST1', invitedBy: 'Katie', issuedTo: 'Ana', exp: Date.now() - 1 }, DEV_COOKIE_SECRET);
  expectRedirect(await middleware(request(`${ORIGIN}/site`, `cs_session=${expired}`)), '/invite');
});

test('lets a valid cookie through with the x-middleware-next pass-through response', async () => {
  const cookie = await validCookie();
  expectPassThrough(await middleware(request(`${ORIGIN}/site`, cookie)));
  expectPassThrough(await middleware(request(`${ORIGIN}/site.html`, cookie)));
});

test('honours COOKIE_SECRET from the environment', async () => {
  process.env.COOKIE_SECRET = 'prod-secret';
  try {
    assert.equal((await middleware(request(`${ORIGIN}/site`, await validCookie('prod-secret')))).status, 200);
    assert.equal((await middleware(request(`${ORIGIN}/site`, await validCookie(DEV_COOKIE_SECRET)))).status, 302);
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
