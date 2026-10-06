#!/usr/bin/env node
// scripts/dev-server.js
// Local server (plan 4.0): plain node:http on PORT or 3000. Serves only the pages, style.css,
// js/, assets/ and robots.txt with clean URLs, applies the same cookie guard as middleware.js to
// /site, and routes /api/<name> to the Web-standard GET/POST exports in api/<name>.js. Nothing
// else is served (lib/, api/, scripts/, tests/, .env*, package*.json, .data/, .git/, the plan,
// the README). Not `vercel dev`: no accounts, no keys.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, getSecret, loadEnv } from '../lib/env.js';
import { isAllowed } from '../lib/guard.js';

// Static files live at the repo root today. If they are moved into public/ (what Vercel's "Other"
// preset serves when that folder exists, instead of the whole root), the server follows.
const STATIC_ROOT = fs.existsSync(path.join(ROOT, 'public')) ? path.join(ROOT, 'public') : ROOT;
const API_ROUTES = new Set(['code', 'session', 'trips', 'request']);
const PAGES = Object.freeze({ '/': 'index.html', '/privacy': 'privacy.html' });
const GUARDED = new Set(['/site', '/site.html']);
const FILES = new Set(['/robots.txt', '/style.css']);
const DIRS = Object.freeze({ '/js/': 'js', '/assets/': 'assets' });
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/; // one path segment, no slashes, no leading dot
const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
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

// Resolve a request path to a file under ROOT, or null. Only the allow-listed pages, files and
// directories; names are single safe segments, and the resolved path must stay inside its folder.
function resolveStatic(pathname) {
  if (PAGES[pathname]) return path.join(STATIC_ROOT, PAGES[pathname]);
  if (FILES.has(pathname)) return path.join(STATIC_ROOT, pathname.slice(1));
  for (const [prefix, dir] of Object.entries(DIRS)) {
    if (!pathname.startsWith(prefix)) continue;
    const name = pathname.slice(prefix.length);
    if (!SAFE_NAME.test(name)) return null;
    const base = path.join(STATIC_ROOT, dir);
    const file = path.resolve(base, name);
    return file.startsWith(base + path.sep) ? file : null;
  }
  return null;
}

async function sendFile(req, res, file) {
  let data;
  try {
    const stat = await fs.promises.stat(file);
    if (!stat.isFile()) return send(res, 404, 'Not found');
    data = await fs.promises.readFile(file);
  } catch {
    return send(res, 404, 'Not found');
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
  if (!API_ROUTES.has(name)) return send(res, 404, 'Not found');
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

  if (GUARDED.has(pathname)) {
    const allowed = await isAllowed(await toWebRequest(req), getSecret());
    if (!allowed) return send(res, 302, '', { Location: '/', 'Cache-Control': 'no-store' });
    return sendFile(req, res, path.join(STATIC_ROOT, 'site.html'));
  }

  const file = resolveStatic(pathname);
  if (!file) return send(res, 404, 'Not found');
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
