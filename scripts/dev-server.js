#!/usr/bin/env node
// scripts/dev-server.js
// Local server (Phase 1 plan 4.0; CONCEPT02_PLAN.md, Routing): plain node:http on PORT or 3000.
// Serves the Concept 02 SPA (/ → public/index.html), its public pages at their real paths (/trips,
// /trips/spanish-offseason, /hosts/katie, /about, /apply, /invite → the files scripts/make-pages.js
// writes), the privacy page (/privacy), the SPA's files (styles.css, v2.css, analytics.js, pages.js,
// app.js), the 404 page's files (style.css, marketing.css), robots.txt, sitemap.xml and favicon.svg,
// and the assets/, fonts/ and js/ folders (recursively, so assets/og/ and assets/derived/ work), with
// clean URLs. It mirrors middleware.js (the legacy /?invite=CODE and /invite?code=CODE links into the
// gate's hash route, /site to the trip page) and routes /api/<name> to the
// Web-standard GET/POST exports of api/<name>.js, for any file that exists there, so a new route
// needs no registration. Nothing else is served (lib/, api/, scripts/, tests/, .env*, package*.json,
// .data/, .git/, the plans, the README, and no *.html by file name). Any other path is a 404:
// public/404.html with status 404 when that file exists (as Vercel serves a 404.html from the output
// directory), the plain text "Not found" otherwise; unknown /api/<name> paths stay JSON. Not
// `vercel dev`: no accounts, no keys.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, loadEnv } from '../lib/env.js';
import { redirectTarget } from '../middleware.js';

// Static files live in public/ (what Vercel's "Other" preset serves when that folder exists).
const STATIC_ROOT = fs.existsSync(path.join(ROOT, 'public')) ? path.join(ROOT, 'public') : ROOT;
const API_DIR = path.join(ROOT, 'api');
// /api/<name>: one lower-case segment that names an existing api/<name>.js (checked on every call,
// so adding a route needs no restart).
const API_NAME = /^[a-z][a-z0-9-]*$/;
// The designed 404 page. Read on every miss, so changing the file needs no restart.
const NOT_FOUND_PAGE = path.join(STATIC_ROOT, '404.html');
// Clean URLs only (vercel.json cleanUrls): /privacy serves privacy.html, /privacy.html is a 404.
export const PAGES = Object.freeze({
  '/': 'index.html',
  '/trips': 'trips.html',
  '/trips/spanish-offseason': 'trips/spanish-offseason.html',
  '/hosts/katie': 'hosts/katie.html',
  '/about': 'about.html',
  '/apply': 'apply.html',
  '/invite': 'invite.html',
  '/privacy': 'privacy.html',
});
export const FILES = Object.freeze([
  '/styles.css', '/v2.css', '/analytics.js', '/gate.js', '/pages.js', '/app.js', // the Concept 02 SPA and its pages
  '/style.css', '/marketing.css', // 404.html
  '/robots.txt', '/sitemap.xml', '/favicon.svg',
]);
export const DIRS = Object.freeze({ '/assets/': 'assets', '/fonts/': 'fonts', '/js/': 'js' });
// The paths middleware.js runs on; the same redirects apply here.
export const REDIRECT_PATHS = Object.freeze(['/', '/invite', '/site', '/site.html']);
const FILE_SET = new Set(FILES);
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/; // one path segment: no slashes, no leading dot, so never ".."
const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml; charset=utf-8',
  '.ico': 'image/x-icon',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
});

const contentType = (file) => MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}

