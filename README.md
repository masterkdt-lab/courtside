# Courtside Travel Co. — The Spanish Offseason (Phase 1)

Invitation-only site for The Spanish Offseason. A guest enters the code Katie gave them, sees the trip, builds a private week or applies to a vetted group, and sends the request to Katie. Invite codes, week availability and every request live in one Google Sheet. The site is plain HTML, CSS and JavaScript with a handful of Vercel functions; there is no database, no accounts and no payments.

- `public/` is everything the browser can load: the gate (`index.html`), the site (`site.html`), the privacy notice, styles, scripts, images.
- `api/` holds the four server routes. `lib/` holds the shared code. `middleware.js` keeps `/site` behind the invite cookie.
- `scripts/dev-server.js` runs the whole thing locally with no accounts. `scripts/setup-sheet.js` prepares the Google Sheet.

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

A personal link looks like `http://localhost:3000/?invite=GUEST1` and enters without typing.

Mock data lives in `.data/mock.json` (created on first use from `tests/fixtures/seed.json`, ignored by git). To close a week or the trip while testing, set its `status` to `closed` in that file and restart the server. Delete the file to reset everything. Rate limits and the double-submit guard are in memory; restarting clears them.

## Tests

```bash
export PATH="$HOME/.local/bin:$PATH" && cd ~/Desktop/courtside && npm test
```

Runs the store, validation, API and dev-server suites in mock mode with no network. Browser-level results are in `QA_REPORT.md`.

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
5. Run the setup script. It creates the five tabs, writes the header rows, adds the dropdowns, seeds the trip and the seven weeks, and prints an example invite row. It is safe to run again.

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

Routing is `vercel.json` (`cleanUrls`) plus `middleware.js`, which redirects `/site` to `/` when the invite cookie is missing or invalid. The middleware shape was checked against the Vercel docs on 2026-10-05 but has not been exercised by a deploy yet; the first preview deploy should confirm that `/site` without a cookie redirects.

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

The personal link for a code is `https://<domain>/?invite=CODE`. It fills the code in and enters automatically.

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

The seven files already in `public/assets/` are the Courtside logos and Katie's own photos, exactly as embedded in the prototype. Three of them still carry EXIF metadata with GPS coordinates and capture dates from the phone they were taken on: `life-eva-paella.jpg`, `life-friends-court.jpg`, `life-friends-family.jpg`. Strip the metadata (any image tool's "remove EXIF" or a re-export) before the site is public, or replace the photos.

## The Sheet

| Tab | Columns |
| --- | --- |
| Trips | `trip_id, name, status, closed_message` |
| Weeks | `week_id, trip_id, label, start_date, end_date, status, closed_message` |
| Requests | `request_id, submitted_at, trip_id, request_type, weeks, guest_name, guest_email, guest_mobile, players, partners, room, single_rooms, tennis, addons, party_type, level, tennis_style, travel_style, priorities, note, player_estimate, partner_estimate, group_estimate, brief, invite_code, invited_by, status, owner, internal_notes` |
| Invites | `code, issued_to, guest_email, guest_mobile, invited_by, max_uses, uses, status, created_at, last_used_at` |
| Log | `time, code, result, ip_hash` |

How Katie uses it:

- **Close a week**: set its `status` on the Weeks tab to `closed`. Within a minute the week is greyed out on the site and the server refuses requests for it. Set the Spain row on Trips to `closed` to stop all requests; the builder is replaced by that row's `closed_message`.
- **Work a request**: each request is one row on Requests with `status` starting at `New` (dropdown: New, In conversation, Confirmed, Waitlist, Declined), plus `owner` and `internal_notes` for her own use. The `brief` column is the same text the guest saw. Estimates are what the page showed the guest and are labeled working estimates; the server does not reprice.
- The site only appends to Requests and Log, and updates `uses` and `last_used_at` on Invites. It never edits anything else, so the other columns are safe to use freely.

## Who is making the request

The guest's name, email and mobile come from the invite row, not from form fields. Katie issues one code per guest, and the request modal shows "Requesting as {name} · invited by Katie". A shared code (no `guest_email`) still works, but the request row has no contact details and the guest gets no confirmation email.

If shared codes become the norm, the alternative is to collect name, email and mobile (with the consent checkbox) in the request modal. The Requests columns already exist for it; the places to change are marked with an `IDENTITY:` comment at the top of `api/request.js` and in `public/js/site.js` above the identity line.

## How it fits together

- `POST /api/code` checks the invite in the Sheet, records the use, and sets a signed `cs_session` cookie (30 days, HttpOnly). The code is never in the page source.
- `GET /api/session` tells the site who the guest is. `GET /api/trips` returns the trip and the weeks, cached for 60 seconds.
- `POST /api/request` validates the builder state, re-checks that the invite is still `active` and that the trip and the chosen weeks are open, appends the Requests row, and sends the emails. An identical request within 60 seconds returns the first request's ID instead of a second row; an edited one is a new row.
- Pausing or revoking a code in the Sheet blocks new sign-ins and new requests right away. Someone already inside can still look at the page until their 30-day cookie expires.
- Rate limits: 10 code attempts and 5 request posts per 10 minutes per IP, kept in memory per server instance. A hidden honeypot field drops bots silently. Every code attempt is logged to the Log tab with a hashed IP.
- Only `public/` is served statically. `lib/`, `tests/` and this file are not reachable from the browser.

## Phase 2 candidates

- Pricing in a `Pricing` tab with the server recalculating the estimate.
- A "request an invitation" flow for people without a code.
- Miami Courtside as a second trip; the Trips and Weeks tabs already carry `trip_id`.
- Contact fields in the modal, if shared codes are wanted (see above).
