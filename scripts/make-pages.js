#!/usr/bin/env node
// scripts/make-pages.js — one static HTML file per public page, from public/index.html.
//
// The site is a single-page app: app.js renders every view into #main. Search engines and link previews
// read the HTML they are served, so each public address gets its own copy of the shell with its own
// <title>, description, canonical, Open Graph and Twitter tags, structured data and a <noscript> summary of
// the page. The SPA then renders the same view as before. No build step: run this after changing
// public/index.html (the template, and the homepage itself) or the page text below, and commit the output.
//
//   node scripts/make-pages.js           write the files
//   node scripts/make-pages.js --check   exit 1 when a file on disk differs from what would be written
//
// Writes public/trips.html, public/trips/spanish-offseason.html, public/hosts/katie.html,
// public/about.html, public/apply.html and public/invite.html (Vercel cleanUrls serves public/trips.html at
// /trips). It also refreshes the shared header and footer of public/privacy.html from the template; the
// privacy page's <main> is kept exactly as written in that file.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
export const SITE = 'https://courtsidetravel.co';
const INDEXABLE = 'index,follow,max-image-preview:large';
const NOINDEX = 'noindex,nofollow';
const ORG = { '@type': 'TravelAgency', '@id': `${SITE}/#org`, name: 'Courtside Travel Co.', url: `${SITE}/` };
const crumbs = (...items) => ({
  '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, p], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${SITE}${p}` })),
});

const TRIP_DESCRIPTION = 'Six nights on Spain’s Costa Blanca with Katie + Eva: clay mornings at Club de Tenis Almoradí, a stay at La Finca Resort, open afternoons and long lunches. January–February 2027, private groups of 4–12 players.';

