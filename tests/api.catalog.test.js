// tests/api.catalog.test.js
// lib/catalog.js must match the served builder: site.html (<strong> add-on names, vetted options,
// week chips), js/site.js (roomData, tennisData) and tests/fixtures/seed.json (weeks).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ADDONS, ADDON_TYPES, LEVELS, LIMITS, PARTY_TYPES, PRIORITIES, RANGES, REQUEST_TYPES, ROOMS, TENNIS,
  TENNIS_STYLES, TRAVEL_STYLES, TRIP_ID, WEEKS, WEEK_IDS, addonById, isWeekId, roomName, tennisName,
} from '../lib/catalog.js';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const html = read('site.html');
const siteJs = read('js/site.js');
const seed = JSON.parse(read('tests/fixtures/seed.json'));
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const all = (re, text, pick = (m) => m[1]) => [...text.matchAll(re)].map(pick);

test('add-ons: ids, types and <strong> names match site.html', () => {
  const fromHtml = all(
    /<div class="addon" data-cost="\d+" data-id="([a-z]+)" data-type="([a-z]+)">[\s\S]*?<strong>([^<]+)<\/strong>/g,
    html,
    (m) => ({ id: m[1], type: m[2], name: decode(m[3]) }),
  );
  assert.equal(fromHtml.length, 10);
  assert.deepEqual(ADDONS.map((a) => ({ id: a.id, type: a.type, name: a.name })), fromHtml);
  for (const a of ADDONS) assert.ok(ADDON_TYPES.includes(a.type), a.id);
  assert.deepEqual(ADDONS.filter((a) => a.type === 'player').map((a) => a.id), ['eva', 'padel']);
  assert.deepEqual(ADDONS.filter((a) => a.type === 'guest').map((a) => a.id), ['massage', 'golf', 'alicante', 'cartagena', 'food', 'dinner']);
  assert.deepEqual(ADDONS.filter((a) => a.type === 'group').map((a) => a.id), ['driver']);
  assert.deepEqual(ADDONS.filter((a) => a.type === 'none').map((a) => a.id), ['free']);
});

test('rooms and tennis match roomData / tennisData in js/site.js and the inputs in site.html', () => {
  const block = (name) => siteJs.match(new RegExp(`${name}=\\{(.*?)\\};`))[1];
  const names = (name) => all(/(\w+):\{name:'([^']*)'/g, block(name), (m) => ({ id: m[1], name: m[2] }));
  assert.deepEqual(ROOMS.map((r) => ({ id: r.id, name: r.name })), names('roomData'));
  assert.deepEqual(TENNIS.map((t) => ({ id: t.id, name: t.name })), names('tennisData'));
  assert.deepEqual(all(/name="room" type="radio" value="([^"]+)"/g, html), ROOMS.map((r) => r.id));
  assert.deepEqual(all(/name="tennis" type="radio" value="([^"]+)"/g, html), TENNIS.map((t) => t.id));
  assert.equal(roomName('club'), 'Club View');
  assert.equal(tennisName('core'), '4 mornings + Eva');
  assert.equal(roomName('nope'), '');
});

test('vetted option sets match site.html', () => {
  const select = (id) => all(/<option[^>]*>([^<]*)<\/option>/g, html.match(new RegExp(`<select id="${id}">([\\s\\S]*?)<\\/select>`))[1]).map(decode);
  assert.deepEqual([...PARTY_TYPES], all(/name="partyType" type="radio" value="([^"]+)"/g, html).map(decode));
  assert.deepEqual([...LEVELS], select('vettedLevel'));
  assert.deepEqual([...TENNIS_STYLES], select('vettedTennisStyle'));
  assert.deepEqual([...TRAVEL_STYLES], all(/name="travelStyle" type="radio" value="([^"]+)"/g, html).map(decode));
  const grid = html.match(/<div class="priority-grid">([\s\S]*?)<\/div>/)[1];
  assert.deepEqual([...PRIORITIES], all(/value="([^"]+)"/g, grid).map(decode));
});

test('weeks match the ribbon in site.html and the seed data', () => {
  const chips = all(/<div class="week-chip"><span>W\d<\/span><strong>([^<]+)<\/strong>/g, html).map(decode);
  assert.deepEqual(WEEKS.map((w) => w.label), chips);
  assert.deepEqual(WEEKS.map((w) => ({ id: w.id, label: w.label })), seed.weeks.map((w) => ({ id: w.week_id, label: w.label })));
  assert.deepEqual([...WEEK_IDS], ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7']);
  assert.equal(isWeekId('w5'), true);
  assert.equal(isWeekId('w8'), false);
  assert.equal(TRIP_ID, seed.trips[0].trip_id);
});

test('ranges, limits and request types are the plan values', () => {
  assert.deepEqual(RANGES, { players: { min: 4, max: 12 }, partners: { min: 0, max: 12 }, singleRooms: { min: 0 } });
  assert.deepEqual(LIMITS, { note: 2000, brief: 5000, estimate: 60 });
  assert.deepEqual([...REQUEST_TYPES], ['private', 'vetted']);
  assert.equal(addonById('driver').type, 'group');
  assert.equal(addonById('x'), null);
  assert.ok(Object.isFrozen(ADDONS) && Object.isFrozen(ADDONS[0]) && Object.isFrozen(RANGES.players));
});
