// middleware.js — Vercel Routing Middleware (Phase 1 plan 4.0; Phase 2 plan section 6).
// Three paths, nothing else (config.matcher below):
//   /                    the public homepage. A personal link from before Phase 2 (/?invite=CODE,
//                        alias /?code=CODE) is sent on to the gate at /invite with the query string
//                        kept as is; every other request to / continues to the page.
//   /site, /site.html    require a valid cs_session cookie; anyone else is sent to the gate at /invite.
// The cookie decision itself lives in lib/guard.js and is shared with scripts/dev-server.js, which
// also imports legacyInviteRedirect() from here so both servers redirect the same way. Nothing in
// this file's import graph (lib/guard.js, lib/cookie.js) uses node: modules, so it runs on either
// middleware runtime. (Vercel's current docs default Routing Middleware to the Node.js runtime. No
// `runtime` is set here, so the platform default applies.)
//
// Matcher entries are path-to-regexp patterns (Vercel docs, "Path matching"): '/' matches the root
// only; a prefix would need '/:path*'. So '/' here never catches /site, /invite or /pros.

import { isAllowed, secretFromEnv } from './lib/guard.js';

export const config = { matcher: ['/', '/site', '/site.html'] };

// Where the invite gate lives (public/invite.html). The dev server and site.js use the same path.
export const GATE_PATH = '/invite';

// The legacy personal-link redirect, shared with scripts/dev-server.js. `url` is the request URL
// (a URL instance). -> '/invite?<the original query string, verbatim>' when the query has an
// `invite` or `code` parameter (the two names public/js/gate.js reads), otherwise null.
export function legacyInviteRedirect(url) {
  const params = url.searchParams;
  if (!params.has('invite') && !params.has('code')) return null;
  return `${GATE_PATH}${url.search}`;
}

// The same response next() from @vercel/functions builds (packages/functions/src/middleware.ts):
// a null-body response whose x-middleware-next header tells Vercel to continue to the page.
// Inlined so google-auth-library stays the project's only dependency.
export function next() {
  return new Response(null, { headers: { 'x-middleware-next': '1' } });
}

export default async function middleware(request) {
  const url = new URL(request.url);
  if (url.pathname === '/') {
    const target = legacyInviteRedirect(url);
    return target ? Response.redirect(new URL(target, request.url), 302) : next();
  }
  if (await isAllowed(request, secretFromEnv(globalThis.process?.env))) return next();
  return Response.redirect(new URL(GATE_PATH, request.url), 302);
}
