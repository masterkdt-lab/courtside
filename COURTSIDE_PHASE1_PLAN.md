# Courtside Travel Co. — Phase 1 Build Plan (v2, amended for prototype v0.5.3)

Audience: Claude Code agents working in this repo.
Owner: KC. Source of truth for product scope: `index.html` as committed in "split prototype into files" (prototype v0.5.3, The Spanish Offseason). Do not add features that are not in it, except the ones this plan names explicitly.

This is v2 of the plan. v1 was written against an earlier two-trip prototype (Spain + Miami, simple contact form). v0.5.3 is one trip with a two-path builder and no contact form, so sections 2, 4, 5 and 8 were rewritten. The architecture, tooling, agents and waves are unchanged. Where v1 and this file disagree, this file wins.

Decisions KC made on 2026-10-05:

1. **Identity comes from the invite, not from form fields.** Katie issues one code per guest; the invite row carries the guest's name, email and mobile. The request modal collects no contact fields. Leave a clearly marked comment (see 4.7) that this can be switched to collecting name/email/mobile in the modal.
2. Open/closed is **per week**, with a trip-level switch on top.
3. The "request an invitation" route and tab from v1 are **dropped** (no entry point on the page for someone without a code). Phase 2.
4. Seed codes are the v1 three: `COURTSIDE`, `PAUSED1`, `ONCE1`, plus `GUEST1` as the example of a per-guest code.
5. Copy to leave alone: "powered by tgl.rsvp", the Jeff footnote, "Napa tennis friends".

---

## 1. Mission

Turn the static prototype into a working invitation-only site:

1. Invite codes are checked on a server against a Google Sheet.
2. Both request paths (private group, vetted group) save a row to the Sheet and email Katie and the guest.
3. Each **week** can be opened or closed for requests from the Sheet, and the whole trip can be closed.
4. The site is deployable to Vercel and contains no prototype wording.

Keep the approved design. This is wiring and cleanup, not a redesign.

## 2. What exists (from index.html as split)

Repo state at the start of Wave 0: `index.html` (gate + site in one document), `style.css`, `js/site.js`, `assets/` (7 files). Git history: "prototype as received" (the original single file), then "split prototype into files".

| Screen / element | ID or hook | Phase 1 behavior |
| --- | --- | --- |
| Invite gate | `#gate`, `#inviteForm`, `#inviteCode`, `#enterButton`, `#inviteIntro`, `.invite-hint` | Moves to its own page `index.html`; calls `POST /api/code` |
| Site shell | `#site`, `.site-header`, `main#top`, `.footer` | Moves to `site.html`; protected by the cookie guard |
| Hero CTAs, path cards | `.path-jump[data-path=private|vetted]` → `#build` | Unchanged (plain anchors) |
| Week ribbon | `#join .week-ribbon .week-chip` | Rendered from `GET /api/trips`; closed weeks tagged |
| Builder path toggle | `.path-toggle-btn[data-mode]`, `#privateFlow`, `#vettedFlow` | Unchanged; whole `#build` replaced by closed message when trip is closed |
| Private week picker | `#privateWeeks .fixed-week input[name=privateWeek]` | Rendered from API; input value becomes the week id; closed weeks disabled |
| Private builder | counters, `#roomOptions`, `#singleRooms`, `#tennisOptions`, `#addonGrid`, `#notes`, summary `#playerRange` etc. | Unchanged; pricing stays client side |
| Vetted week picker | `#vettedFlow .vetted-weeks input[type=checkbox]` | Rendered from API; values become week ids; closed weeks disabled |
| Vetted profile | `#partyType`, `#vettedLevel`, `#vettedTennisStyle`, `#travelStyle`, `.priority-grid`, `#vettedNotes` | Unchanged |
| Request buttons | `#requestBtn`, `#vettedRequestBtn` | Open the modal as now |
| Request modal | `#requestModal`, `#tripBrief`, `#copyBrief`, `#closeModal` | Gains identity line, consent checkbox, Send button, error and success states; calls `POST /api/request` |
| Source-notes strip | `.source-notes` | Removed from the page; content goes to README "Images to replace" |

Builder catalog, exactly as in the HTML and `js/site.js` (do not add, rename or reprice):

