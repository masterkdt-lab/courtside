# Courtside Travel Co. — Polish brief (branch `polish`)

Owner: KC. Approved 2026-10-22. This file is the authority for the `polish` branch. It supersedes the earlier "polish prompt" and the "deeper version" rewrite; where they differ, the brief in section 1 wins.
Read `COURTSIDE_PHASE2_PLAN.md` for how the public pages were built and `COURTSIDE_PHASE1_PLAN.md` for the gate, the Sheet and the tooling.

## 0. Status and run order (for the session that picks this up)

Done before this file was written: Phase 2 (`public-pages`: homepage at `/`, `/pros`, gate at `/invite`) built, QA'd and pushed; the `juliobsz/skills` package installed globally for Claude Code (`~/.claude/skills/awwwards`, `~/.claude/skills/jury`); branch `polish` cut from `public-pages`. Claude Code was restarted so the two skills load.

Run order from here, nothing skipped:

1. Confirm `/jury` and `/awwwards` appear in the skill list. Confirm `git branch --show-current` is `polish` and `git status` is clean. Never touch `main`.
2. **Baseline.** Start `npm run dev` (port 3000, mock mode is fine: `MOCK_DATA_PATH` or no `.env`; do not submit codes against the real Sheet). Run `/jury` on `http://localhost:3000/`, `/pros` and `/invite`, and on the Vercel branch preview if it is reachable (it sits behind Vercel deployment protection; `vercel curl` works, a browser needs a Vercel login). Save scores and findings to `JURY_BASELINE.md`. Screenshot `/` and `/pros` at 390×844 and 1440×900 and with reduced motion into a `before/` folder in the scratchpad.
3. **Plan.** Run `/awwwards` in POLISH mode only. Write `DESIGN.md` by extracting the existing system from `public/style.css`, `public/marketing.css` and the rendered pages, never inventing one. Produce the plan with: the three hero sentences (what, for whom, what to do) in Katie's cadence; the CTA map (every button and link on `/` and `/pros` with its destination, which one is primary per viewport); the waitlist API and Sheet design (section 3); the event-logging design (section 3); the placeholder-hiding rule for `/pros` (section 4); the Utopia type and space scale derived from current sizes; the Georgia fallback; the one motion moment. **Show KC the plan and wait for his OK before building.**
4. **Build** with subagents (frontend, platform/API, QA) on `polish` only. Keep `npm test` and `npm run test:e2e` green throughout.
5. **Validate** per section 6, re-run `/jury`, write `POLISH_REPORT.md`, commit and push `polish`, report the Vercel preview URL.

## 1. The approved brief (KC, verbatim)

> Good. Approved with these edits. Treat this as the full brief for the polish branch.
>
> 1. Homepage CTA hierarchy (replaces the "waitlist is the primary job" framing). Everyone visits the homepage, including people Katie invited, so it has to serve them first:
>    - Hero has ONE primary button: "Enter invite code." It goes straight to The Spanish Offseason. Also keep a persistent "Enter code" link in the nav, plus the sticky mobile CTA for it.
>    - Directly under it, a small text link: "Don't have an invite code?" It scrolls (native CSS scroll-behavior, no library) to the trip lineup.
>    - Each waitlist trip card opens a light inline/modal email capture: "Join the waitlist for [Trip]." Email required, name optional. It records which trip they picked.
>    - One general "Join the waitlist" button at the very bottom of the site, after the story section, for people who don't pick a trip.
>    - Keep the learn-about-Courtside story section as is. It works, and invited guests use it to learn about us too.
>
> 2. Waitlist backend and logging:
>    - Submissions go to a new Waitlist tab in the existing Sheet with columns: timestamp, email, name, trip, source (card/footer). Same validation, honeypot and rate limit as /api/request.
>    - First-party event logging goes to the Log tab: code entered, code success/fail, "Don't have a code" click, trip card open, waitlist submit.
>    - No third-party analytics. Personal data goes only to the Sheet.
>
> 3. Don't block on raw material. Use the repo, the decks and the existing photos now. List what you'd still want from Katie (invite text, voice memo, full-res photos, real bio facts) as follow-ups in POLISH_REPORT.md.
>
> 4. Content rules:
>    - Hide placeholder rows on /pros in production instead of showing "Details to come."
>    - No unverified prices, dates or guest counts. Non-Spain trips say "To be announced" where details aren't confirmed.
>    - Locked brand: cream #f4efe5 and espresso palette, Georgia with a size-adjusted fallback for Android, the courtside-lockup.png logo, the "good places. better people." tone. No outside web fonts, no stock images, only existing photos.
>
> 5. Design method (keep from your plan): Utopia fluid type scale, APCA contrast checks, squint test on the hero, a CTA audit with every button mapped to a destination, sharp crops of existing photos. No loaders, no smooth-scroll library.
>
> 6. Definition of done for this branch: tests green, Lighthouse 90+ and axe clean, iOS/Android/Windows screenshots, /awwwards and /jury before-and-after scores. The six-person test and Katie's read-aloud happen after launch; put a script for them in the report.
>
> Work on the polish branch only. Show me the plan first, with the three hero sentences and the CTA map, and wait for my OK before building.

Earlier constraints that still apply (from the first polish prompt): no URL changes; the `/invite` gate behaviour unchanged; noindex kept; the data files' content unchanged except for facts KC supplies; no frameworks or build step; GSAP/Lenis only if deferred, public pages only, fully disabled under `prefers-reduced-motion`, and given item 5 above the working assumption is **no motion library at all**: one CSS hero reveal; the "Don't have an invite code?" scroll is a plain anchor with the existing `scroll-behavior` rule.

## 2. What changes on the pages (derived from section 1; the plan in step 3 refines it)