// The public pages. route is the SPA route (app.js PUBLIC_PATHS); title must match app.js PAGE_TITLES.
export const PAGES = Object.freeze([
  {
    route: 'trips',
    path: '/trips',
    file: 'trips.html',
    title: 'Hosted tennis trips — Courtside Travel Co.',
    description: 'Small, hosted tennis trips with a pro you know. Start with The Spanish Offseason on Spain’s Costa Blanca with Katie + Eva, January–February 2027. More journeys coming soon.',
    image: 'home.jpg',
    jsonld: { '@context': 'https://schema.org', '@graph': [crumbs(['Courtside', '/'], ['Trips', '/trips'])] },
    noscript: '<h1>Where tennis takes you next.</h1><p>The Courtside collection. Start with Spain. More journeys coming soon.</p>'
      + '<h2><a href="/trips/spanish-offseason">The Spanish Offseason</a></h2><p>Costa Blanca, Spain · hosted by Katie + Eva · January–February 2027. Six nights. Real clay courts. Long lunches. A week with the people you love to play with.</p>'
      + '<h2>A little more Mallorca</h2><p>The Mediterranean · coming soon. Hosts, dates and details coming soon.</p>'
      + '<h2>Courtside in Charleston</h2><p>South Carolina · coming soon. Hosts, dates and details coming soon.</p>',
  },
  {
    route: 'trip',
    path: '/trips/spanish-offseason',
    file: 'trips/spanish-offseason.html',
    title: 'The Spanish Offseason — a hosted tennis week in Spain | Courtside Travel Co.',
    description: `${TRIP_DESCRIPTION.replace(', private groups of 4–12 players.', '.')} From $2,995 per player.`,
    image: 'home.jpg',
    jsonld: {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'TouristTrip',
          '@id': `${SITE}/trips/spanish-offseason#trip`,
          name: 'The Spanish Offseason',
          description: TRIP_DESCRIPTION,
          url: `${SITE}/trips/spanish-offseason`,
          image: [`${SITE}/assets/coast.jpg`, `${SITE}/assets/court.jpg`, `${SITE}/assets/spain.jpg`],
          touristType: 'Tennis players',
          provider: ORG,
        },
        crumbs(['Courtside', '/'], ['Trips', '/trips'], ['The Spanish Offseason', '/trips/spanish-offseason']),
      ],
    },
    noscript: '<h1>The Spanish Offseason</h1><p>Costa Blanca, Spain · six nights · January–February 2027 · hosted by <a href="/hosts/katie">Katie + Eva</a>.</p>'
      + '<p>Join Katie and Eva on Spain’s Costa Blanca. Play at Club de Tenis Almoradí, settle into La Finca Resort and make time for the coast, good food and each other. Katie enjoys the week with you. Courtside handles the planning and coordination, so everyone can be present.</p>'
      + '<h2>The week, at a glance.</h2><ul><li>Six-night resort stay</li><li>Four tennis mornings</li><li>Daily breakfast</li><li>Scheduled club transfers</li><li>Welcome + farewell dinners</li><li>Courtside trip support</li></ul>'
      + '<p>Final inclusions, host schedule and supplier availability are confirmed in your personal proposal. Airfare, personal spending and optional extras are excluded.</p>'
      + '<h2>Your Sunday–Saturday rhythm.</h2><p>Sunday: arrive and join the welcome dinner. Monday–Tuesday: clay mornings with Katie + Eva, open afternoons. Wednesday: golf, spa, exploring or nothing at all. Thursday–Friday: more tennis and a farewell dinner. Saturday: breakfast and departure.</p>'
      + '<p>From $2,995 per player (shared-room starting estimate). Private groups of 4–12 players; non-playing partners welcome; solo travelers can ask Courtside to help find a group. A request starts a conversation: no payment, and your place is confirmed only after the booking steps in your personal proposal.</p>',
  },
  {
    route: 'host',
    path: '/hosts/katie',
    file: 'hosts/katie.html',
    title: 'Katie Delich, your host — Courtside Travel Co.',
    description: 'Meet Katie Delich, your host for The Spanish Offseason: a week of tennis on Spain’s Costa Blanca with Katie + Eva, planned and coordinated by Courtside Travel Co.',
    image: 'pros.jpg',
    jsonld: {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'Person', '@id': `${SITE}/hosts/katie#person`, name: 'Katie Delich', jobTitle: 'Host', url: `${SITE}/hosts/katie` },
        crumbs(['Courtside', '/'], ['Katie Delich', '/hosts/katie']),
      ],
    },
    noscript: '<h1>Katie Delich.</h1><p>Great tennis. Good people. Somewhere worth sharing.</p>'
      + '<p>Katie brings her community into the places and relationships she loves. In Spain, that means time on court with Eva, the Costa Blanca and a week that leaves room for life beyond tennis. She brings the connection. Courtside takes care of the journey.</p>'
      + "<p>Hi, I'm Katie! Tennis pro, podcast host, and co-founder of Courtside Travel Co. Basically, if it involves a racquet and a plane ticket, I'm in!</p><p>Tennis has taken me from Division I competition at Robert Morris University to teaching in the Maldives, the Caribbean, Dubai, Hawaii, Mexico, Spain, Palm Desert, Virginia and Napa. Along the way, I've led the tennis program at Silverado Resort, earned USPTA Elite Professional and PTR P-1 certifications, and been named one of Tennis Channel's Top 50 US Coaches.</p><p>But the best trips aren't only about what happens on court! I love discovering local food, exploring somewhere new and making sure the people without racquets have a great time too. That's the spirit I bring to Courtside: great tennis, real connection and plenty to look forward to after the last point.</p><p>I also host 2 Truths, 1 Dream and have served on the boards of RSPA NorCal and Food For Life Vrindavan, supporting girls' education and well-being in India.</p><p>Pennsylvania roots. A world of courts. Let's play!</p>"
      + '<p><a href="/trips/spanish-offseason">Explore Spain with Katie: The Spanish Offseason</a></p>',
  },
  {
    route: 'about',
    path: '/about',
    file: 'about.html',
    title: 'About Courtside Travel Co. — travel with your pro',
    description: 'Courtside helps exceptional tennis pros take their communities into the world. Your pro hosts the experience; Courtside handles planning, bookings, coordination and guest support.',
    image: 'home.jpg',
    jsonld: { '@context': 'https://schema.org', '@graph': [crumbs(['Courtside', '/'], ['About', '/about'])] },
    noscript: '<h1>Travel with your people.</h1><p>Exceptional tennis pros have communities built on trust. Courtside helps them take those communities into the world.</p>'
      + '<p>Your pro hosts the experience. Courtside handles planning, bookings, coordination and guest support. Everyone gets to enjoy the journey together.</p>'
      + '<p><a href="/trips/spanish-offseason">Explore Spain</a> · <a href="/apply">Become a host</a></p>',
  },
  {
    route: 'apply',
    path: '/apply',
    file: 'apply.html',
    title: 'Host a trip with Courtside — for tennis pros',
    description: 'For tennis pros: bring your people somewhere extraordinary. Courtside plans, coordinates and supports the trip while you enjoy it with your community. Apply to host.',
    image: 'pros.jpg',
    jsonld: { '@context': 'https://schema.org', '@graph': [crumbs(['Courtside', '/'], ['Host with Courtside', '/apply'])] },
    noscript: '<h1>Bring your people.</h1><p>You’ve built something special at your club. Take that connection somewhere extraordinary. Courtside plans, coordinates and supports the trip. You enjoy the journey with your community.</p>'
      + '<h2>Exceptional on court. Wonderful to travel with.</h2><p>The people come first: we look for excellent teaching, warmth, professionalism and a community that enjoys time together. Katie helps lead the selection.</p>'
      + '<p>We handle the details: planning, supplier coordination, guest preferences and support. Your role and compensation are agreed before a trip launches.</p>'
      + '<p>Start with a conversation: tell us about yourself and the trip you imagine. Turn on JavaScript to send an application.</p>',
  },
  {
    route: 'invite',
    path: '/invite',
    file: 'invite.html',
    title: 'Enter your invitation — Courtside Travel Co.',
    description: 'Enter the code from your Courtside invitation to explore your trip.',
    image: 'invite.jpg',
    robots: NOINDEX,
    jsonld: null,
    noscript: '<h1>A week with your pro.</h1><p>Enter the code from your invitation to explore the experience. Turn on JavaScript to enter your code.</p>',
  },
]);