| Group | Ids / values |
| --- | --- |
| Weeks | `w1` Jan 10–16, `w2` Jan 17–23, `w3` Jan 24–30, `w4` Jan 31–Feb 6, `w5` Feb 7–13, `w6` Feb 14–20, `w7` Feb 21–27 (all 2027, Sunday–Saturday) |
| Rooms | `deluxe`, `club`, `terrace`, `junior`, `royal` |
| Tennis | `light`, `core`, `daily`, `custom` |
| Add-ons | `eva`, `padel` (per player, with qty); `massage`, `golf`, `alicante`, `cartagena`, `food`, `dinner` (per guest, with qty); `driver` (group); `free` (no cost) |
| Players | integer 4–12. Partners: integer 0–12. Single rooms: 0 to players+partners |
| Party type | `Solo`, `Couple`, `2–3 friends` |
| Level | `2.5`, `3.0`, `3.5`, `4.0`, `4.5`, `5.0+`, `Mixed / not sure` |
| Ideal tennis | `Social + fun`, `Balanced`, `Competitive / serious`, `Mostly here for the trip` |
| Travel style | `Very social`, `Balanced`, `Independent` |
| Priorities | `Great tennis`, `Food + long lunches`, `Wellness + spa`, `Golf`, `Exploring`, `Downtime` |

Trip facts to seed:

| | Spain |
| --- | --- |
| trip_id | `spain` |
| name | The Spanish Offseason |
| status | `open` |
| closed_message | Requests for The Spanish Offseason are closed. |

Weeks to seed: the seven rows above, `trip_id` `spain`, `status` `open`, `closed_message` "Requests for this week are closed."

## 3. Non-goals

No accounts, no payments, no CMS, no pricing in the Sheet, no server-side price recalculation (the estimate is a labeled "working estimate" that the server stores as sent), no database other than the Sheet, no framework migration (plain HTML/CSS/JS plus Vercel functions), no Miami, no "request an invitation" flow for people without a code.

## 4. Target architecture

```
/                      gate only (public)
/site                  the Spanish Offseason page (protected)
/privacy               privacy notice (public, placeholder wording)
/api/code              POST  validate invite code, set signed cookie
/api/session           GET   is the cookie valid? who is the guest, who invited them
/api/trips             GET   trip + week status (requires cookie)
/api/request           POST  save request, send emails (requires cookie)
```

```
repo/
  public/               the web root: everything Vercel may serve statically lives here, nothing else does
    index.html          gate only
    site.html           header + main + footer + request modal
    privacy.html
    style.css
    js/gate.js          gate logic
    js/site.js          site logic (weeks, builder, request modal)
    js/images.js        the remote image URLs, one place
    assets/
    robots.txt
  middleware.js         Vercel Routing Middleware: /site* requires valid cookie, else redirect to /
  api/code.js
  api/session.js
  api/trips.js
  api/request.js
  lib/store.js          data interface (see 4.1)
  lib/store.sheets.js   Google Sheets implementation
  lib/store.mock.js     JSON-file implementation for local dev and tests
  lib/cookie.js         HMAC sign/verify
  lib/guard.js          shared "is this request allowed into /site" check
  lib/email.js          send or log, by env
  lib/validate.js       request schema
  lib/catalog.js        the allowed ids/values from section 2 (server copy)
  lib/ratelimit.js
  lib/ids.js            request IDs
  scripts/setup-sheet.js  creates tabs, headers, dropdowns, seed rows
  scripts/dev-server.js   local server: static files + the guard + the API routes
  tests/
  package.json
  .env.example
  .gitignore
  vercel.json
  README.md
  COURTSIDE_PHASE1_PLAN.md   this file
```

### 4.0 Technical decisions (fixed, do not revisit)

