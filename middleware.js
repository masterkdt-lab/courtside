// middleware.js — Vercel Routing Middleware (CONCEPT02_PLAN.md, Routing; real page paths 2026-11-09).
// The public pages have real addresses (/trips, /trips/spanish-offseason, /hosts/katie, /about, /apply,
// /invite: static files written by scripts/make-pages.js, served by vercel.json cleanUrls). The private
// flows are hash routes of the same SPA. Four paths reach this function (config.matcher below):
//   /, /invite           a personal link from before Concept 02 (/?invite=CODE, /?code=CODE,
//                        /invite?invite=CODE, /invite?code=CODE) → 302 /#/invite?code=CODE, where
//                        the SPA prefills the gate and submits it. A bare /invite (or one with any
//                        other query) continues to the real /invite page. A plain / continues to the SPA.
//   /site, /site.html    the old guarded trip page → 302 /trips/spanish-offseason. The trip page is
//                        public; the cookie no longer gates anything, so no cookie check runs here.
// scripts/dev-server.js imports redirectTarget() so both servers redirect the same way. Nothing in
// this file imports anything, so it runs on either middleware runtime. (Vercel's current docs
// default Routing Middleware to the Node.js runtime. No `runtime` is set here, so the platform
// default applies.)
//
// Matcher entries are path-to-regexp patterns (Vercel docs, "Path matching"): '/' matches the root
// only; a prefix would need '/:path*'. So nothing here catches /privacy, /trips, /api/* or the static files.

export const config = { matcher: ['/', '/invite', '/site', '/site.html'] };

// Where a legacy personal link lands (the SPA's gate as a hash route, the form personal links have always
// taken), and the trip page's real address.
export const INVITE_ROUTE = '/#/invite';
export const TRIP_ROUTE = '/trips/spanish-offseason';
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
  return null;
}

// The same response next() from @vercel/functions builds (packages/functions/src/middleware.ts):
// a null-body response whose x-middleware-next header tells Vercel to continue to the page.
// Inlined so google-auth-library stays the project's only dependency.
export function next() {
  return new Response(null, { headers: { 'x-middleware-next': '1' } });
}

// The www name sends everything to the bare domain. vercel.json does this for every path the
// matcher above does not catch; the paths it does catch reach this function first.
export const WWW_HOST = 'www.courtsidetravel.co';
export const APEX_ORIGIN = 'https://courtsidetravel.co';

export default async function middleware(request) {
  const url = new URL(request.url);
  if (url.hostname === WWW_HOST) return Response.redirect(`${APEX_ORIGIN}${url.pathname}${url.search}`, 308);
  const target = redirectTarget(url);
  return target ? Response.redirect(new URL(target, request.url), 302) : next();
}
