// lib/request-scope.js
// One API request = one scope (node:async_hooks AsyncLocalStorage). The Sheets store keeps a
// per-request snapshot of the tabs it reads inside the scope (lib/store.sheets.js), so a request
// costs one values:batchGet against Google's 60-reads-a-minute quota however many store calls it
// makes. The scope dies with the request: nothing read here is ever served to another request, so
// guest tabs are still never stale across requests (each api file is its own Vercel function with its
// own memory, and a cache in one could not see another's writes).
//
//   withSheetScope(handler) -> handler run in a fresh scope on every call (wraps each api GET/POST)
//   runInScope(fn)          -> fn() in a fresh scope (scripts, tests)
//   currentScope()          -> the scope of the running request, or null outside one
//
// Harmless with the mock store, which never looks at the scope. Node only (API routes run on the
// Node runtime); nothing in middleware.js's import graph may import this file.

import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

// A fresh scope every time, also when called inside another one: a request never shares a snapshot.
export function runInScope(fn) {
  return storage.run({ sheets: new Map() }, fn);
}

export function currentScope() {
  return storage.getStore() || null;
}

export function withSheetScope(handler) {
  return function scoped(...args) {
    return runInScope(() => handler.apply(this, args));
  };
}