- **Runtime:** Node 20+, ES modules (`"type": "module"`). No framework, no bundler, no TypeScript. On this machine Node is at `~/.local/bin/node`; run `export PATH="$HOME/.local/bin:$PATH"` before `node`/`npm`. No Homebrew, no Docker, no `gh`.
- **API handlers:** Web-standard exports, `export async function POST(request)` / `GET(request)` returning a `Response`. This is what Vercel runs and what the local server calls directly.
- **Local server:** `npm run dev` runs `scripts/dev-server.js` (plain `node:http`) on port 3000. It serves only `*.html`, `style.css`, `js/`, `assets/` and `robots.txt` with clean URLs (`/site` → `site.html`), applies the same cookie guard as `middleware.js` to `/site`, and routes `/api/*` to the handler modules. Do **not** use `vercel dev`; it needs a Vercel login and this build must run with no accounts.
- **Env:** no `dotenv` dependency. Defaults are mock + log so `npm run dev` and `npm test` work with no `.env` at all. If a `.env` exists, load it (Node's `--env-file-if-exists` or a ten-line loader in `lib/env.js`).
- **Guard logic lives once** in `lib/guard.js` and is imported by both `middleware.js` and the dev server.
- **Cookies:** `cs_session`, HttpOnly, SameSite=Lax, Path=/, Max-Age 30 days, `Secure` when not on localhost. HMAC-SHA256 with Web Crypto (`globalThis.crypto.subtle`), so the same `lib/cookie.js` runs in Vercel's edge middleware and in Node. No `node:crypto` in anything the middleware imports. Payload: `{ code, invitedBy, issuedTo, exp }`. Constant-time compare on verify.
- **vercel.json:** `cleanUrls: true`. `middleware.js` exports `config.matcher` for `/site` and `/site.html`. Check the current Vercel docs for middleware in a non-framework project before writing it (the `vercel:routing-middleware` and `vercel:vercel-functions` skills are available, as is WebFetch); otherwise follow the documented `export default function middleware(request)` shape and note it in your final message as unverified.
- **Sheets client:** `google-auth-library` plus `fetch` against the Sheets REST API (v4). `GOOGLE_PRIVATE_KEY` arrives with literal `\n`; convert to newlines before use. Only runtime dependency.
- **Email:** Resend over `fetch`, behind `lib/email.js`. No SDK. In `log` mode it prints each email as a clearly delimited block and also pushes it onto an exported `sentLog` array so tests can assert on it.
- **Trips cache:** module-level, 60-second TTL, for `GET /api/trips` only. `POST /api/request` always reads trip and week status fresh.
- **Rate limit:** best effort, in memory, per IP hash: 10 code attempts per 10 minutes, 5 request posts per 10 minutes. It resets on cold start; that is accepted for Phase 1. The honeypot and the Log tab are the backstop.
- **IP hash:** first 16 hex chars of SHA-256(ip + COOKIE_SECRET), Web Crypto.
- **Request IDs:** `CS-` plus 8 random Crockford base32 characters, generated server side.
- **Double submit:** the client disables the button, and the server returns the first request's ID for an identical invite code + request type + weeks + brief within 60 seconds (the brief carries every builder choice, so an edited request is a new row).
- **Invite status at request time:** `POST /api/request` re-reads the invite and refuses with 401 unless its status is `active`; `paused` and `revoked` both block. The `/site` guard itself only checks the cookie signature and expiry.
- **Mock store:** reads seed data from `tests/fixtures/seed.json`, writes to `.data/mock.json` (git-ignored), reads the file fresh on every call (no caching inside the store). Seed invites: `COURTSIDE` (active, unlimited, shared test code, no guest email), `GUEST1` (active, unlimited, issued_to "Ana Guest", guest_email `ana.guest@example.com`, guest_mobile `+1 555 0100`), `PAUSED1` (paused), `ONCE1` (max 1 use). `invited_by` is "Katie" for all.
- **Tests:** `node --test` for store and API tests. Browser tests with Playwright against `npm run dev`. If Playwright cannot be installed, say so in `QA_REPORT.md` and cover the same flows at HTTP level.
- **Git:** work on branch `phase-1`. Commit after each wave. Do not push.

### 4.1 Store interface (the only thing API routes may call)

```js
findInvite(code)            // -> { code, issuedTo, guestEmail, guestMobile, invitedBy, maxUses, uses, status } | null
recordInviteUse(code)       // uses += 1, last_used_at = now
logAttempt({ code, result, ipHash })
listTrips()                 // -> [{ tripId, name, status, closedMessage }]
listWeeks()                 // -> [{ weekId, tripId, label, start, end, status, closedMessage }]
appendRequest(row)          // row uses the Requests column names in camelCase -> { requestId }
```

`DATA_BACKEND=mock|sheets` picks the implementation. Everything must run and pass tests with `mock` and no credentials. Codes match case-insensitively, trimmed. `maxUses` null means unlimited.

### 4.2 The Sheet

| Tab | Columns (row 1 headers, exact) |
| --- | --- |
| Trips | `trip_id, name, status, closed_message` |
| Weeks | `week_id, trip_id, label, start_date, end_date, status, closed_message` |
| Requests | `request_id, submitted_at, trip_id, request_type, weeks, guest_name, guest_email, guest_mobile, players, partners, room, single_rooms, tennis, addons, party_type, level, tennis_style, travel_style, priorities, note, player_estimate, partner_estimate, group_estimate, brief, invite_code, invited_by, status, owner, internal_notes` |
| Invites | `code, issued_to, guest_email, guest_mobile, invited_by, max_uses, uses, status, created_at, last_used_at` |
| Log | `time, code, result, ip_hash` |

Rules:

- `Trips.status` and `Weeks.status` are `open` or `closed`. Data validation dropdown on both.
- `Requests.status` dropdown: `New, In conversation, Confirmed, Waitlist, Declined`. New rows are `New`.
- `Requests.request_type` is `private` or `vetted`. `weeks` holds the week **labels**, comma-joined ("Jan 10–16, Feb 7–13"). `addons` holds names with quantities ("Extra session with Eva ×6, Private 6-hour driver / excursion"). `priorities` is comma-joined. Columns that do not apply to the request type are left blank.
- `Invites.status`: `active, paused, revoked`. `max_uses` blank means unlimited. Katie creates one row per guest: `code`, `issued_to` (name), `guest_email`, `guest_mobile`, `invited_by`.
- The site only appends to Requests and Log, and updates `uses` and `last_used_at` on Invites. It never edits anything else.
- `scripts/setup-sheet.js` is idempotent: it creates missing tabs, writes headers, sets the dropdowns, and seeds Trips and Weeks only when those tabs are empty. It does not seed Invites; it prints an example Invites row.

### 4.3 Open / closed behavior

| Place | Open | Closed |
| --- | --- | --- |
| Week ribbon in `#join` | Chip as is | Chip greyed with a small "CLOSED" tag |
| Private week picker | Selectable | Disabled, greyed, "CLOSED" tag; if it was the default selection, the first open week is selected instead |
| Vetted week picker | Selectable | Disabled, greyed, "CLOSED" tag, cannot be checked |
| `POST /api/request` | Accepts | Rejects with 409 `week_closed` listing the closed week ids (server is the authority) |
| Trip closed, or every week closed | | The inside of `#build` is replaced by the trip's `closed_message` (or, when all weeks are closed, the week closed message) and nothing else. `POST /api/request` returns 409 `trip_closed` |

Weeks and trip are read by `GET /api/trips` with a 60-second cache so a Sheet edit shows within a minute.

### 4.4 API contracts

```
POST /api/code            { code }
  200 { ok:true, invitedBy, issuedTo }     + Set-Cookie cs_session
  400 { ok:false, reason:"missing_code" }
  401 { ok:false, reason:"invalid"|"paused"|"used_up" }
  429 { ok:false, reason:"rate_limited" }

GET  /api/session
  200 { ok:true, code, invitedBy, issuedTo } | 401 { ok:false }

GET  /api/trips           (cookie required, else 401)
  200 { trips:[{ tripId, name, status, closedMessage }],
        weeks:[{ weekId, tripId, label, start, end, status, closedMessage }] }

POST /api/request         (cookie required, else 401)
  body (private): { requestType:"private", weeks:[weekId], players, partners, room, singleRooms, tennis,
                    addons:[{ id, qty? }], note, playerEstimate, partnerEstimate, groupEstimate, brief,
                    consent:true, website:"" }
                  qty is sent only for per-player and per-guest add-ons; `driver` and `free` send { id } alone.
                  partnerEstimate is "" when partners is 0; otherwise the "$x–$y" range with no prefix text.
  body (vetted):  { requestType:"vetted", weeks:[weekId,...], partyType, level, tennisStyle, travelStyle,
                    priorities:[...], note, brief, consent:true, website:"" }
  200 { ok:true, requestId, guestEmailSent:boolean }
  400 { ok:false, errors:{ field: message } }
  409 { ok:false, reason:"trip_closed" } | { ok:false, reason:"week_closed", weeks:[weekId,...] }
  429 { ok:false, reason:"rate_limited" }
```

Validation (`lib/validate.js`, sets from `lib/catalog.js`): `requestType` in set; `weeks` non-empty, every id known, exactly one for private; private numbers are integers in range (section 2), `room`/`tennis` in set, add-on ids in set with `qty` ≥ 1 for per-player/per-guest ones; vetted values in their sets; `note` ≤ 2000 chars; `brief` ≤ 5000 chars; estimates ≤ 60 chars each; `consent` must be `true`. Strings are trimmed. Unknown fields are ignored.

The invite code, `invitedBy`, and the guest's name/email/mobile come from the cookie and a fresh `findInvite(code)` at request time, never from the request body. A filled honeypot (`website`) returns 200 with a fake-looking request ID and writes nothing.

### 4.5 Emails

- To `NOTIFY_EMAILS` on each request: request ID, type, weeks, guest name/email/mobile (or "no guest email on this invite"), invite code and invited_by, then the brief text, then a link to the Sheet (`SHEET_URL`).
- To the guest, only when the invite has a `guest_email`: short confirmation matching the on-screen copy ("You're on our list…"), with the request ID and the brief.
- `EMAIL_MODE=log` writes emails to the console instead of sending. Tests and local dev always use `log`.

### 4.6 Environment

```
DATA_BACKEND=mock
SHEET_ID=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
COOKIE_SECRET=
EMAIL_MODE=log
EMAIL_API_KEY=
FROM_EMAIL=
NOTIFY_EMAILS=
SHEET_URL=
```

`COOKIE_SECRET` has a dev default when unset so mock mode works with no `.env`; the README says it must be set in Vercel.

### 4.7 Identity note (write this comment in the code)

Put this comment, verbatim, at the top of `api/request.js` and above the modal identity line in `js/site.js`:

```
// IDENTITY: the guest's name, email and mobile come from the invite row (one code per guest,
// set by Katie in the Invites tab), not from form fields. Decision KC 2026-10-05.
// Alternative, if shared codes are wanted later: collect name/email/mobile (+ consent) in the
// request modal and validate them here; the Requests columns already exist for them.
```

## 5. Front-end changes

Wave 1 (before the API exists): steps 1 and 9–14. Wave 3 (against the running local server): steps 2–8.

1. Split `index.html` into gate (`index.html`: head, `#gate` section, `js/gate.js`) and site (`site.html`: head, `#site` with header, main, footer, `#requestModal`, `js/site.js`). Remove the gate-out / site-live transition logic that assumed one document; the gate instead fades out and navigates to `/site` on success. Both pages link `/style.css`.
2. Gate: replace the length check with `POST /api/code`. Add `#inviteMessage` (reuse `.invite-hint` styling) with states: idle ("Your code is in your invitation from Katie."), checking, invalid, paused, used up, rate limited, network error; success shows "Welcome, {issuedTo}." (or "Invitation found." when issuedTo is blank), then fades and goes to `/site`. Disable `#enterButton` while checking. Remove `value="SPAIN27"` and the `localStorage` write.
3. Support `/?invite=CODE` (and `/?code=CODE` as an alias): prefill, add the existing `recognized-invite` state, and submit automatically. On failure remove the state so the input and error are visible. Ignore any `guest` query param; the name comes from the API.
4. Site start: `GET /api/session`; on 401 go to `/`; keep `issuedTo`, `invitedBy`, `code` for the modal. Then `GET /api/trips`.
5. Render the week ribbon, the private week picker and the vetted week picker from the `weeks` array (input values are week ids, labels from the API; the static seven in the markup are the pre-load fallback). Apply section 4.3. Keep the existing `data-mode`, `data-path`, `data-counter`, `.option`, `.addon` hooks and all pricing code.
6. Request modal: identity line "Requesting as {issuedTo} · invited by {invitedBy}" (fallback "Requesting with code {code}"), the brief as now, a required consent checkbox linking to `/privacy`, a hidden honeypot field named `website`, buttons "Send to Katie" (primary), "Copy trip brief", "Close". Build the body per 4.4 from the builder state. Disable Send while sending. Show 400 messages in one error line, 409 as "Requests for {week label} are closed." (then refresh weeks), 429 and network errors in plain words.
7. Success: replace the modal body with eyebrow "Request received", heading "You're on our list.", a line with the request ID and that Katie reviews each request personally, and, when `guestEmailSent` is true, "A confirmation email is on its way to {guestEmail}." (the API does not return the address; use the wording "to the email on your invitation"). Close button only. Render only after a 200.
8. Hide nothing else; there is no profile button in v0.5.3.
9. Remove prototype wording: the meta description ("…prototype…"), the `.invite-hint` sentence ("Prototype code: SPAIN27 · personal invitation links can bypass this field in production."), the summary note asterisk sentence ("*Add-on prices are working prototype estimates." → "*Add-on prices are working estimates."), the whole `.source-notes` strip, the modal eyebrow "Prototype request" and the paragraph "This prototype doesn't submit to a backend yet…". Rename `v05-styles` / `v05-builder` identifiers. Afterwards `grep -ri prototype` over served files must return nothing (this plan file and README are not served).
10. Add `<meta name="robots" content="noindex,nofollow">` to every page and a `robots.txt` disallowing all.
11. Images: `js/images.js` exports the three remote URLs (La Finca header image, Club de Tenis Almoradí photo, La Mata Beach). `site.html` marks each `<img>` with `data-remote="…"` and the club photo element with `data-remote-bg="…"`; `js/site.js` applies them at start. Keep the existing `onerror` fallbacks to local assets. Do not download or re-host remote images; KC supplies licensed files. The seven local assets are Katie's personal photos and logos; leave them as they are.
12. `privacy.html`: same head and header styling, a clearly marked placeholder notice ("Placeholder — final wording to come from Courtside"), noindex.
13. Accessibility: `#requestModal` traps focus while open, closes on Escape, and returns focus to the button that opened it; `#site` gets `inert` while the modal is open; honor `prefers-reduced-motion` for smooth scroll and the gate/site transitions.
14. Keep the anchor navigation (`#top`, `#join`, `#week`, `#build`) as is. No hash router. `/site#build` pasted into a new tab must land on the builder after the session check.

## 6. Agents

The main Claude Code session is the **orchestrator**. It owns this plan, launches agents, merges their work, writes `README.md`, and runs the final check.

Launch each agent as a built-in general-purpose subagent. Each agent's prompt must contain (a) its row from the table below, (b) the shared rules, (c) the instruction to read this file in full first, and (d) the findings from Wave 0.

| Agent | Owns (may edit) | Job |
| --- | --- | --- |
| `repo-auditor` | nothing, read-only | Verify the split is lossless against `git show main:index.html` (CSS and JS text identical, assets byte-identical to the decoded base64). Map `js/site.js`: every handler, state, the pricing functions, how the modal is filled. Inventory `style.css` classes the new states can reuse (disabled/closed chip, error line, success state, identity line). List assets and remote URLs. Report anything that contradicts this plan. |
| `data-layer` | `lib/store*.js`, `scripts/setup-sheet.js`, `tests/store*`, `tests/fixtures/`, `package.json`, `.gitignore`, `.env.example` | Store interface, mock and Sheets implementations, `setup-sheet.js` with headers, dropdowns and the seed rows from section 2. |
| `api-builder` | `api/`, `middleware.js`, `lib/` except `store*`, `scripts/dev-server.js`, `tests/api*`, `vercel.json` | The four routes, the guard, the middleware and the local server, to the contracts in 4.4, calling the store interface only. |
| `frontend-wirer` | `public/**` (`*.html`, `style.css`, `js/`, `robots.txt`) | Everything in section 5. Minimal CSS additions, reusing existing classes. |
| `qa-verifier` | `tests/e2e*`, `QA_REPORT.md` | Starts with no knowledge of how the others worked. Runs `npm test`, starts `npm run dev` in mock mode, walks every item in section 8 and records pass or fail with evidence. Does not fix anything. |

Shared rules for every agent:

- Read this file in full before doing anything.
- Stay inside your owned paths. If you need a change elsewhere, say so in your final message instead of making it.
- Never commit secrets. Never send real email. Never deploy. Mock mode only.
- Do not change the contracts in section 4. Report a problem instead.
- Do not change the visual design or add features.
- Do not commit; the orchestrator commits after each wave.
- Final message: what you built, what you did not, what you assumed, how to run your tests.

### Waves

```
Wave 0   repo-auditor                    orchestrator reads the report and adjusts this file if needed
Wave 1   data-layer  ||  frontend-wirer  in parallel; frontend does steps 1 and 9-14 only
Wave 2   api-builder                     after Wave 1 is committed
Wave 3   frontend-wirer                  steps 2-8, against the running local server
Wave 4   qa-verifier -> orchestrator fixes -> qa-verifier again, until section 8 passes
```

Wave 1's two agents touch different files, so they run in the same working tree. Commit after each wave on `phase-1`. Do not push.

## 7. What KC provides (do not block on these)

Build and test everything in mock mode. These are only needed to go live:

- Google Sheet in Katie's Workspace, and a service account it is shared with
- Vercel project and domain
- Email provider key and sender address
- Invite codes, one per guest, with name, email and mobile
- Licensed files for the three remote images
- Privacy notice wording (ship a clearly marked placeholder)

`README.md` must give KC step-by-step setup for each, ending with `node scripts/setup-sheet.js`, plus the personal-link format (`https://<domain>/?invite=CODE`), the identity alternative from 4.7, and a Phase 2 list (pricing in the Sheet with server recalculation; request-an-invitation flow; Miami).

## 8. Done when

- [ ] `npm install && npm test` passes with `DATA_BACKEND=mock` and no credentials
- [ ] `npm run dev` serves the whole site at localhost:3000 with no accounts or keys
- [ ] A valid code opens `/site`; invalid, paused and used-up codes show distinct messages; `/?invite=GUEST1` enters without typing
- [ ] `/site` without a cookie redirects to `/`
- [ ] No invite code appears anywhere in shipped JS or HTML
- [ ] A private request appends one Requests row with every private column filled and logs two emails
- [ ] A vetted request appends one Requests row with every vetted column filled and logs two emails
- [ ] A request on a code with no guest email logs one email and the confirmation does not promise one
- [ ] Double-clicking Send creates one row
- [ ] Setting a week to `closed` greys and disables it in the ribbon and both pickers within a minute, and `POST /api/request` for it returns 409 `week_closed`
- [ ] Setting the trip to `closed` replaces the builder with the closed message and `POST /api/request` returns 409 `trip_closed`
- [ ] Back, refresh and a pasted `/site#build` link all work
- [ ] The word "prototype" appears nowhere in served files
- [ ] Every page has noindex
- [ ] Gate, page, builder and modal work at 380px width
- [ ] `README.md` covers setup, env vars, the Sheet tabs, issuing per-guest codes and personal links, "Images to replace", the identity alternative, and Phase 2

## 9. Run order for the orchestrator

1. Repo is `~/Desktop/courtside`, branch `phase-1`, with the two commits from section 2.
2. Run Wave 0. Give KC a five-line summary of the audit. Continue without waiting unless something makes a section of this plan impossible.
3. Run Waves 1 to 4 in order, committing after each.
4. Fix what `qa-verifier` finds and rerun it until every box in section 8 is ticked. If a box cannot pass after two fix rounds, stop and explain.
5. Finish with: what passed, the exact commands to run it locally, the test invite codes, and the section 7 list of what KC still has to supply.

Do not deploy, push, send email or ask for credentials at any point.

## 10. Wave 0 findings (binding clarifications)

The audit verified the split is byte-exact. These items refine sections 4 and 5; they are part of the plan.

1. **Scripts are ES modules.** `index.html` loads `<script type="module" src="/js/gate.js">`, `site.html` loads `<script type="module" src="/js/site.js">`, and `js/images.js` is an ES module imported by `site.js`. Module scripts run after parse, so keep the existing "handlers attach at load" pattern.
2. **Gate page layout.** In the standalone `index.html`, `#gate` must not be `position:fixed` (nothing to overlay, and a fixed full-screen grid cannot scroll at 380px). Make it `position:relative; min-height:100vh` in a small gate-only override; keep the two-column grid and the 1050px collapse.
3. **Site visible by default.** `#site{opacity:0}` was for the one-document fade. In `site.html` the page must be visible without JS adding `.site-live`; add `.site-live` on load or neutralise the rule.
4. **`recognized-invite` placement.** The CSS at `.recognized-invite …` only matches when the class is on `.invite-card` (the form itself is `.invite-row`). Put it on `.invite-card`.
5. **Week ids and labels.** Week inputs get `value="<weekId>"` and `data-label="<label>"`. `state.week`, `#summaryDates`, `#vettedWeekSummary`, both briefs and the modal must show labels; the API body sends ids. Default selection stays W5 (`w5`, Feb 7–13); if `w5` is closed, select the first open week and update `#summaryDates`.
6. **Closed week clicks.** The `#privateWeeks .fixed-week` click handler must ignore chips whose input is disabled. Vetted uses the native checkbox and is safe.
7. **Add-on quantities.** `driver` (group) and `free` (none) have no qty input; send `{ id }` alone (see 4.4). The server's catalog records each add-on's type: `player`, `guest`, `group`, `none`.
8. **Modal styling.** Do not reuse `.summary-note` inside the modal (it is light-on-dark text for the dark aside). Add `.primary:disabled{opacity:.55;cursor:not-allowed}`. The success-state heading keeps `id="modalTitle"` because the dialog uses `aria-labelledby`.
9. **Closed chip style.** No disabled/closed chip style exists. Add one modifier class for `.week-chip` and `.fixed-week` (reduced opacity, `cursor:not-allowed`) and a small "CLOSED" tag reusing the chip's `span` style in `--clay`.
10. **Images in one place.** Remove the `url(…)` from `.club-photo` in `style.css` (keep a background colour) so all three remote URLs live only in `js/images.js`; `site.js` sets the `<img src>`s and the club background at start.
11. **Note fields.** Add `maxlength="2000"` to `#notes` and `#vettedNotes` to match the server limit. They stay single-line inputs.
12. **Dead CSS.** When the `.source-notes` strip is removed, delete `.source-notes*` rules. Rename the `.v05-builder` selector along with the class.
13. **Prototype wording lines** (as split): `index.html` lines 9, 31, 232, 307, 310; `SPAIN27` at lines 30 and 31. Nothing in `style.css` or `js/site.js`.
14. **EXIF.** `life-eva-paella.jpg`, `life-friends-court.jpg` and `life-friends-family.jpg` carry GPS coordinates and capture dates. Do not modify them; the README must flag this under "Images to replace" so KC decides before go-live.
15. **Reduced motion.** `html{scroll-behavior:smooth}` and the gate/site transitions go behind `@media (prefers-reduced-motion: no-preference)` or are disabled under `reduce`.

## 11. Wave 2 findings (binding clarifications)

1. **Static files live in `public/`.** With the "Other" preset Vercel serves `public/` when it exists and otherwise the whole repo root, which would expose `lib/`, `tests/fixtures/seed.json` and this plan. All served files moved to `public/` after Wave 2; URLs are unchanged (`/style.css`, `/js/site.js`, `/assets/...`). `api/`, `lib/`, `middleware.js`, `scripts/`, `tests/` stay at the root. The dev server serves from `public/`.
2. **Middleware pass-through is explicit.** Vercel Routing Middleware now defaults to the Node runtime, where returning `undefined` ends the response blank. When the cookie is valid, `middleware.js` returns `new Response(null, { headers: { 'x-middleware-next': '1' } })`, which is what `next()` from `@vercel/functions` builds, without adding the dependency. Verified against the Vercel docs and package source on 2026-10-05; not yet exercised by a deploy.
3. **Catalog test.** `tests/api.catalog.test.js` parses `public/site.html` and `public/js/site.js`, so any change to add-on names, option values or week labels on the page must be mirrored in `lib/catalog.js` or the suite fails. Wave 3 must keep those strings intact.
4. **Reason strings and messages** the front end must handle: code → `missing_code | invalid | paused | used_up | rate_limited`; trips/request 401 → `unauthorized`; request 409 → `trip_closed` or `week_closed` + `weeks:[ids]`; 429 → `rate_limited`; 500 → `server_error`; 400 → `errors:{ field: message }` where `field` may be `body`, messages are complete short sentences safe to join into one line. `partnerEstimate` may be `""`; `playerEstimate` and `groupEstimate` are required for private; `website` must be `""`.
5. **`EMAIL_MODE`** values are `log` and `resend`.