- **Hero**: one primary `.primary` button "Enter invite code" → `/invite`. Under it a small text link "Don't have an invite code?" → `#trips`. The current secondary "Meet the pros" hero button goes (the nav and the teaser keep that path); confirm in the plan.
- **Nav**: the pill reads "Enter code" → `/invite` on every public page, visible at every width. A sticky mobile CTA bar with the same action appears after the hero scrolls out, hidden under reduced motion only in how it appears, never in whether it exists.
- **Trip cards**: each waitlist card's "Join the waitlist" opens an inline capture under the card (or a small dialog on desktop): heading "Join the waitlist for {Trip}", email required, name optional, hidden `tripId` and `source=card`, honeypot, consent line linking `/privacy`, Send, success and error states. The Spain card keeps "Enter with your invitation" → `/invite`.
- **Bottom of the site**: after the story/pros section and before the footer, one general "Join the waitlist" button opening the same capture with `trip=general`, `source=footer`.
- **Story section**: unchanged in content and order.
- **`/pros`**: rows flagged `placeholder: true` in `pros.js` are not rendered; the data stays in the file for when Katie supplies facts. Nelson therefore shows name, monogram and "Trips to be announced" only. The `--check` drift test is updated to match.
- **Type and space**: a fluid scale from Utopia fitted to the existing sizes; measure 45–75ch; leading per size; a spacing scale replacing ad-hoc margins; APCA-checked gold-on-cream eyebrows; a local `@font-face` named for the fallback with `size-adjust` so Android's serif keeps Georgia's measure; `--serif` becomes `Georgia, '<fallback>', serif`.
- **Images**: focal-point crops per breakpoint generated with sharp from the originals (extend `scripts/make-images.js`), one aspect ratio per card type, no layout shift.
- **Motion**: one hero reveal in CSS, nothing on scroll, nothing under reduced motion.

## 3. Platform design (carry-over decisions, so the next session does not re-derive them)

- **`POST /api/waitlist`** body `{ email, name?, tripId, source: 'card' | 'footer', consent: true, website: '' }`. `tripId` is a known id from `public/js/trips.js` or `general`; email validated by shape, lower-cased, ≤ 254 chars; name ≤ 120 chars; honeypot returns 200 and writes nothing; rate limit bucket `waitlist`, 5 per 10 minutes per IP hash; double submit: identical email + trip within 60 s returns the first result. Response `200 { ok:true }`, `400 { ok:false, errors }`, `429 { ok:false, reason:'rate_limited' }`. No cookie required. Server also writes a Log row for the submit.
- **Sheet**: new tab `Waitlist` with headers `timestamp, email, name, trip, source`; `scripts/setup-sheet.js` adds it idempotently; the mock seed gets `waitlist: []`; the store interface gains `appendWaitlist(row)`; `lib/store.columns.js` gains the tab.
- **Events**: `POST /api/event` body `{ name, detail }` sent with `navigator.sendBeacon` (fallback `fetch` keepalive). Names: `no_code_click`, `trip_card_open` (detail = tripId), `waitlist_submit` (detail = tripId or `general`, written by the server, not the client). Code entered / success / fail are already written by `/api/code`. Rows go to the Log tab as `time, code=<event name>, result=<detail>, ip_hash`. Rate limit bucket `event`, 60 per 10 minutes; unknown names → 400; no body larger than 1 KB.
- **Middleware/dev server**: no new pages, so no routing changes beyond the two API routes in the dev server's `/api/*` dispatch (already dynamic).
- **Tests**: unit tests for both routes and the store method; e2e: card capture flow writes one Waitlist row and one Log row; footer capture; events logged; placeholders absent from `/pros` markup; sticky CTA present at 390px; hero link lands on `#trips`; everything existing stays green.

## 4. Content rules for the polish pass

- Hide, never invent. Allowed numbers on `/`: "4–12 players", "from $2,995" for Spain, "five-star" for La Finca. Non-Spain trips show "To be announced" wherever a detail is unconfirmed.
- Brand locked as in section 1 item 4. No outside fonts, no stock images, only the existing seven assets and their derived crops.
- Copy stays in the existing voice: lowercase italic serif taglines, short sentences, "Katie", no exclamation marks.

## 5. Raw material to request from Katie (list in POLISH_REPORT.md; do not block on it)

The exact invitation text she sends; a voice memo or call notes about the trips and the people; full-resolution originals of every photo and anything else from Spain; real bio and on-court facts for Katie, Eva and Nelson; Eva's surname; which photos are cleared for public use.

## 6. Definition of done (KC, item 6) and how to produce each

- `npm test` and `npm run test:e2e` green.
- Lighthouse mobile 90+ on all four categories for `/` and `/pros`: run `npx lighthouse <url> --preset=... --chrome-flags="--headless"` with `CHROME_PATH` pointed at Playwright's Chromium (`node -e "console.log(require('playwright').chromium.executablePath())"`), throttled mobile; save the JSON and the scores in the report.
- axe: zero serious or critical on `/` and `/pros` (the Phase 2 e2e already scans; keep it).
- Screenshots: real devices are not available to the agent. Produce Playwright device emulations (iPhone 14 Safari UA, Pixel 7 Chrome UA with the Georgia-less fallback forced by blocking the font, Windows Chrome viewport) at 390 and 1440 and with reduced motion, before and after, and ask KC to take one screenshot each from a real iPhone and Android phone on the preview URL for the report.
- `/jury` before and after with the score deltas; `/awwwards` run only in polish mode.
- `POLISH_REPORT.md`: score deltas, what changed and why, every placeholder and its decision, the Lighthouse and axe results, the screenshot paths, the raw-material follow-ups (section 5), and two scripts for after launch: the six-person five-second and first-click test, and Katie's read-aloud check.
