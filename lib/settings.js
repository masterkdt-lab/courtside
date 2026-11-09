// lib/settings.js
// The deposit and balance rules from the Settings tab (CONCEPT02_WAVE2_PLAN.md section 5): Courtside
// changes a rule by editing the `value` cell, never in code. getSettings() reads the tab through the
// store with a 60-second cache and falls back to the plan's placeholders for a key that is missing,
// blank or (for the four numbers) not a number. The seed rows in tests/fixtures/seed.json and the
// setup script's Settings seed are these same five keys.

import * as store from './store.js';
import { str } from './store.columns.js';

export const SETTINGS_CACHE_TTL_MS = 60 * 1000;

// key in the Sheet -> camelCase name in getSettings()'s result.
export const SETTINGS_KEYS = Object.freeze({
  deposit_per_person: 'depositPerPerson',
  deposit_per_group: 'depositPerGroup',
  balance_due_days_before: 'balanceDueDaysBefore',
  deposit_due_days: 'depositDueDays',
  currency: 'currency',
});

export const SETTINGS_DEFAULTS = Object.freeze({
  depositPerPerson: 300,
  depositPerGroup: 3000,
  balanceDueDaysBefore: 60,
  depositDueDays: 7,
  currency: 'USD',
});

// The five rows the setup script seeds when the tab is empty (the same rows as the fixture).
export const SETTINGS_SEED = Object.freeze([
  Object.freeze({ key: 'deposit_per_person', value: 300, note: 'Deposit per traveler when travelers pay individually (USD)' }),
  Object.freeze({ key: 'deposit_per_group', value: 3000, note: 'Deposit when the organizer requests group payment (USD)' }),
  Object.freeze({ key: 'balance_due_days_before', value: 60, note: 'Balance due this many days before the chosen week starts' }),
  Object.freeze({ key: 'deposit_due_days', value: 7, note: 'Days after acceptance by which the deposit is due' }),
  Object.freeze({ key: 'currency', value: 'USD', note: 'Ledger currency' }),
]);

let cache = null; // { at, settings }

export function _resetSettingsCache() {
  cache = null;
}

// "300", "$3,000", 300 -> 300; blank, "tbd", negative -> null (use the default).
function asAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  const cleaned = str(value).trim().replace(/[$,\s]/g, '');
  if (!cleaned || !/^\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

// Settings rows -> the settings object, defaults filled in. Pure; getSettings() adds the cache.
export function settingsFromRows(rows = []) {
  const byKey = new Map();
  for (const row of rows) {
    const key = str(row?.key).trim().toLowerCase();
    if (key && !byKey.has(key)) byKey.set(key, row.value);
  }
  const settings = { ...SETTINGS_DEFAULTS };
  for (const [key, name] of Object.entries(SETTINGS_KEYS)) {
    if (!byKey.has(key)) continue;
    if (name === 'currency') {
      const text = str(byKey.get(key)).trim().toUpperCase();
      if (text) settings.currency = text;
    } else {
      const amount = asAmount(byKey.get(key));
      if (amount !== null) settings[name] = amount;
    }
  }
  return settings;
}

// -> { depositPerPerson, depositPerGroup, balanceDueDaysBefore, depositDueDays, currency }
export async function getSettings(now = Date.now()) {
  if (cache && now - cache.at < SETTINGS_CACHE_TTL_MS) return cache.settings;
  const settings = settingsFromRows(await store.listSettings());
  cache = { at: now, settings };
  return settings;
}
