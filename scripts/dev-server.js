#!/usr/bin/env node
// scripts/dev-server.js
// Local server (Phase 1 plan 4.0, Phase 2 plan section 6): plain node:http on PORT or 3000.
// Serves only the pages (/ homepage, /invite gate, /pros, /privacy), style.css, marketing.css,
// js/, assets/ (recursively, so assets/derived/ works) and robots.txt with clean URLs, mirrors
// middleware.js (the legacy /?invite=CODE redirect to /invite and the cookie guard on /site), and
// routes /api/<name> to the Web-standard GET/POST exports in api/<name>.js. Nothing else is served
// (lib/, api/, scripts/, tests/, .env*, package*.json, .data/, .git/, the plans, the README, and
// no *.html by file name). Any other path is a 404: public/404.html with status 404 when that file
// exists (as Vercel serves a 404.html from the output directory), the plain text "Not found"
// otherwise; unknown /api/<name> paths stay JSON. Not `vercel dev`: no accounts, no keys.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, getSecret, loadEnv } from '../lib/env.js';
import { isAllowed } from '../lib/guard.js';
import { GATE_PATH, legacyInviteRedirect } from '../middleware.js';

// Static files live at the repo root today. If they are moved into public/ (what Vercel's "Other"
// preset serves when that folder exists, instead of the whole root), the server follows.
const STATIC_ROOT = fs.existsSync(path.join(ROOT, 'public')) ? path.join(ROOT, 'public') : ROOT;
const API_ROUTES = new Set(['code', 'session', 'trips', 'request', 'waitlist', 'event']);
// The designed 404 page (polish plan section 7). Read on every miss, so adding the file needs no restart.
const NOT_FOUND_PAGE = path.join(STATIC_ROOT, '404.html');
// Clean URLs only: /invite serves invite.html, /invite.html is a 404. A page whose file does not
// exist yet (Wave 2 adds pros.html) is a plain 404 from sendFile.
const PAGES = Object.freeze({ '/': 'index.html', '/invite': 'invite.html', '/pros': 'pros.html', '/privacy': 'privacy.html' });
const GUARDED = new Set(['/site', '/site.html']);
const FILES = new Set(['/robots.txt', '/style.css', '/marketing.css', '/favicon.svg']);
const DIRS = Object.freeze({ '/js/': 'js', '/assets/': 'assets' });
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
  '.ico': 'image/x-icon',
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

// Resolve a request path to a file under ROOT, or null. Only the allow-listed pages, files and
// directories. Inside a directory the path may nest (assets/derived/<file>), but every segment
// must be a safe name (no "..", no dotfiles, no empty segment) and the resolved path must stay
// inside its folder.
export function resolveStatic(pathname) {
  if (PAGES[pathname]) return path.join(STATIC_ROOT, PAGES[pathname]);
  if (FILES.has(pathname)) return path.join(STATIC_ROOT, pathname.slice(1));
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
  if (!API_ROUTES.has(name)) return sendJson(res, 404, { ok: false, reason: 'not_found' });
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
  // trailingSlash: false in vercel.json: /site/ redirects to /site, keeping the query string.
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return send(res, 308, '', { Location: `${url.pathname.replace(/\/+$/, '')}${url.search}` });
  }

  if (pathname.startsWith('/api/')) return handleApi(req, res, pathname.slice('/api/'.length));
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });

  // Same as middleware.js: a pre-Phase-2 personal link (/?invite=CODE or /?code=CODE) goes to the
  // gate with its query string intact; a plain / is the homepage.
  if (pathname === '/') {
    const target = legacyInviteRedirect(url);
    if (target) return send(res, 302, '', { Location: target, 'Cache-Control': 'no-store' });
  }

  if (GUARDED.has(pathname)) {
    const allowed = await isAllowed(await toWebRequest(req), getSecret());
    if (!allowed) return send(res, 302, '', { Location: GATE_PATH, 'Cache-Control': 'no-store' });
    return sendFile(req, res, path.join(STATIC_ROOT, 'site.html'));
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