export const PRIVACY = Object.freeze({
  path: '/privacy',
  file: 'privacy.html',
  title: 'Privacy notice — Courtside Travel Co.',
  description: 'What Courtside Travel Co. collects through this site, why, who helps us run it, and the choices you have.',
  image: 'home.jpg',
  robots: INDEXABLE, // approved by KC on 2026-11-09
});

const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const text = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// JSON inside <script>: "<" is escaped so the text can never close the element.
const ldJson = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');

// Replace exactly one match of re in html; throw when the template no longer has it.
function swap(html, re, replacement, label) {
  const matches = html.match(new RegExp(re.source, `${re.flags.replace('g', '')}g`)) || [];
  if (matches.length !== 1) throw new Error(`make-pages: expected one ${label} in public/index.html, found ${matches.length}`);
  return html.replace(re, () => replacement);
}

const BANNER = '<!-- Generated by scripts/make-pages.js from public/index.html: edit the template or the script, then run node scripts/make-pages.js. -->\n';

function head(html, page) {
  const url = `${SITE}${page.path}`;
  const image = `${SITE}/assets/og/${page.image}`;
  html = swap(html, /<title>[^<]*<\/title>/, `<title>${text(page.title)}</title>`, '<title>');
  html = swap(html, /<meta name="description" content="[^"]*">/, `<meta name="description" content="${attr(page.description)}">`, 'description');
  html = swap(html, /<meta name="robots" content="[^"]*">/, `<meta name="robots" content="${page.robots || INDEXABLE}">`, 'robots');
  html = swap(html, /<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${url}">`, 'canonical');
  html = swap(html, /<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${attr(page.title)}">`, 'og:title');
  html = swap(html, /<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${attr(page.description)}">`, 'og:description');
  html = swap(html, /<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${url}">`, 'og:url');
  html = swap(html, /<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${image}">`, 'og:image');
  html = swap(html, /<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${attr(page.title)}">`, 'twitter:title');
  html = swap(html, /<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${attr(page.description)}">`, 'twitter:description');
  html = swap(html, /<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="${image}">`, 'twitter:image');
  const ld = page.jsonld ? `<script type="application/ld+json">${ldJson(page.jsonld)}</script>\n` : '';
  html = swap(html, /<script type="application\/ld\+json">[\s\S]*?<\/script>\n?/, ld, 'JSON-LD block');
  return html;
}

// -> the HTML for one public SPA page.
export function renderPage(template, page) {
  let html = head(template, page);
  html = swap(html, /<noscript>[\s\S]*?<\/noscript>/, `<noscript><section class="wrap">${page.noscript}</section></noscript>`, '<noscript> summary');
  return html.replace(/^<!doctype html>/i, (d) => `${d}\n${BANNER}`);
}

// -> privacy.html: the template's head (privacy values), header and footer around the privacy page's own
// <main>, and no SPA scripts (analytics.js for the consent banner, and the mobile menu toggle inline).
export function renderPrivacy(template, current) {
  const main = current.match(/<main id="main" tabindex="-1">[\s\S]*<\/main>/);
  if (!main) throw new Error('make-pages: public/privacy.html has no <main id="main" tabindex="-1"> to keep');
  let html = head(template, { ...PRIVACY, jsonld: null });
  html = swap(html, /<main id="main" tabindex="-1">[\s\S]*?<\/main>/, main[0], '<main>');
  html = swap(html, /<div id="overlay"><\/div><div id="live" role="status" aria-live="polite"><\/div>/, '', 'overlay + live region');
  html = swap(
    html,
    /<script src="\/analytics\.js"><\/script><script src="\/pages\.js"><\/script><script src="\/app\.js"><\/script>/,
    '<script>function toggleNav(){var m=document.getElementById(\'mobilenav\'),open=m.hidden;m.hidden=!open;document.getElementById(\'navtoggle\').setAttribute(\'aria-expanded\',String(open))}</script><script src="/analytics.js"></script>',
    'SPA scripts',
  );
  return html.replace(/^<!doctype html>/i, (d) => `${d}\n${BANNER.replace(' -->', ' Only the <main> of this file is hand-written; it is kept as is. -->')}`);
}

// -> [{ file, html }] for every generated file.
export function buildAll() {
  const template = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  const out = PAGES.map((page) => ({ file: page.file, html: renderPage(template, page) }));
  const privacyFile = path.join(PUBLIC, PRIVACY.file);
  out.push({ file: PRIVACY.file, html: renderPrivacy(template, fs.readFileSync(privacyFile, 'utf8')) });
  return out;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const check = process.argv.includes('--check');
  const stale = [];
  for (const { file, html } of buildAll()) {
    const target = path.join(PUBLIC, file);
    const now = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
    if (now === html) continue;
    if (check) stale.push(file);
    else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, html);
      console.log(`wrote public/${file}`);
    }
  }
  if (check && stale.length) {
    console.error(`out of date (run node scripts/make-pages.js): ${stale.map((f) => `public/${f}`).join(', ')}`);
    process.exit(1);
  }
  if (check) console.log('all generated pages are up to date');
}