function sendJson(res, status, body, headers = {}) {
  send(res, status, JSON.stringify(body), { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
}

// 404 for anything that is not an API path: public/404.html as text/html when it exists, else plain text.
async function sendNotFound(req, res) {
  let page = null;
  try {
    page = await fs.promises.readFile(NOT_FOUND_PAGE);
  } catch {
    page = null;
  }
  if (!page) return send(res, 404, 'Not found');
  res.writeHead(404, { 'Content-Type': MIME['.html'], 'Content-Length': page.length });
  return res.end(req.method === 'HEAD' ? undefined : page);
}

// Resolve a request path to a file under public/, or null. Only the allow-listed pages, files and
// directories. Inside a directory the path may nest (assets/og/<file>), but every segment must be
// a safe name (no "..", no dotfiles, no empty segment) and the resolved path must stay inside its
// folder.
export function resolveStatic(pathname) {
  if (PAGES[pathname]) return path.join(STATIC_ROOT, PAGES[pathname]);
  if (FILE_SET.has(pathname)) return path.join(STATIC_ROOT, pathname.slice(1));
  for (const [prefix, dir] of Object.entries(DIRS)) {
    if (!pathname.startsWith(prefix)) continue;
    const segments = pathname.slice(prefix.length).split('/');
    if (!segments.every((s) => SAFE_NAME.test(s))) return null;
    const base = path.join(STATIC_ROOT, dir);
    const file = path.resolve(base, ...segments);
    return file.startsWith(base + path.sep) ? file : null;
  }
  return null;
}

// -> the api/<name>.js file for an /api/<name> path, or null when the name is unsafe or no such file exists.
export function resolveApi(name) {
  if (!API_NAME.test(name)) return null;
  const file = path.join(API_DIR, `${name}.js`);
  return fs.existsSync(file) ? file : null;
}

async function sendFile(req, res, file) {
  let data;
  try {
    const stat = await fs.promises.stat(file);
    if (!stat.isFile()) return sendNotFound(req, res);
    data = await fs.promises.readFile(file);
  } catch {
    return sendNotFound(req, res);
  }
  res.writeHead(200, { 'Content-Type': contentType(file), 'Content-Length': data.length });
  return res.end(req.method === 'HEAD' ? undefined : data);
}

// Node IncomingMessage -> Web Request (method, full URL, headers, body for non-GET).
async function toWebRequest(req) {
  const host = req.headers.host || 'localhost';
  const url = `http://${host}${req.url}`;
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(name, Array.isArray(value) ? value.join(', ') : String(value));
  }
  const method = req.method || 'GET';
  let body = null;
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (chunks.length) body = Buffer.concat(chunks);
  }
  return new Request(url, { method, headers, body });
}

// Web Response -> Node response, including every Set-Cookie header.
async function writeWebResponse(res, response) {
  const headers = {};
  for (const [name, value] of response.headers) if (name !== 'set-cookie') headers[name] = value;
  const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  if (cookies.length) headers['set-cookie'] = cookies;
  const body = Buffer.from(await response.arrayBuffer());
  res.writeHead(response.status, headers);
  res.end(body);
}

async function handleApi(req, res, name) {
  const file = resolveApi(name);
  if (!file) return sendJson(res, 404, { ok: false, reason: 'not_found' });
  const mod = await import(new URL(`../api/${name}.js`, import.meta.url));
  const handler = mod[req.method];
  if (typeof handler !== 'function') {
    const allow = ['GET', 'POST'].filter((m) => typeof mod[m] === 'function').join(', ');
    return sendJson(res, 405, { ok: false, reason: 'method_not_allowed' }, { Allow: allow });
  }
  const response = await handler(await toWebRequest(req));
  return writeWebResponse(res, response);
}

async function handle(req, res) {
  let url;
  let pathname;
  try {
    url = new URL(req.url, 'http://localhost');
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return send(res, 400, 'Bad request');
  }
  // trailingSlash: false in vercel.json: /privacy/ redirects to /privacy, keeping the query string.
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return send(res, 308, '', { Location: `${url.pathname.replace(/\/+$/, '')}${url.search}` });
  }

  if (pathname.startsWith('/api/')) return handleApi(req, res, pathname.slice('/api/'.length));
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });

  // Same as middleware.js: legacy personal links go to the gate's hash route, /site to the trip page.
  if (REDIRECT_PATHS.includes(pathname)) {
    const target = redirectTarget(url);
    if (target) return send(res, 302, '', { Location: target, 'Cache-Control': 'no-store' });
  }

  const file = resolveStatic(pathname);
  if (!file) return sendNotFound(req, res);
  return sendFile(req, res, file);
}

export function createServer({ quiet = false } = {}) {
  return http.createServer((req, res) => {
    const started = Date.now();
    if (!quiet) {
      res.on('finish', () => {
        console.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`);
      });
    }
    handle(req, res).catch((err) => {
      console.error('[dev-server]', err);
      if (!res.headersSent) send(res, 500, 'Internal server error');
      else res.end();
    });
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  loadEnv();
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, () => {
    console.log(`Courtside dev server → http://localhost:${port}`);
  });
}
