// tests/pages.test.js
// The real page addresses (2026-11-09): scripts/make-pages.js output is committed and current, each public
// page carries its own head (title, description, canonical, Open Graph, Twitter, structured data) and a
// <noscript> summary, the titles match the SPA's, the sitemap lists the six indexable paths, the privacy
// draft is noindex, the analytics ID ships empty, and the public copy carries no prototype wording.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGES, PRIVACY, SITE, buildAll } from '../scripts/make-pages.js';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const read = (file) => fs.readFileSync(path.join(PUBLIC, file), 'utf8');
const one = (html, re, label) => {
  const all = [...html.matchAll(new RegExp(re.source, 'g'))];
  assert.equal(all.length, 1, `exactly one ${label}`);
  return all[0][1];
};
const meta = (html, key, attr = 'name') => one(html, new RegExp(`<meta ${attr}="${key}" content="([^"]*)">`), key);
const jsonld = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

test('the generated pages on disk are what scripts/make-pages.js writes (run it after editing index.html)', () => {
  for (const { file, html } of buildAll()) assert.equal(read(file), html, `public/${file} is stale: run node scripts/make-pages.js`);
});

test('each public page has its own title, description, canonical, og/twitter tags and noscript summary', () => {
  const titles = new Set([one(read('index.html'), /<title>([^<]*)<\/title>/, 'title')]);
  const descriptions = new Set([meta(read('index.html'), 'description')]);
  for (const page of PAGES) {
    const html = read(page.file);
    const url = `${SITE}${page.path}`;
    const title = one(html, /<title>([^<]*)<\/title>/, `${page.path} title`);
    assert.equal(title, page.title.replace(/&/g, '&amp;'));
    titles.add(title);
    descriptions.add(meta(html, 'description'));
    assert.equal(one(html, /<link rel="canonical" href="([^"]*)">/, 'canonical'), url, page.path);
    assert.equal(meta(html, 'og:url', 'property'), url);
    assert.equal(meta(html, 'og:title', 'property'), title);
    assert.equal(meta(html, 'og:description', 'property'), meta(html, 'description'));
    assert.match(meta(html, 'og:image', 'property'), /^https:\/\/courtsidetravel\.co\/assets\/og\/[a-z]+\.jpg$/);
    assert.ok(fs.existsSync(path.join(PUBLIC, new URL(meta(html, 'og:image', 'property')).pathname)), 'og:image exists');
    assert.equal(meta(html, 'twitter:card'), 'summary_large_image');
    assert.equal(meta(html, 'twitter:title'), title);
    assert.equal(meta(html, 'twitter:image'), meta(html, 'og:image', 'property'));
    const noscript = one(html, /<noscript>([\s\S]*?)<\/noscript>/, 'noscript');
    assert.match(noscript, /<h1>/, `${page.path} noscript has a heading`);
    assert.ok(noscript.replace(/<[^>]+>/g, '').length > 60, `${page.path} noscript has a summary`);
    assert.equal(meta(html, 'robots'), page.path === '/invite' ? 'noindex,nofollow' : 'index,follow,max-image-preview:large');
    // Asset and script paths are absolute, so the nested pages (/trips/spanish-offseason) load them.
    assert.doesNotMatch(html, /(src|href)="(?!\/|https:|#|mailto:)/, `${page.path}: relative URLs`);
    assert.match(html, /<script src="\/analytics\.js"><\/script><script src="\/pages\.js"><\/script><script src="\/app\.js"><\/script>/);
    assert.doesNotMatch(html, /https?:\/\/(?!courtsidetravel\.co|schema\.org)/, `${page.path}: no external URLs`);
  }
  assert.equal(titles.size, PAGES.length + 1, 'titles are distinct');
  assert.equal(descriptions.size, PAGES.length + 1, 'descriptions are distinct');
});

test('the SPA sets the same titles as the generated pages (app.js PAGE_TITLES)', () => {
  const app = read('app.js');
  const src = app.match(/const PAGE_TITLES=(\{[^}]*\});/)[1];
  const titles = JSON.parse(src.replace(/'/g, '"'));
  for (const page of PAGES) assert.equal(titles[page.route], page.title, page.route);
  assert.equal(titles[''], one(read('index.html'), /<title>([^<]*)<\/title>/, 'title'));
  const paths = JSON.parse(app.match(/const PUBLIC_PATHS=(\{[^}]*\});/)[1].replace(/'/g, '"'));
  for (const page of PAGES) assert.equal(paths[page.route], page.path, page.route);
});

test('structured data: the homepage keeps its graph; the trip page has a TouristTrip, Katie’s page a Person (name + Host only)', () => {
  const home = jsonld(read('index.html'));
  assert.equal(home.length, 1);
  const types = home[0]['@graph'].map((n) => n['@type']);
  assert.deepEqual(types, ['TravelAgency', 'WebSite', 'TouristTrip']);
  assert.equal(home[0]['@graph'][2].url, `${SITE}/trips/spanish-offseason`);

  const trip = jsonld(read('trips/spanish-offseason.html'));
  assert.equal(trip.length, 1);
  const tt = trip[0]['@graph'].find((n) => n['@type'] === 'TouristTrip');
  assert.equal(tt.name, 'The Spanish Offseason');
  assert.equal(tt.url, `${SITE}/trips/spanish-offseason`);
  assert.equal(tt.provider['@id'], `${SITE}/#org`);

  const katie = jsonld(read('hosts/katie.html'));
  const person = katie[0]['@graph'].find((n) => n['@type'] === 'Person');
  assert.deepEqual(Object.keys(person).sort(), ['@id', '@type', 'jobTitle', 'name', 'url']);
  assert.equal(person.name, 'Katie Delich');
  assert.equal(person.jobTitle, 'Host');

  assert.deepEqual(jsonld(read('invite.html')), [], 'the gate has no structured data');
  assert.deepEqual(jsonld(read('privacy.html')), []);
});

test('the sitemap lists the six indexable paths and /privacy, not /invite', () => {
  const locs = [...read('sitemap.xml').matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(locs, ['/', '/trips', '/trips/spanish-offseason', '/hosts/katie', '/about', '/apply', '/privacy'].map((p) => `${SITE}${p}`));
  assert.match(read('robots.txt'), /^Sitemap: https:\/\/courtsidetravel\.co\/sitemap\.xml$/m);
});

test('internal links to public pages use real paths in the shell, the views and the 404 page', () => {
  for (const file of ['index.html', 'pages.js', '404.html', 'privacy.html', ...PAGES.map((p) => p.file)]) {
    assert.doesNotMatch(read(file), /href="\/?#\/(trip|trips|host|about|apply|invite)?"/, file);
  }
  assert.doesNotMatch(read('app.js'), /href="#\/(trip|trips|host|about|apply|invite)?"/);
});

test('the privacy notice (approved): indexable, the SPA look, last-updated line, the operator, no placeholders and the real cookie names', () => {
  const html = read('privacy.html');
  assert.notEqual(meta(html, 'robots'), 'noindex,nofollow');
  assert.equal(one(html, /<link rel="canonical" href="([^"]*)">/, 'canonical'), `${SITE}${PRIVACY.path}`);
  assert.match(html, /<link rel="stylesheet" href="\/v2\.css">/);
  assert.match(html, /<script src="\/analytics\.js"><\/script>/);
  assert.doesNotMatch(html, /<script src="\/app\.js">/);
  assert.doesNotMatch(html, /Draft for review/);
  assert.match(html, /Last updated 9 November 2026\./);
  assert.match(html, /Courtside Travel Co\. is operated by Nextwave Bet LLC/);
  assert.doesNotMatch(html, /Nextwave\.bet/);
  assert.doesNotMatch(html.split('<main')[1].replace(/<[^>]+>/g, ''), /\[/, 'no bracketed placeholders left');
  assert.doesNotMatch(html, /30 days|90 days|2 years/);
  assert.match(html, /until you clear them in your browser/);
  for (const name of ['cs_session', 'cs_member', 'courtside-consent', '_ga']) assert.match(html, new RegExp(name), name);
  assert.match(html, /team@courtsidetravel\.co/);
  assert.match(html, /our email delivery provider/i);
  assert.match(html, /No card or bank details are collected on this site/);
});

test('analytics.js carries Courtside\'s GA4 measurement ID (KC, 2026-11-09)', () => {
  assert.match(read('analytics.js'), /^ {2}const GA_MEASUREMENT_ID = 'G-E7TV4W9JDN';$/m);
});

test('public copy: no concept, prototype or verification wording on the public views', () => {
  const pages = read('pages.js');
  assert.doesNotMatch(pages, /concept|prototype|walkthrough|illustrative|\bsample\b|\bdemo\b|unconfirmed|verified before/i);
  assert.match(pages, /<h2>Hi, I'm Katie!<\/h2><p>Tennis pro, podcast host/);
  assert.match(pages, /COMING SOON/);
  assert.match(pages, /Payment and cancellation terms are coming soon, and you’ll see them before any commitment\./);
  assert.match(read('app.js'), /More journeys coming soon\./);
  for (const page of PAGES) assert.doesNotMatch(read(page.file).match(/<noscript>[\s\S]*<\/noscript>/)[0], /concept|prototype|walkthrough|illustrative|sample|demo/i, page.path);
});
