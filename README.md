# Courtside Travel Co. — public pages and The Spanish Offseason

A public homepage and a Meet the Pros page in front of an invitation-only site for The Spanish Offseason. A guest enters the code Katie gave them at the gate, sees the trip, builds a private week or applies to a vetted group, and sends the request to Katie. Invite codes, week availability and every request live in one Google Sheet. The site is plain HTML, CSS and JavaScript with a handful of Vercel functions; there is no database, no accounts and no payments.

Pages:

| URL | File | What it is |
| --- | --- | --- |
| `/` | `public/index.html` | Public homepage: the featured trip, the 2027 Founding Season cards with their waitlist forms, how it works, the pros teaser. |
| `/pros` | `public/pros.html` | Meet the Pros: one profile per pro from `public/js/pros.js`. |
| `/invite` | `public/invite.html` | The invitation gate. Enters `/site` on a valid code. |
| `/site` | `public/site.html` | The Spanish Offseason: the trip, the builder and the request modal. Needs the invite cookie. |
| `/privacy` | `public/privacy.html` | The privacy notice. |
| anything else | `public/404.html` | The 404 page, served with status 404 by the dev server and by Vercel. |

- `public/` is everything the browser can load: the pages above, `style.css` (the brand), `marketing.css` (the public-page components), scripts, images.
- `api/` holds the six server routes. `lib/` holds the shared code. `middleware.js` keeps `/site` behind the invite cookie and forwards old personal links from `/` to `/invite`.
- `scripts/dev-server.js` runs the whole thing locally with no accounts. `scripts/setup-sheet.js` prepares the Google Sheet. `scripts/make-images.js` (`npm run images`) writes the resized image variants.

## Run it locally

Node 20 or newer. On this machine Node is in `~/.local/bin`.

```bash
export PATH="$HOME/.local/bin:$PATH" && cd ~/Desktop/courtside && npm install && npm run dev
```

Open http://localhost:3000. No `.env` is needed: the server runs in mock mode (a JSON file instead of the Sheet) and prints emails to the terminal instead of sending them.

Test invite codes in mock mode:

| Code | What it does |
| --- | --- |
| `GUEST1` | Issued to "Ana Guest" with a guest email. Requests send two emails (Katie + guest). |
| `COURTSIDE` | Shared code with no guest email. Requests send one email (Katie only). |
| `PAUSED1` | Shows the "paused" message. |
| `ONCE1` | Works once, then shows "already been used". |

A personal link looks like `http://localhost:3000/invite?invite=GUEST1` and enters without typing. The pre-Phase-2 form, `http://localhost:3000/?invite=GUEST1`, still works: the server redirects it to `/invite` with the same query.

Mock data lives in `.data/mock.json` (created on first use from `tests/fixtures/seed.json`, ignored by git). To close a week or the trip while testing, set its `status` to `closed` in that file and restart the server. Delete the file to reset everything. Rate limits and the double-submit guard are in memory; restarting clears them.

## Tests

```bash
export PATH="$HOME/.local/bin:$PATH" && cd ~/Desktop/courtside && npm test
export PATH="$HOME/.local/bin:$PATH" && cd ~/Desktop/courtside && npm run test:e2e
```

`npm test` runs the store, validation, API (including `/api/waitlist` and `/api/event`), middleware and dev-server suites in mock mode with no network. `npm run test:e2e` starts a dev server per file on a free port with a temp mock file and drives it over HTTP and in headless Chromium (Playwright; `npx playwright install chromium` once). It expects no `.env` in the repo. Browser-level results are in `QA_REPORT.md`.

## Public pages

The homepage and the Pros page are static HTML that read their content from two data files, so the copy lives in one place each:

- `public/js/trips.js`: the featured trip and the 2027 Founding Season cards (`id`, `name`, `place`, `timing`, `blurb`, `status`, `price`, `photo`, `link`, `hostIds`). The homepage and the Pros page both read it, so a pro's "trips" never drift from the cards.
- `public/js/pros.js`: one entry per pro (`id`, `name`, `role`, `base`, `portrait`, `facts`, `bio`, `onCourt`, `links`) with a commented template entry for the next one. `public/js/pros-page.js` renders `/pros` from it.
- The homepage's waitlist forms (one under each lineup card, one general form at the bottom of the page) post to `POST /api/waitlist`; the server accepts only the trip ids in `trips.js` (it imports the file through `lib/lineup.js`) plus `general`, and writes the trip's name to the Waitlist tab.
- `public/404.html` is the 404 page, in the site shell with a way back. The dev server serves it with status 404 for any unknown path; on Vercel a `404.html` in the output directory is served the same way with no configuration.

Both pages use the brand tokens in `style.css` plus `marketing.css`, carry `noindex,nofollow`, and make no third-party requests. Facts that Katie has not supplied are shown as marked placeholders, never invented.

