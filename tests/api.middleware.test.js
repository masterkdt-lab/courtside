// tests/api.middleware.test.js
// middleware.js (CONCEPT02_PLAN.md, Routing; real page paths 2026-11-09): the matcher, the legacy
// personal-link redirect from / and /invite into /#/invite?code=…, the bare /invite pass-through to the
// real /invite page, the /site and /site.html redirect to /trips/spanish-offseason, the pass-through
// for everything else, and an import graph free of node: modules so it can run on Vercel's middleware
// runtime.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import middleware, { CODE_PARAMS, INVITE_ROUTE, TRIP_ROUTE, config, redirectTarget } from '../middleware.js';
import { sign } from '../lib/cookie.js';
import { DEV_COOKIE_SECRET } from '../lib/guard.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ORIGIN = 'https://courtside.example';
const request = (url, cookie) => new Request(url, { headers: cookie ? { cookie } : {} });
const validCookie = async () => `cs_session=${await sign({ code: 'GUEST1', invitedBy: 'Katie', issuedTo: 'Ana', exp: Date.now() + 60_000 }, DEV_COOKIE_SECRET)}`;

function expectPassThrough(res) {
  assert.ok(res instanceof Response);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-middleware-next'), '1');
  assert.equal(res.headers.get('location'), null);
  assert.equal(res.body, null);
}

// -> the Location header as a same-origin path + query + hash ("/#/invite?code=X").
function expectRedirect(res, target) {
  assert.ok(res instanceof Response);
  assert.equal(res.status, 302);
  const location = new URL(res.headers.get('location'));
  assert.equal(location.origin, ORIGIN, 'redirects stay on the request origin');
  assert.equal(location.pathname + location.search + location.hash, target);
}

test('config matches /, /invite, /site and /site.html only, each as an exact path', () => {
  assert.deepEqual(config, { matcher: ['/', '/invite', '/site', '/site.html'] });
  assert.equal(INVITE_ROUTE, '/#/invite');
  assert.equal(TRIP_ROUTE, '/trips/spanish-offseason');
  assert.deepEqual([...CODE_PARAMS], ['invite', 'code']);
});

test('/ without an invite query passes through to the SPA, cookie or not', async () => {
  expectPassThrough(await middleware(request(`${ORIGIN}/`)));
  expectPassThrough(await middleware(request(`${ORIGIN}/?utm_source=x`)));
  expectPassThrough(await middleware(request(`${ORIGIN}/?guest=Ana`)));
  expectPassThrough(await middleware(request(`${ORIGIN}/`, await validCookie())));
  expectPassThrough(await middleware(request(`${ORIGIN}/#/trip`)), 'a hash never reaches the server anyway');
});

test('/?invite=X, /?code=X, /invite?invite=X and /invite?code=X redirect (302) to /#/invite?code=X', async () => {
  expectRedirect(await middleware(request(`${ORIGIN}/?invite=GUEST1`)), '/#/invite?code=GUEST1');
  expectRedirect(await middleware(request(`${ORIGIN}/?code=GUEST1`)), '/#/invite?code=GUEST1');
  expectRedirect(await middleware(request(`${ORIGIN}/invite?invite=GUEST1`)), '/#/invite?code=GUEST1');
  expectRedirect(await middleware(request(`${ORIGIN}/invite?code=guest1`)), '/#/invite?code=guest1');
  // Only the code travels; other parameters are dropped, and the value is URL-encoded.
  expectRedirect(await middleware(request(`${ORIGIN}/?invite=GUEST1&guest=Mallory`)), '/#/invite?code=GUEST1');
  expectRedirect(await middleware(request(`${ORIGIN}/?guest=x&code=GUEST1`)), '/#/invite?code=GUEST1');
  expectRedirect(await middleware(request(`${ORIGIN}/?invite=a%26b%3Dc`)), '/#/invite?code=a%26b%3Dc');
  expectRedirect(await middleware(request(`${ORIGIN}/?invite=`)), '/#/invite?code=');
  // `invite` wins when both are present.
  expectRedirect(await middleware(request(`${ORIGIN}/?code=B&invite=A`)), '/#/invite?code=A');
  // Also with a valid cookie: the link still lands on the gate, which re-enters with the code.
  expectRedirect(await middleware(request(`${ORIGIN}/?invite=GUEST1`, await validCookie())), '/#/invite?code=GUEST1');
});

