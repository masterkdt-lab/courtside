# Courtside Travel Co. — the Concept 02 site and The Spanish Offseason

The Concept 02 launch design (a hash-routed, single-page site) in front of the Google Sheet that holds invite codes, week availability, every trip request, the waitlist and host applications. A guest enters the code Katie gave them at `#/invite`, reads the Spain trip at `#/trip`, sends a private-group or group-match request from `#/request`, joins the waitlist at `#/waitlist`, or applies to host at `#/application`. The site is plain HTML, CSS and JavaScript with a handful of Vercel functions; there is no database, no accounts and no payments.

Pages:

| URL | File | What it is |
| --- | --- | --- |
| `/` (+ `#/…` routes) | `public/index.html` | The Concept 02 SPA: `app.js` renders every route (`#/trip`, `#/invite`, `#/request`, `#/waitlist`, `#/application`, `#/apply`, …) into this one page. |
| `/privacy` | `public/privacy.html` | The privacy notice (kept from the previous site, with its `style.css` + `marketing.css`). |
| `/invite`, `/?invite=CODE`, `/?code=CODE`, `/site` | redirects | Old links: `middleware.js` (and the dev server) send them into the SPA, see "Concept 02 frontend". |
| anything else | `public/404.html` | The 404 page, served with status 404 by the dev server and by Vercel. |

- `public/` is everything the browser can load: the SPA (`index.html`, `styles.css`, `v2.css`, `pages.js`, `app.js`, `assets/`, `fonts/`), the privacy page and its two stylesheets, `404.html`, `robots.txt`, `favicon.svg`, and `js/trips.js` (the trip lineup the server reads; the SPA does not load it).
- `api/` holds the nine server routes. `lib/` holds the shared code. `middleware.js` redirects the old page URLs into the SPA.
- `scripts/dev-server.js` runs the whole thing locally with no accounts. `scripts/setup-sheet.js` prepares the Google Sheet. The image scripts (`make-images.js`, `make-season-images.js`, `review-screenshots.js`) belong to the previous frontend and are not used by Concept 02.

## Run it locally

Node 20 or newer. On this machine Node is in `~/.local/bin`.

```bash
export PATH="$HOME/.local/bin:$PATH" && cd ~/Desktop/courtside && npm install && npm run dev
```

Open http://localhost:3000. No `.env` is needed: the server runs in mock mode (a JSON file instead of the Sheet) and prints emails to the terminal instead of sending them.

Test invite codes in mock mode:

| Code | What it does |
| --- | --- |
| `GUEST1` | Issued to "Ana Guest" with a guest email. Opens `#/trip`; a request sent while this cookie is present carries `invite_code` GUEST1. |
| `COURTSIDE` | Shared code with no guest email. |
| `PAUSED1` | Shows the "paused" message. |
| `ONCE1` | Works once, then shows "already been used". |

A personal link looks like `http://localhost:3000/#/invite?code=GUEST1`: the gate prefills the code and submits it. The older forms, `http://localhost:3000/invite?invite=GUEST1` and `http://localhost:3000/?invite=GUEST1`, still work: the server redirects them to that hash route.

Mock data lives in `.data/mock.json` (created on first use from `tests/fixtures/seed.json`, ignored by git). To close a week or the trip while testing, set its `status` to `closed` in that file; `/api/lineup` picks it up within a minute (or restart the server) and `/api/inquiry` sees it at once. Delete the file to reset everything. Rate limits and the double-submit guards are in memory; restarting clears them.

## Tests

```bash
export PATH="$HOME/.local/bin:$PATH" && cd ~/Desktop/courtside && npm test
export PATH="$HOME/.local/bin:$PATH" && cd ~/Desktop/courtside && npm run test:e2e
```

`npm test` runs the store, validation, API (`/api/code`, `/api/session`, `/api/trips`, `/api/request`, `/api/lineup`, `/api/inquiry`, `/api/waitlist`, `/api/application`, `/api/event`), middleware and dev-server suites in mock mode with no network. `npm run test:e2e` starts a dev server on a free port with a temp mock file and drives the Concept 02 SPA over HTTP and in headless Chromium (Playwright; `npx playwright install chromium` once), checking that each wired form appends its row. It expects no `.env` in the repo.

