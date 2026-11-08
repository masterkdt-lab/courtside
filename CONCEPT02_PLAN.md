# Concept 02 frontend → existing Sheets backend (branch `concept-02-frontend`)

Authority: `concept02/CLAUDE_SHEETS_PROMPT.md` (KC, 2026-11-08). This file fixes the contracts the two build agents share. Read it in full, then the prompt, then `concept02/FORMS_AND_FLOWS.md`.

## Ground rules (from the prompt)
- Reuse the existing Sheets connection, service account, env vars and Vercel project. Never expose credentials to the browser; every write goes through a server route.
- Keep the Concept 02 design pixel-identical except where a form needs a loading, success or error state, a consent line, or copy that stops claiming "demo / nothing is sent".
- Don't rename or reorder existing Sheet columns. New tab `HostApplications` only.
- Respect `Trips` and `Weeks` open/closed status. Week options are driven by `Weeks`.
- Preview deploy only (`vercel`, never `--prod`); no domains, no DNS.
- Group, trip-home, concierge, proposal and payment flows stay local-only (localStorage), labelled as demos in the summary.

## Files
- The SPA lives at `concept02/site/` (as received) and moves to `public/` as the public frontend: `public/index.html`, `public/styles.css`, `public/v2.css`, `public/pages.js`, `public/app.js`, `public/assets/*` (the eight Concept 02 images), `public/fonts/*` (its nine woff2 + `fonts.css`).
- Old frontend files are removed from `public/` on this branch except: `public/privacy.html` (+ `style.css`, `marketing.css` and the derived logo files it references), `public/404.html` (links updated to `/` and `/#/invite`), `public/robots.txt`, `public/favicon.svg`, `public/assets/og/*` and `public/assets/icons/*` (reused in the SPA head), and `public/js/trips.js` (imported server-side by `lib/lineup.js`; keep it where it is).
- `api/`, `lib/`, `scripts/`, `middleware.js`, `vercel.json`, `.vercel/` stay. Tests under `tests/` that exercised the old pages are deleted or rewritten (see Tests).

## Server contracts (platform agent builds; frontend agent calls)

### `POST /api/code` (exists, unchanged)
Body `{ code }`. 200 `{ ok:true, invitedBy, issuedTo }` + `Set-Cookie cs_session`; 400 `missing_code`; 401 `{ reason: "invalid" | "paused" | "used_up" }`; 429 `rate_limited`.

### `GET /api/lineup` (new, public, cached 60 s like `/api/trips`)
200 `{ trip: { tripId:"spain", name, status, closedMessage }, weeks: [{ weekId, label, start, end, status, closedMessage }] }` from `listTrips`/`listWeeks`. No cookie. Read-only.

### `POST /api/inquiry` (new; the `#/request` final step)
Body:
```
{ path: "group" | "match",
  weeks: ["w1", ...] | ["flexible"],   // week ids from /api/lineup, or the single value "flexible"
  players: "" | "4".."12",             // group only; "" when "Not sure yet"
  partners: "" | "0".."6",             // group only; "" when "Not sure yet"
  party: "" | "Solo" | "Couple" | "2–3 friends",       // match only
  level: "" | "2.5" | "3.0" | "3.5" | "4.0" | "4.5" | "5.0+",  // match only; "" when "Not sure yet"
  tennis: "Help us decide" | "A few relaxed mornings" | "Four mornings" | "Daily tennis" | "As much as possible",
  name, email, notes, consent: true, website: "" }
```
Order: rate limit (bucket `request`, 5 per 10 min per IP hash) → honeypot (filled → 200 with a fake `requestId`, nothing written) → validation → fresh `listTrips`/`listWeeks`: trip `spain` not `open` → 409 `{ reason:"trip_closed", message }`; any chosen week not `open` → 409 `{ reason:"week_closed", weeks:[ids], message }` → double submit (same email + weeks within 60 s → the first response again) → write.
Row for `appendRequest` (camelCase keys of the 29 Requests columns, in this mapping):
- `requestId` = `requestId()` (`CS-` + 8), `submittedAt` = ISO now, `tripId` = `spain`, `requestType` = `private` for `group`, `vetted` for `match` (the existing dropdown values), `weeks` = labels from the lineup joined `", "`, or `Flexible`.
- `guestName` = name, `guestEmail` = email (lower-cased), `guestMobile` = "".
- `players`, `partners` = the numbers or "" ; `partyType` = party; `level` = level; `tennis` = the rhythm text; `room`, `singleRooms`, `addons`, `tennisStyle`, `travelStyle`, `priorities`, `playerEstimate`, `partnerEstimate`, `groupEstimate` = "".
- `note` = notes (≤ 2000). `brief` = a plain-text summary: "CONCEPT 02 REQUEST · {Private group | Group match}\nTrip: The Spanish Offseason (Spain with Katie + Eva)\nWeeks: …\nPlayers: … (Not sure yet when blank)\nPartners: …\nParty: …\nTennis level: …\nTennis rhythm: …\nName: …\nEmail: …\nNotes: …\nShown price: From $2,995 / player (concept pricing)\nSubmitted from: #/request (Concept 02)".
- `inviteCode`, `invitedBy` = from a valid `cs_session` cookie when present, else "". The cookie is optional: the trip page is public.
- `status` = `New`, `owner` = "", `internalNotes` = "".
Responses: 200 `{ ok:true, requestId }`; 400 `{ ok:false, errors:{ field: message } }` (complete sentences); 409 as above; 429; 500 `server_error`. Also write a Log row `{ code:"inquiry_submit", result:<requestId> }` best effort. Send the existing Katie notification email through `lib/email.js` (log mode in every environment today) if the template fits with blanks; otherwise skip and say so.