### Images

`npm run images` runs `scripts/make-images.js`, which writes resized WebP and JPEG variants of the photos in `public/assets/` (widths 480 and 960 plus the original width, never upscaled, metadata stripped) into `public/assets/derived/` with a `manifest.json` describing each variant. The pages reference those files in `srcset`; the originals are untouched. Re-run it after adding or replacing a photo.

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
5. Run the setup script. It creates the six tabs, writes the header rows, adds the dropdowns, seeds the trip and the seven weeks, and prints an example invite row. It is safe to run again, including on a Sheet set up before the Waitlist tab existed: it adds that tab with its headers and changes nothing else.

```bash
export PATH="$HOME/.local/bin:$PATH" && cd ~/Desktop/courtside && npm run setup-sheet
```

### 2. Email (Resend)

1. Create a Resend account, add and verify the sending domain, and create an API key.
2. In `.env` and in Vercel: `EMAIL_MODE=resend`, `EMAIL_API_KEY`, `FROM_EMAIL` (an address on the verified domain), `NOTIFY_EMAILS` (Katie's address, comma-separated if more than one).

### 3. Vercel

1. Create a Vercel project from this repo. Framework preset **Other**, no build command, leave the output directory default (Vercel serves `public/`). Node 20 or 22.
2. Add every variable from `.env.example` in the project's Environment Variables. `COOKIE_SECRET` must be a long random string. Without it the server falls back to a development default that is public in this repo, which would let anyone forge the cookie.
3. Deploy, then attach the domain.
4. The canonical and Open Graph URLs in the four page heads (`public/index.html`, `public/pros.html`, `public/invite.html`, `public/privacy.html`) point at `https://courtside-ivory.vercel.app` until the real domain lands. Swap them in all four files when it does.

Routing is `vercel.json` (`cleanUrls`, so `public/invite.html` is `/invite` and `public/pros.html` is `/pros`) plus `middleware.js`, which runs on `/`, `/site` and `/site.html` only: it redirects `/site` to `/invite` when the invite cookie is missing or invalid, and redirects `/?invite=CODE` (or `/?code=CODE`) to `/invite` with the same query so links sent before the homepage existed keep working. The middleware shape and the matcher were checked against the Vercel docs (2026-10-05 and 2026-10-22) but have not been exercised by a deploy yet; the first preview deploy should confirm both redirects.

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

The personal link for a code is `https://<domain>/invite?invite=CODE`. It fills the code in and enters automatically. Links in the older form, `https://<domain>/?invite=CODE`, still work: `/` redirects them to `/invite` with the same query.

### 5. Privacy notice

`public/privacy.html` is a clearly marked placeholder that describes what the site actually stores. Replace the wording before launch.

### 6. Images to replace

Three images load from other sites and must be replaced with licensed files before launch. They are listed in one place, `public/js/images.js`:

| key | used for | current source |
| --- | --- | --- |
| `laFinca` | Where you'll stay card | lafincaresort.com |
| `club` | Club de Tenis Almoradí photo in Where you'll play | ctalmoradi.com |
| `laMata` | La Mata Beach figure in Beyond tennis | multimedia.comunitatvalenciana.com |

To swap one, put the licensed file in `public/assets/` and change that key's URL to `/assets/<file>`.

The seven files already in `public/assets/` are the Courtside logos and Katie's own photos, exactly as embedded in the prototype except that the camera metadata (GPS coordinates and capture dates) was stripped losslessly on 2026-10-05. Run the same script on any photo before adding it, then `npm run images` to regenerate `public/assets/derived/`:

```bash
node scripts/strip-exif.js public/assets/<photo>.jpg
npm run images
```

## The Sheet

| Tab | Columns |
| --- | --- |
| Trips | `trip_id, name, status, closed_message` |
| Weeks | `week_id, trip_id, label, start_date, end_date, status, closed_message` |
| Requests | `request_id, submitted_at, trip_id, request_type, weeks, guest_name, guest_email, guest_mobile, players, partners, room, single_rooms, tennis, addons, party_type, level, tennis_style, travel_style, priorities, note, player_estimate, partner_estimate, group_estimate, brief, invite_code, invited_by, status, owner, internal_notes` |
| Invites | `code, issued_to, guest_email, guest_mobile, invited_by, max_uses, uses, status, created_at, last_used_at` |
| Log | `time, code, result, ip_hash` |
| Waitlist | `timestamp, email, name, trip, source` |

How Katie uses it:

- **Close a week**: set its `status` on the Weeks tab to `closed`. Within a minute the week is greyed out on the site and the server refuses requests for it. Set the Spain row on Trips to `closed` to stop all requests; the builder is replaced by that row's `closed_message`.
- **Work a request**: each request is one row on Requests with `status` starting at `New` (dropdown: New, In conversation, Confirmed, Waitlist, Declined), plus `owner` and `internal_notes` for her own use. The `brief` column is the same text the guest saw. Estimates are what the page showed the guest and are labeled working estimates; the server does not reprice.
- **Read the waitlist**: each sign-up from the homepage is one row on Waitlist: when (`timestamp`, UTC), `email`, `name` (blank when not given), `trip` (the trip's name as shown on the homepage, or `General` for the button at the bottom of the page) and `source` (`card` for a trip card's form, `footer` for the general one). The same email can appear once per trip. Katie reaches out from here when a trip opens; the site sends no email for a waitlist sign-up.
- **Read the Log**: one row per event, `code` says what happened and `result` the outcome: an invite code with `ok`, `invalid`, `paused`, `used_up`, `missing_code` or `rate_limited` (from the gate); `waitlist_submit` with the trip id or `general`; `no_code_click` (the hero's "Don't have an invite code?" link); `trip_card_open` with the trip id. `ip_hash` is a 16-character hash of the visitor's IP, never the IP itself.
- The site only appends to Requests, Waitlist and Log, and updates `uses` and `last_used_at` on Invites. It never edits anything else, so the other columns are safe to use freely.

## Who is making the request

The guest's name, email and mobile come from the invite row, not from form fields. Katie issues one code per guest, and the request modal shows "Requesting as {name} · invited by Katie". A shared code (no `guest_email`) still works, but the request row has no contact details and the guest gets no confirmation email.

If shared codes become the norm, the alternative is to collect name, email and mobile (with the consent checkbox) in the request modal. The Requests columns already exist for it; the places to change are marked with an `IDENTITY:` comment at the top of `api/request.js` and in `public/js/site.js` above the identity line.

## How it fits together

- `POST /api/code` checks the invite in the Sheet, records the use, and sets a signed `cs_session` cookie (30 days, HttpOnly). The code is never in the page source.
- `GET /api/session` tells the site who the guest is. `GET /api/trips` returns the trip and the weeks, cached for 60 seconds.
- `POST /api/request` validates the builder state, re-checks that the invite is still `active` and that the trip and the chosen weeks are open, appends the Requests row, and sends the emails. An identical request within 60 seconds returns the first request's ID instead of a second row; an edited one is a new row.
- Pausing or revoking a code in the Sheet blocks new sign-ins and new requests right away. Someone already inside can still look at the page until their 30-day cookie expires.
- `POST /api/waitlist` takes `{ email, name?, tripId, source, consent: true, website: "" }` from the homepage's waitlist forms, no cookie needed. It validates (email shape and length, name length, `tripId` one of the ids in `public/js/trips.js` or `general`, `source` `card` or `footer`, `consent` ticked), lower-cases the email, appends one Waitlist row with the trip's name, and writes a `waitlist_submit` Log row. Answers `200 { ok:true }`, `400 { ok:false, errors:{ field: message } }`, `429 { ok:false, reason:"rate_limited" }` or `500 { ok:false, reason:"server_error" }`. The same email and trip within 60 seconds is answered `200` again without a second row.
- `POST /api/event` takes `{ name, detail }` sent with `navigator.sendBeacon` (so the body may be `text/plain`), accepts `no_code_click` and `trip_card_open` (detail = a trip id), writes one Log row and answers `204` with no body, even when the Sheet write fails. Unknown names, a bad detail or a body over 1 KB are `400`.
- Rate limits per IP per 10 minutes, kept in memory per server instance: 10 code attempts, 5 request posts, 5 waitlist sign-ups, 60 events. A hidden honeypot field drops bots silently on `/api/request` and `/api/waitlist`. Every code attempt, waitlist sign-up and event is logged to the Log tab with a hashed IP; there is no third-party analytics and personal data goes only to the Sheet.
- The public pages (`/`, `/pros`, `/invite`, `/privacy`) need no cookie; the homepage calls only `/api/waitlist` and `/api/event`, the others call no API. `/site` needs the cookie; without it the middleware (and the dev server) send the browser to `/invite`, and `site.js` does the same on a 401 from the API.
- Only `public/` is served statically. `lib/`, `tests/` and this file are not reachable from the browser. The dev server serves clean URLs only (`/invite`, not `/invite.html`), and any unknown path gets `public/404.html` with status 404 (API misses stay JSON: `404 { ok:false, reason:"not_found" }`).

## Phase 2 candidates

- Pricing in a `Pricing` tab with the server recalculating the estimate.
- A "request an invitation" flow for people without a code.
- A second bookable trip; the Trips and Weeks tabs already carry `trip_id`.
- Contact fields in the modal, if shared codes are wanted (see above).