## Concept 02 frontend

`CONCEPT02_PLAN.md` is the contract this was built to; `concept02/CLAUDE_SHEETS_PROMPT.md` is KC's brief and `concept02/FORMS_AND_FLOWS.md` describes the site as received.

**The SPA.** `public/index.html` loads `styles.css`, `v2.css`, `fonts/fonts.css` (nine woff2 files), `pages.js` and `app.js`; the eight photos are in `public/assets/`. Every route is a hash (`#/trip`, `#/invite`, `#/request`, `#/waitlist`, `#/application`, …) rendered client-side by `app.js`. The head carries `noindex,nofollow`, the favicon, the apple-touch-icon and the Open Graph tags (`assets/og/home.jpg`); nothing is requested from a third party. Drafts and the local-only demos live in `localStorage` under `courtside-concept-v2`.

**What writes to the Sheet** (every write goes through a server route; the browser never sees credentials):

| Route in the SPA | Server route | Sheet tab |
| --- | --- | --- |
| `#/invite` | `POST /api/code` (unchanged) | Invites (`uses`, `last_used_at`) + Log |
| `#/request` step 1 | `GET /api/lineup` (new, public, cached 60 s) | reads Trips + Weeks |
| `#/request` final step | `POST /api/inquiry` (new) | Requests + Log (`inquiry_submit`) + Katie's email |
| `#/waitlist`, home "Keep me posted" | `POST /api/waitlist` with `source` `concept02-waitlist` / `concept02-home` and `interest` (new sources) | Waitlist + Log (`waitlist_submit`) |
| `#/application` | `POST /api/application` (new) | HostApplications (new tab) + Log (`application_submit`) |

- `GET /api/lineup` returns `{ trip: { tripId, name, status, closedMessage } | null, weeks: [{ weekId, label, start, end, status, closedMessage }] }` for the `spain` row and its weeks. Closed weeks are shown disabled with their `closedMessage`; the "I'm flexible" option sends `["flexible"]`.
- `POST /api/inquiry` takes `{ path: "group"|"match", weeks, players, partners, party, level, tennis, name, email, notes, consent: true, website: "" }`, checks the trip and the chosen weeks fresh (`409 trip_closed` / `409 week_closed` with a `message` to show), and writes one Requests row: `request_type` `private` for a group, `vetted` for a match; `weeks` as the lineup labels or `Flexible`; `guest_name`/`guest_email` from the form (`guest_mobile` blank); `players`, `partners`, `tennis`, `party_type`, `level`, `note` from the matching fields; `brief` a plain-text summary of every answer; `invite_code`/`invited_by` from the `cs_session` cookie when the guest came through `#/invite`, blank otherwise; `status` `New`. The builder-only columns (`room`, `single_rooms`, `addons`, `tennis_style`, `travel_style`, `priorities`, the three estimates) are blank. Rate limit 5 per 10 minutes per IP (shared with `/api/request`), honeypot, and the same email + weeks within 60 s returns the first request's id.
- `POST /api/waitlist` with a Concept 02 source needs `interest` (one of `Spain with Katie + Eva`, `Katie’s future trips`, `Future Courtside experiences`, `Mallorca · future idea`, `Charleston · future idea`) instead of `tripId`; the Spain, Mallorca and Charleston interests write that trip's name from `js/trips.js`, the other two write the interest text. `card` and `footer` work as before.
- `POST /api/application` takes `{ name, email, club, referral?, background, community, destination, consent: true, website: "" }` and appends `{ timestamp, name, email, club, referral, background, community, destination }` to HostApplications. Rate limit 3 per 10 minutes per IP, honeypot, same email within 60 s is one row.
- The group, trip-home, concierge, proposal and payment flows stay local-only (`localStorage`); they are demos. The host-desk, operations and guide views render only with `localStorage['courtside-demo'] = '1'` or a `demo=1` hash query (which sets it); otherwise those routes show the home page.
- Legacy links: `/?invite=CODE`, `/?code=CODE`, `/invite?invite=CODE` and `/invite?code=CODE` → `302 /#/invite?code=CODE`; a bare `/invite` → `/#/invite`; `/site` and `/site.html` → `/#/trip`. `middleware.js` does this on Vercel (matcher `/`, `/invite`, `/site`, `/site.html`) and `scripts/dev-server.js` does the same locally. The invite cookie no longer gates any page; the trip page is public.
- `npm run setup-sheet` adds the `HostApplications` tab (headers only, no dropdowns, no seed) to a Sheet set up before it existed and changes nothing else.