### `POST /api/waitlist` (exists; extended)
Accepts, in addition to the current body, `source: "concept02-waitlist" | "concept02-home"` and `interest` (one of: `Spain with Katie + Eva`, `Katie’s future trips`, `Future Courtside experiences`, `Mallorca · future idea`, `Charleston · future idea`). For those two sources `tripId` is optional: `trip` is derived from `interest`: Spain → the Spain trip name from `trips.js`, Mallorca → the Mallorca trip name, Charleston → the Charleston trip name, the other two → the interest text itself. `consent: true` stays required; honeypot and rate limit unchanged. Row `{ timestamp, email, name, trip, source }`; Log row `waitlist_submit`.

### `POST /api/application` (new; the `#/application` form)
Body `{ name, email, club, referral, background, community, destination, consent: true, website: "" }`. Required: name (≤120), email (shape, ≤254), club (≤200), background (≤4000), community (≤4000), destination (≤200); referral optional (≤200). Rate limit bucket `application`, 3 per 10 min; honeypot. Writes `HostApplications` row `{ timestamp (ISO), name, email, club, referral, background, community, destination }` via a new store method `appendHostApplication(row)` (mock + Sheets + columns), and a Log row `application_submit`. 200 `{ ok:true }`, 400 errors, 429, 500. `scripts/setup-sheet.js` adds the tab (headers only) idempotently; `tests/fixtures/seed.json` gets `host_applications: []`.

### Routing
- `middleware.js` matcher `['/', '/invite', '/site', '/site.html']`: `/` or `/invite` with `invite` or `code` in the query → 302 `/#/invite?code=<value>`; `/site` and `/site.html` → 302 `/#/trip`; otherwise `next()`.
- `scripts/dev-server.js`: pages `/` → `index.html`, `/privacy` → `privacy.html`; files `/styles.css`, `/v2.css`, `/pages.js`, `/app.js`, `/style.css`, `/marketing.css`, `/robots.txt`, `/favicon.svg`; dirs `/assets/`, `/fonts/`, `/js/`; the same redirects as the middleware; unknown path → `404.html` with 404; `/api/*` dispatch unchanged (new files are picked up).

## Frontend contracts (frontend agent builds)
- Every fetch is same-origin JSON: `fetch('/api/…', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(payload) })`. Errors: 400 → join `errors` values; 401 on invite → map reason to copy; 409 → show `message`; 429 → "Too many attempts. Try again in a few minutes."; network/5xx → "Couldn't reach Courtside. Try again."
- Loading: the submit button is disabled and its label becomes "Sending…" (or "Checking…" on the invite); success screens (`receipt`/`match-home`, `waitlist-done`, `application-done`, `trip`) render only after 200.
- `#/invite`: `POST /api/code`; `?code=` in the hash query prefills and auto-submits; keep "Request one here" → `#/waitlist`. Remove the "Sample code: JEFF" line.
- `#/request`: step 1 options from `GET /api/lineup` (labels, closed weeks disabled with their `closedMessage`), plus the "I'm flexible" option (`flexible`); step 4's "I understand this is a simulated request." becomes the consent line "I'm happy for Courtside to keep these details to prepare a proposal." linking `/privacy`; "Send demo request" → "Send request". The group path's local "demo group" modal and `completeGroupInquiry` keep running after a 200 (local group tools stay), but the receipt copy must not say demo. The match path keeps `state.match` locally after a 200.
- `#/waitlist` and the home "Keep me posted" form → `POST /api/waitlist` with `source` `concept02-waitlist` / `concept02-home`, `interest` (home: "Future Courtside experiences"), a consent checkbox, honeypot; "Save demo interest" → "Keep me posted"; `waitlist-done` copy stops saying nothing was sent.
- `#/application` → `POST /api/application` with consent and honeypot; "Send demo application" → "Send application"; `application-done` loses the host-desk/operations links (replaced by "Explore Spain" and "Home").
- Prototype bar removed from `index.html`. Routes `host-desk`, `operations`, `guide`, `operations/request/*` render only when `localStorage['courtside-demo'] === '1'` or the hash query has `demo=1` (which sets it); otherwise they render the home page. Links to them in public copy (`apply` hero "Preview a host's view", mobile nav items for group/trip-home stay) are removed or pointed at `#/apply`.
- Head: keep Concept 02's title/description/theme; add `<meta name="robots" content="noindex,nofollow">`, the existing `/favicon.svg`, apple-touch-icon and the OG tags (reuse `/assets/og/home.jpg`).
- No new external requests. `localStorage` stays for drafts and the local demos.

## Tests
- Unit (`npm test`): new `tests/api.inquiry.test.js`, `tests/api.application.test.js`, `tests/api.lineup.test.js`, waitlist extensions in `tests/api.waitlist.test.js`, store and setup-sheet additions, dev-server map and redirects, middleware redirects. `tests/api.catalog.test.js` is retired (it parsed the old pages). Everything green.
- E2E (`npm run test:e2e`): the old suites (`public`, `polish`, `browser`, `http`) targeted the old pages and are deleted; one new `tests/e2e/concept02.test.js` in mock mode: invite with `GUEST1` sets the cookie and lands on `#/trip`; a bogus code lands on `#/invite-unavailable`; a group request and a match request each append one Requests row with the mapped columns; the waitlist form and the home form each append one Waitlist row; the application appends one HostApplications row; the prototype bar is absent; `#/host-desk` without the flag shows home; no console errors.

## Verification on the preview (orchestrator, after KC adds the two preview secrets)
One submission per wired form with name `TEST – Claude` and email `kc@nextwave.bet`; read the rows back; report tab, row number and the field-to-column mapping. Never delete rows.
