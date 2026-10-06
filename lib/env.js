// lib/env.js
// Ten-line .env loader (plan 4.0: no dotenv). Loads <repo>/.env into process.env when the file
// exists, never overriding variables that are already set, so `npm run dev` and `npm test` work
// with no .env at all. Node-only (fs): the edge middleware must not import this file.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEV_COOKIE_SECRET, secretFromEnv } from './guard.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ENV_PATH = path.join(ROOT, '.env');

// KEY=VALUE lines. Blank lines and # comments are skipped, an optional `export ` prefix and
// optional matching surrounding quotes are removed, and an unquoted trailing " # comment" is
// dropped. Values are otherwise verbatim: a literal \n stays \n (the Sheets client converts
// GOOGLE_PRIVATE_KEY itself).
export function parseEnv(text) {
  const out = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '');
    }
    out[match[1]] = value;
  }
  return out;
}

// -> the variables that were applied (those not already set in env).
export function loadEnv({ file = ENV_PATH, env = process.env } = {}) {
  if (!fs.existsSync(file)) return {};
  const parsed = parseEnv(fs.readFileSync(file, 'utf8'));
  const applied = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] !== undefined) continue;
    env[key] = value;
    applied[key] = value;
  }
  return applied;
}

let warnedAboutDefault = false;

// COOKIE_SECRET, or the fixed dev default (with a one-time warning) when it is unset.
export function getSecret(env = process.env) {
  const secret = secretFromEnv(env);
  if (secret === DEV_COOKIE_SECRET && !warnedAboutDefault) {
    warnedAboutDefault = true;
    console.warn('[courtside] COOKIE_SECRET is not set; using the development default. Set COOKIE_SECRET in Vercel before going live.');
  }
  return secret;
}

export function _resetSecretWarning() {
  warnedAboutDefault = false;
}