**Fonts.** `public/fonts/` holds the Concept 02 woff2 files the SPA uses (`fonts.css`) and, still, the `*-Trial.otf` files the previous design used for local preview; `privacy.html`'s `style.css` references the trial fonts. Buy the licences or remove the trial files before launch; `public/fonts/README.md` has the detail.

## Going live: what KC sets up

Everything below is needed only for production. Nothing in the repo contains a secret.

### 1. Google Sheet and service account

1. In Katie's Google Workspace, create a blank Google Sheet. The ID is the long string in its URL between `/d/` and `/edit`.
2. In Google Cloud Console, create a project (or reuse one), enable the **Google Sheets API**, then create a **service account**. Create a JSON key for it and download it.
3. Share the Sheet with the service account's email address as **Editor**.
4. Copy `.env.example` to `.env` and fill in `SHEET_ID` and `SHEET_URL` from the Sheet's link, and set `DATA_BACKEND=sheets`. Then import the key without pasting it:

```bash
export PATH="$HOME/.local/bin:$PATH" && cd ~/Desktop/courtside && node scripts/set-private-key.js ~/Downloads/<the downloaded key>.json
```

   That writes `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_PRIVATE_KEY` into `.env` and prints only a length and a markers check. If the project lives in a Google Cloud organization created after May 2024, key creation is blocked by the `iam.managed.disableServiceAccountKeyCreation` policy until an Organization Policy Administrator overrides it to Off on the project.
5. Run the setup script. It creates the seven tabs, writes the header rows, adds the dropdowns, seeds the trip and the seven weeks, and prints an example invite row. It is safe to run again, including on a Sheet set up before the Waitlist or HostApplications tab existed: it adds the missing tab with its headers and changes nothing else.

```bash
export PATH="$HOME/.local/bin:$PATH" && cd ~/Desktop/courtside && npm run setup-sheet
```

### 2. Email (Resend)