test('a bare /invite passes through to the real /invite page (no redirect)', async () => {
  expectPassThrough(await middleware(request(`${ORIGIN}/invite`)));
  expectPassThrough(await middleware(request(`${ORIGIN}/invite?utm_source=x`)));
  expectPassThrough(await middleware(request(`${ORIGIN}/invite`, await validCookie())));
});

test('/site and /site.html redirect (302) to /trips/spanish-offseason, with or without a cookie; the cookie gates nothing now', async () => {
  expectRedirect(await middleware(request(`${ORIGIN}/site`)), '/trips/spanish-offseason');
  expectRedirect(await middleware(request(`${ORIGIN}/site.html`)), '/trips/spanish-offseason');
  expectRedirect(await middleware(request(`${ORIGIN}/site?x=1`)), '/trips/spanish-offseason');
  expectRedirect(await middleware(request(`${ORIGIN}/site`, 'cs_session=abc.def')), '/trips/spanish-offseason');
  expectRedirect(await middleware(request(`${ORIGIN}/site`, await validCookie())), '/trips/spanish-offseason');
});

test('redirectTarget (shared with the dev server) returns the target or null', () => {
  const url = (s) => new URL(s, 'http://localhost:3000');
  assert.equal(redirectTarget(url('/')), null);
  assert.equal(redirectTarget(url('/?x=1')), null);
  assert.equal(redirectTarget(url('/?invite=GUEST1&guest=x')), '/#/invite?code=GUEST1');
  assert.equal(redirectTarget(url('/?code=guest1')), '/#/invite?code=guest1');
  assert.equal(redirectTarget(url('/invite')), null, 'the real /invite page');
  assert.equal(redirectTarget(url('/invite?utm_source=x')), null);
  assert.equal(redirectTarget(url('/invite?invite=GUEST1')), '/#/invite?code=GUEST1');
  assert.equal(redirectTarget(url('/invite?code=GUEST1')), '/#/invite?code=GUEST1');
  assert.equal(redirectTarget(url('/site')), '/trips/spanish-offseason');
  assert.equal(redirectTarget(url('/site.html')), '/trips/spanish-offseason');
  assert.equal(redirectTarget(url('/trips/spanish-offseason')), null);
  assert.equal(redirectTarget(url('/trips')), null);
  // Paths outside the matcher are the dev server's business; the function says "continue".
  assert.equal(redirectTarget(url('/privacy?invite=GUEST1')), null);
  assert.equal(redirectTarget(url('/pros')), null);
  assert.equal(redirectTarget(url('/api/code')), null);
});

test('middleware.js imports nothing and uses no node: modules', () => {
  const source = fs.readFileSync(path.join(ROOT, 'middleware.js'), 'utf8');
  assert.doesNotMatch(source, /from\s+['"]node:/);
  assert.doesNotMatch(source, /require\(/);
  assert.deepEqual([...source.matchAll(/^import\s.*$/gm)].map((m) => m[0]), [], 'no imports at all: nothing to break on the edge runtime');
});

test('www.courtsidetravel.co → 308 to the bare domain, path and query kept; other hosts unaffected', async () => {
  const { default: mw } = await import('../middleware.js');
  const res = await mw(new Request('https://www.courtsidetravel.co/?invite=KC1'));
  assert.equal(res.status, 308);
  assert.equal(res.headers.get('location'), 'https://courtsidetravel.co/?invite=KC1');
  const apex = await mw(new Request('https://courtsidetravel.co/'));
  assert.equal(apex.headers.get('x-middleware-next'), '1');
});
