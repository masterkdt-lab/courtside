// lib/store.sheets.client.js
// Google Sheets REST (v4) helpers shared by store.sheets.js and scripts/setup-sheet.js:
// env/config, service-account auth (google-auth-library JWT, loaded lazily), A1 helpers and a
// small fetch wrapper. Nothing here reads the env or touches the network until a client method
// is called, so importing it with no Google env vars set is safe.

import { str } from './store.columns.js';

export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
export const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
export const REQUIRED_ENV = Object.freeze(['SHEET_ID', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY']);

// GOOGLE_PRIVATE_KEY arrives with literal "\n" (and sometimes wrapping quotes); make it a real PEM.
export function normalizePrivateKey(raw) {
  let key = str(raw).trim();
  if (key.length >= 2 && ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'")))) {
    key = key.slice(1, -1);
  }
  return key.replace(/\\n/g, '\n');
}

export function missingEnv(env = process.env) {
  return REQUIRED_ENV.filter((key) => str(env[key]).trim() === '');
}

export function readConfig(env = process.env) {
  const missing = missingEnv(env);
  if (missing.length) {
    throw new Error(
      `Google Sheets backend: missing ${missing.join(', ')}. `
      + 'Set them in .env (see .env.example) or use DATA_BACKEND=mock.',
    );
  }
  return {
    sheetId: env.SHEET_ID.trim(),
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL.trim(),
    privateKey: normalizePrivateKey(env.GOOGLE_PRIVATE_KEY),
  };
}

let jwtCache = null;

// Bearer token for the service account. google-auth-library caches and refreshes the token
// itself; we keep one JWT client per (email, key) so repeated calls do not re-sign.
export async function getAccessToken({ email, privateKey }) {
  const { JWT } = await import('google-auth-library');
  if (!jwtCache || jwtCache.email !== email || jwtCache.privateKey !== privateKey) {
    jwtCache = { email, privateKey, client: new JWT({ email, key: privateKey, scopes: [SHEETS_SCOPE] }) };
  }
  const { token } = await jwtCache.client.getAccessToken();
  if (!token) throw new Error('Google auth returned no access token for the service account');
  return token;
}

// A1 helpers --------------------------------------------------------------------------------

export function quoteTab(tab) {
  return `'${str(tab).replace(/'/g, "''")}'`;
}

// "'Group''s tab'!A2:C2" -> "Group's tab"; null when the range does not start with a quoted tab.
export function tabOfRange(range) {
  const m = /^'((?:[^']|'')*)'!/.exec(str(range));
  return m ? m[1].replace(/''/g, "'") : null;
}

export function tabRange(tab, a1 = 'A1:ZZ') {
  return `${quoteTab(tab)}!${a1}`;
}

// 0 -> A, 25 -> Z, 26 -> AA, 28 -> AC
export function columnLetter(index) {
  let n = Math.floor(index) + 1;
  if (!(n >= 1)) throw new RangeError(`column index out of range: ${index}`);
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export function cellRange(tab, columnIndex, rowNumber) {
  return `${quoteTab(tab)}!${columnLetter(columnIndex)}${rowNumber}`;
}

export function valuesUrl(sheetId, range, params = {}, suffix = '') {
  const url = new URL(`${SHEETS_API}/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}${suffix}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

// Client ------------------------------------------------------------------------------------
//
// createSheetsClient({ sheetId, fetch, getToken, env })
//   sheetId / getToken  injected for tests; otherwise read from env on first use
//   fetch               injected for tests; otherwise globalThis.fetch, resolved per call
//   env                 defaults to process.env

export function createSheetsClient(options = {}) {
  const env = options.env || process.env;
  let resolved = null;

  function resolve() {
    if (resolved) return resolved;
    if (options.sheetId && options.getToken) {
      resolved = { sheetId: options.sheetId, getToken: options.getToken };
    } else {
      const config = readConfig(env); // throws the clear "missing ..." error
      resolved = {
        sheetId: options.sheetId || config.sheetId,
        getToken: options.getToken || (() => getAccessToken(config)),
      };
    }
    return resolved;
  }

  function fetchImpl(...args) {
    const fn = options.fetch || globalThis.fetch;
    if (typeof fn !== 'function') throw new Error('No fetch available; Node 18+ is required');
    return fn(...args);
  }

  // Google answers 429 when the service account passes 60 reads a minute. Back off and retry, as
  // Google's quota guidance asks. Injected fetches (unit tests) get no retries unless they ask.
  const retryDelays = options.retryDelays || (options.fetch ? [] : [1000, 2500, 5000]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function request(method, url, body) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await requestOnce(method, url, body);
      } catch (err) {
        if (err.status !== 429 || attempt >= retryDelays.length) throw err;
        await sleep(retryDelays[attempt] + Math.floor(Math.random() * 400));
      }
    }
  }

  async function requestOnce(method, url, body) {
    const token = await resolve().getToken();
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
    let payload;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetchImpl(url, { method, headers, body: payload });
    const text = await res.text();
    let json = null;
    if (text) {
      try { json = JSON.parse(text); } catch { json = null; }
    }
    if (!res.ok) {
      const detail = (json && json.error && json.error.message) || text.slice(0, 300) || res.statusText || '';
      const err = new Error(`Sheets API ${method} ${url} failed with ${res.status}${detail ? `: ${detail}` : ''}`);
      err.status = res.status;
      throw err;
    }
    return json === null ? {} : json;
  }

  const base = () => `${SHEETS_API}/${encodeURIComponent(resolve().sheetId)}`;

  // Every method is async so a missing-config error always surfaces as a rejection, never as a
  // synchronous throw, whichever way the caller awaits it.
  return {
    get sheetId() { return resolve().sheetId; },
    request,
    // values.get on a range -> { range, majorDimension, values? }
    async getValues(range) {
      return request('GET', valuesUrl(resolve().sheetId, range));
    },
    // values.batchGet: several ranges in one request (one read against the quota) -> { valueRanges }
    async batchGetValues(ranges) {
      const url = new URL(`${base()}/values:batchGet`);
      for (const r of ranges) url.searchParams.append('ranges', r);
      return request('GET', url.toString());
    },
    // values.append, RAW + INSERT_ROWS
    async appendValues(range, rows) {
      const url = valuesUrl(resolve().sheetId, range, { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' }, ':append');
      return request('POST', url, { values: rows });
    },
    // values.update, RAW
    async updateValues(range, rows) {
      const url = valuesUrl(resolve().sheetId, range, { valueInputOption: 'RAW' });
      return request('PUT', url, { range, majorDimension: 'ROWS', values: rows });
    },
    // values.batchUpdate, RAW; data = [{ range, values }]
    async batchUpdateValues(data) {
      return request('POST', `${base()}/values:batchUpdate`, { valueInputOption: 'RAW', data });
    },
    // spreadsheets.get, optionally with a fields mask
    async getSpreadsheet(fields) {
      const url = new URL(base());
      if (fields) url.searchParams.set('fields', fields);
      return request('GET', url.toString());
    },
    // spreadsheets.batchUpdate (addSheet, setDataValidation, ...)
    async batchUpdate(requests) {
      return request('POST', `${base()}:batchUpdate`, { requests });
    },
  };
}