1. Create a Resend account, add and verify the sending domain, and create an API key.
2. In `.env` and in Vercel: `EMAIL_MODE=resend`, `EMAIL_API_KEY`, `FROM_EMAIL` (an address on the verified domain), `NOTIFY_EMAILS` (Katie's address, comma-separated if more than one).

### 3. Vercel

1. Create a Vercel project from this repo. Framework preset **Other**, no build command, leave the output directory default (Vercel serves `public/`). Node 20 or 22.
2. Add every variable from `.env.example` in the project's Environment Variables. `COOKIE_SECRET` must be a long random string. Without it the server falls back to a development default that is public in this repo, which would let anyone forge the cookie.
3. Deploy a preview first (`vercel`, never `--prod` until KC says so), then attach the domain.
4. The Open Graph URLs in the two page heads (`public/index.html`, `public/privacy.html`) point at the preview host until the real domain lands. Swap them when it does.

Routing is `vercel.json` (`cleanUrls`, so `public/privacy.html` is `/privacy`) plus `middleware.js`, which runs on `/`, `/invite`, `/site` and `/site.html` only and redirects the old page URLs and personal links into the SPA's hash routes (see "Concept 02 frontend"). The middleware shape and the matcher follow the Vercel docs; the first preview deploy should confirm the redirects, in particular that the `#/invite?code=…` fragment survives the 302.

### 4. Invite codes and personal links

Katie adds one row per guest to the **Invites** tab:

| column | value |
| --- | --- |
| `code` | Short, memorable, letters and digits. Matched case-insensitively. |
| `issued_to` | The guest's name. Shown as "Requesting as …" and used in emails. |
| `guest_email` | Where the confirmation goes. Leave blank and the guest gets no email. |
| `guest_mobile` | Optional. Copied onto each request. |
| `invited_by` | Usually `Katie`. |
| `max_uses` | Blank for unlimited, or a number of gate entries. |
| `uses`, `last_used_at` | Filled by the site. |
| `status` | `active`, `paused` or `revoked`. |
| `created_at` | Any date, for Katie's reference. |

The personal link for a code is `https://<domain>/#/invite?code=CODE`. It fills the code in and enters automatically. Links in the older forms, `https://<domain>/invite?invite=CODE` and `https://<domain>/?invite=CODE`, still work: the server redirects them to that hash route.

### 5. Privacy notice

`public/privacy.html` is a clearly marked placeholder that describes what the site actually stores. Replace the wording before launch; it now also needs to mention host applications.

### 6. Images

The eight photos in `public/assets/` came with the Concept 02 design. Run `node scripts/strip-exif.js public/assets/<photo>.jpg` on any photo before adding it; nothing else is generated from them.

## The Sheet

| Tab | Columns |
| --- | --- |
| Trips | `trip_id, name, status, closed_message` |
| Weeks | `week_id, trip_id, label, start_date, end_date, status, closed_message` |
| Requests | `request_id, submitted_at, trip_id, request_type, weeks, guest_name, guest_email, guest_mobile, players, partners, room, single_rooms, tennis, addons, party_type, level, tennis_style, travel_style, priorities, note, player_estimate, partner_estimate, group_estimate, brief, invite_code, invited_by, status, owner, internal_notes` |
| Invites | `code, issued_to, guest_email, guest_mobile, invited_by, max_uses, uses, status, created_at, last_used_at` |
| Log | `time, code, result, ip_hash` |
| Waitlist | `timestamp, email, name, trip, source` |
| HostApplications | `timestamp, name, email, club, referral, background, community, destination` |

How Katie uses it:

- **Close a week**: set its `status` on the Weeks tab to `closed`. Within a minute the week is shown disabled on `#/request` with that row's `closed_message`, and the server refuses requests for it at once. Set the Spain row on Trips to `closed` to stop all requests; the form shows that row's `closed_message`.
- **Work a request**: each request is one row on Requests with `status` starting at `New` (dropdown: New, In conversation, Confirmed, Waitlist, Declined), plus `owner` and `internal_notes` for her own use. Concept 02 requests have `request_type` `private` (a group) or `vetted` (a match), the guest's `guest_name` and `guest_email` from the form, `players`/`partners`/`tennis` or `party_type`/`level`/`tennis`, `note`, and a `brief` that repeats every answer in plain text (it starts `CONCEPT 02 REQUEST`). `invite_code` and `invited_by` are filled when the guest came in through `#/invite`. The builder-only columns stay blank.
- **Read the waitlist**: each sign-up is one row on Waitlist: when (`timestamp`, UTC), `email`, `name` (blank when not given), `trip` and `source`. From the Concept 02 site, `source` is `concept02-waitlist` (the `#/waitlist` page) or `concept02-home` (the home "Keep me posted" form) and `trip` is the trip name for the Spain, Mallorca and Charleston interests or the interest text itself (`Katie’s future trips`, `Future Courtside experiences`). Rows from the previous site have `source` `card` or `footer`. The same email can appear once per trip. The site sends no email for a waitlist sign-up.
- **Read host applications**: each `#/application` submission is one row on HostApplications with the time and every form field; `referral` may be blank. No email is sent for an application.
- **Read the Log**: one row per event, `code` says what happened and `result` the outcome: an invite code with `ok`, `invalid`, `paused`, `used_up`, `missing_code` or `rate_limited` (from the gate); `inquiry_submit` with the request id; `waitlist_submit` with the trip id (or the interest text); `application_submit` with `ok`; `no_code_click` and `trip_card_open` from the previous site. `ip_hash` is a 16-character hash of the visitor's IP, never the IP itself.
- The site only appends to Requests, Waitlist, HostApplications and Log, and updates `uses` and `last_used_at` on Invites. It never edits anything else, so the other columns are safe to use freely.

## Who is making the request

On the Concept 02 site the guest types their name and email in the request form, so `guest_name` and `guest_email` come from the form and `guest_mobile` is blank. The invite code is optional for a request (the trip page is public); when the guest did enter one, `invite_code` and `invited_by` are copied from the cookie so Katie can see who sent them. No confirmation email goes to the guest yet; Katie's notification does (log mode until Resend is configured).

The previous flow, `POST /api/request`, still exists for the old builder: there the identity came from the invite row (see the `IDENTITY:` comment at the top of `api/request.js`). Nothing in the Concept 02 site calls it.

## How it fits together

- `POST /api/code` checks the invite in the Sheet, records the use, and sets a signed `cs_session` cookie (30 days, HttpOnly). The code is never in the page source.
- `GET /api/lineup` (public) returns the Spain trip and its weeks for `#/request`, cached for 60 seconds. `GET /api/session` and `GET /api/trips` (cookie required) remain for anything that still calls them.
- `POST /api/inquiry` validates the `#/request` answers, re-checks that the trip and the chosen weeks are open (fresh, never from the cache), appends the Requests row, writes an `inquiry_submit` Log row and sends Katie's notification. An identical email + weeks within 60 seconds returns the first request's id instead of a second row.
- `POST /api/request` is the previous builder's route (cookie required); it is unchanged and unused by the SPA.
- Pausing or revoking a code in the Sheet blocks new sign-ins right away. A request does not need the cookie, so a paused code only stops the gate.
- `POST /api/waitlist` takes `{ email, name?, tripId | interest, source, consent: true, website: "" }`, no cookie needed. It validates, lower-cases the email, appends one Waitlist row with the trip's name (or the interest text), and writes a `waitlist_submit` Log row. Answers `200 { ok:true }`, `400 { ok:false, errors:{ field: message } }`, `429 { ok:false, reason:"rate_limited" }` or `500 { ok:false, reason:"server_error" }`. The same email and trip within 60 seconds is answered `200` again without a second row.
- `POST /api/application` takes the host form, appends one HostApplications row and writes an `application_submit` Log row; the same answers as the waitlist.
- `POST /api/event` takes `{ name, detail }` sent with `navigator.sendBeacon`, accepts `no_code_click` and `trip_card_open`, writes one Log row and answers `204`. The Concept 02 site does not send events today.
- Every POST route answers `400` with `{ errors: { field: "A complete sentence." } }`, so the SPA can show the messages as they are; `409` carries a `message` to show; `429` and `500` carry a `reason`.
- Rate limits per IP per 10 minutes, kept in memory per server instance: 10 code attempts, 5 request posts (`/api/request` and `/api/inquiry` together), 5 waitlist sign-ups, 3 host applications, 60 events. A hidden honeypot field (`website`, must be empty) drops bots silently on every form route. Every code attempt, request, waitlist sign-up and application is logged to the Log tab with a hashed IP; there is no third-party analytics and personal data goes only to the Sheet.
- No page needs the cookie. The SPA calls `/api/code`, `/api/lineup`, `/api/inquiry`, `/api/waitlist` and `/api/application`, all same-origin JSON.
- Only `public/` is served statically. `lib/`, `tests/` and this file are not reachable from the browser. The dev server serves clean URLs only (`/privacy`, not `/privacy.html`), and any unknown path gets `public/404.html` with status 404 (API misses stay JSON: `404 { ok:false, reason:"not_found" }`).

## Next steps (out of scope for the Concept 02 integration)

- Square deposits and balances, Mailchimp, GA4 conversion tracking, automated receipts and reminders, and the bookings/payments ledger and dashboard (KC's brief).
- A guest confirmation email for `/api/inquiry` (the template `confirmGuest` in `lib/email.js` exists; the route sends Katie's notification only).
- Wiring the local-only group, trip-home, concierge, proposal and payment demos to the Sheet, if they are kept.
- A second bookable trip; the Trips and Weeks tabs already carry `trip_id`, and `/api/lineup` filters on `spain` today.
