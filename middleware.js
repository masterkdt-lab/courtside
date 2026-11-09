// middleware.js — Vercel Routing Middleware (CONCEPT02_PLAN.md, Routing).
// The Concept 02 SPA at public/index.html is hash-routed, so the old page URLs become redirects into
// it. Four paths, nothing else (config.matcher below):
//   /, /invite           a personal link from before Concept 02 (/?invite=CODE, /?code=CODE,
//                        /invite?invite=CODE, /invite?code=CODE) → 302 /#/invite?code=CODE, where
//                        the SPA prefills the gate and submits it. A bare /invite → 302 /#/invite
//                        (the old gate page is gone). A plain / continues to the SPA.
//   /site, /site.html    the old guarded trip page → 302 /#/trip. The SPA's trip page is public;
//                        the cookie no longer gates anything, so no cookie check runs here.
// scripts/dev-server.js imports redirectTarget() so both servers redirect the same way. Nothing in
// this file imports anything, so it runs on either middleware runtime. (Vercel's current docs
// default Routing Middleware to the Node.js runtime. No `runtime` is set here, so the platform
// default applies.)
//
// Matcher entries are path-to-regexp patterns (Vercel docs, "Path matching"): '/' matches the root
// only; a prefix would need '/:path*'. So nothing here catches /privacy, /api/* or the static files.

export const config = { matcher: ['/', '/invite', '/site', '/site.html'] };

// Where the SPA's gate and trip pages live.
export const INVITE_ROUTE = '/#/invite';
export const TRIP_ROUTE = '/#/trip';
// The query parameters a legacy personal link carried (the two names the old gate read).
export const CODE_PARAMS = Object.freeze(['invite', 'code']);

// -> the redirect target (a same-origin path, hash included) for a request URL (a URL instance),
// or null when the request should continue to the page. Shared with scripts/dev-server.js.
export function redirectTarget(url) {
  const { pathname, searchParams } = url;
  if (pathname === '/site' || pathname === '/site.html') return TRIP_ROUTE;
  if (pathname !== '/' && pathname !== '/invite') return null;
  for (const name of CODE_PARAMS) {
    if (searchParams.has(name)) return `${INVITE_ROUTE}?code=${encodeURIComponent(searchParams.get(name))}`;
  }
  return pathname === '/invite' ? INVITE_ROUTE : null;
}

// The same response next() from @vercel/functions builds (packages/functions/src/middleware.ts):
// a null-body response whose x-middleware-next header tells Vercel to continue to the page.
// Inlined so google-auth-library stays the project's only dependency.
export function next() {
  return new Response(null, { headers: { 'x-middleware-next': '1' } });
}

export default async function middleware(request) {
  const target = redirectTarget(new URL(request.url));
  return target ? Response.redirect(new URL(target, request.url), 302) : next();
}
