// middleware.js — Vercel Routing Middleware (plan 4.0).
// /site and /site.html require a valid cs_session cookie; anyone else is sent to the gate at /.
// The decision itself lives in lib/guard.js and is shared with scripts/dev-server.js. Nothing in
// this file's import graph (lib/guard.js, lib/cookie.js) uses node: modules, so it runs on either
// middleware runtime. (The plan says "edge"; Vercel's current docs default Routing Middleware to
// the Node.js runtime. No `runtime` is set here, so the platform default applies.)

import { isAllowed, secretFromEnv } from './lib/guard.js';

export const config = { matcher: ['/site', '/site.html'] };

// The same response next() from @vercel/functions builds (packages/functions/src/middleware.ts):
// a null-body response whose x-middleware-next header tells Vercel to continue to the page.
// Inlined so google-auth-library stays the project's only dependency.
export function next() {
  return new Response(null, { headers: { 'x-middleware-next': '1' } });
}

export default async function middleware(request) {
  if (await isAllowed(request, secretFromEnv(globalThis.process?.env))) return next();
  return Response.redirect(new URL('/', request.url), 302);
}
