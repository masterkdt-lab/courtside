# QA report — polish pass (branch `polish`)

Date: 2026-10-22. Branch `polish` at `e3370ec` (working tree: the three e2e suites updated, `tests/e2e/polish.test.js` and this file added; nothing else). QA agent only: nothing in `public/`, `api/`, `lib/` or `scripts/` was changed. Verified against `COURTSIDE_POLISH_BRIEF.md` (sections 1, 4, 6), `POLISH_PLAN.md` (sections 1–8 and the approved decisions), `DESIGN.md` and `public/assets/PHOTOS.md`, never against anyone's claims.

## How it was run

- Node 22.23.1 from `~/.local/bin`; Playwright 1.63 Chromium 1243 (already installed) and WebKit 2359 (installed for the iPhone frame: `npx playwright install webkit`); `axe-core` 4.14.0; `sharp` 0.35.5. No devDependency added.
- Every suite starts its own in-process dev server (`tests/e2e/helpers.js`: mock store in a temp file, free port, log-mode email). Lighthouse and the screenshots used a separate server, `PORT=4400 DATA_BACKEND=mock EMAIL_MODE=log MOCK_DATA_PATH=<temp copy of tests/fixtures/seed.json> node scripts/dev-server.js`, stopped afterwards (`pgrep -fl dev-server` → none). No Sheets-mode server was ever started.
- Items 2–14 and 17 are `node --test` tests in `tests/e2e/polish.test.js` (24 tests, one `describe` per item); `tests/e2e/public.test.js` was rewritten to the approved design (27 tests, every Phase 2 check that still applies kept); `browser.test.js` and `http.test.js` got one assertion each. Items 1, 15 and 16 were run by hand and are recorded here.
- Screenshots and Lighthouse JSON: `/private/tmp/claude-501/-Users-kc/f7a998c8-fdda-4c64-95a9-a7213f37aefa/scratchpad/qa-polish/` (listing at the end).

## Checklist

| # | Item | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | `npm test` and `npm run test:e2e` pass | PASS (unit) / 2 documented defects (e2e) | `npm test`: 196/196. `npm run test:e2e`: 91 tests, 89 pass, 2 fail; both failures are in `polish.test.js` and are the real defects below (item 8: hero H1 97.6px at 1440; item 9: `#8a6d3c` at 4.22:1). `browser` 20/20, `http` 15/15, `public` 27/27, `polish` 22/24. |
| 2 | Hero | PASS | One `<h1>` "tennis takes you further." (`em` = "further."), `.sub` "good places. better people." italic, `.intro` = the two approved sentences verbatim, no `.eyebrow` in the hero, `.hero-ctas` has exactly 2 links: `a.primary` "Enter invite code" → `/invite` and `a.no-code` "Don’t have an invite code?" → `#trips`. Clicking it keeps the document (a `window` marker survives), `scroll-behavior: smooth`, `#trips` lands at 129px under a 112px header at 390 and 104px under 83px at 1440. |
| 3 | CTA map | PASS | Every row of `POLISH_PLAN.md` section 2 present with its destination on `/` (logo `/`, Trips `#trips`, Meet the pros `/pros`, pill "Enter code" `/invite`, hero pair, sticky bar "Enter code" `/invite`, featured "Enter with your invitation" `/invite`, six `button.waitlist-open` → `waitlist-<id>` each with a form, step 01 "Enter it here" `/invite` the only link in `#how`, teaser `/pros#katie|eva|nelson` + "Meet the pros" `/pros`, general opener → `waitlist-general` (`data-trip=general data-source=footer`), footer `/pros` `/privacy` `/invite`) and on `/pros` (Trips `/#trips`, `aria-current=page`, jump row, Katie's Spain card and Eva's line → `/invite`, three "Enter invite code" → `/invite`). "powered by tgl.rsvp" footer-only in the shell. Pill "Enter code" → `/invite` on `/`, `/pros`, `/privacy` and the 404 at both widths (the gate has no shell header). Phones: header 112px (`--header-h` 110), nav row top 70 = logo bottom, pill 13–57 in the first row, both links 40px tall. Sticky bar at 390: off at the top (`is-on` false, `aria-hidden=true`, `visibility:hidden`, link not focusable), on after the hero (`aria-hidden=false`, `visibility:visible`, `transform:none`, focusable, link at the viewport bottom), off again on scroll-up; `display:none` at 700 and 1440 even mid-page. |
| 4 | Waitlist capture | PASS | Six `button.waitlist-open[aria-expanded="false"][aria-controls]`, each target holds a form. Open Charleston → focus on `#wl-charleston-email`, one Log row `trip_card_open:charleston` (`time, code, result, ip_hash`). Escape → `aria-expanded=false`, panel hidden, focus on the opener. `ana@example.c` (passes the client regex) → `POST /api/waitlist` 400, status "Enter a valid email address." in `.is-error`, focus on the field, nothing written. Valid submit → 200, form `.is-done`, "You’re on the list for Charleston. Katie will be in touch when it opens.", one Waitlist row `{ email: ana.guest@example.com, name: Ana Guest, trip: Charleston, source: card }`, one `waitlist_submit:charleston` Log row. General capture → row `General` / `footer`, "You’re on the list. Katie will be in touch when the lineup firms up.", Log `waitlist_submit:general`. Honeypot filled → 200, same success copy, no Waitlist and no Log row; the field is off screen, opacity 0, `tabindex=-1`, `aria-hidden`. `a.no-code` click → one `no_code_click` row. Without JS: seven forms in the markup, open, with the noscript line. |
| 5 | Placeholders | PASS | `/\b(bio\|details\|role\|photo )?to come\b/i` matches nothing in `document.body.textContent` or `outerHTML` (comments included) on `/pros` and `/`. Nelson: `h2` "Nelson Ramos", monogram "NR", no `<img>`, no eyebrow, no facts row, no panels, "Trips to be announced.", CTA "Enter invite code". Katie and Eva: facts `Almoradí`, `Spain` only; panels "On court" and "Trips" only (no About until a bio exists). `node public/js/pros-page.js --check` → "pros.html matches pros.js (3 pros) and IMAGES matches manifest.json". |
| 6 | Photos | PASS | `manifest.json` crops: `katie-portrait-34` left 135–634 of 960 (left half), `eva-portrait-34` left 557–960 (right half). `/pros`: Katie's profile and jump link load `katie-portrait-34-480.webp` alt "Katie on a clay court in Spain"; Eva's load `eva-portrait-34-403.webp` alt "Eva on a clay court in Spain". Teaser at 390: Katie `katie-portrait-34-480.webp`, Eva `eva-portrait-34-403.webp` (her crop is 403px wide, its only variant; nothing larger exists to fetch). Hero: `hero-clay-45-480.webp` at 390, `hero-clay-32-960.webp` at 700 and 1440. `alt`, `width`, `height` on every `<img>` on all five pages. At 390×3 the page fetches `hero-clay-45-960`, `courtside-lockup-640`, `spain-card-43-960`, `coast-small-11-480`, `katie-portrait-34-480`, `eva-portrait-34-403`, `courtside-lockup-footer-640`: nothing wider than 960. |
| 7 | No invented claims | PASS | 14 hits, all allowed (table below). `guests`, `8–12`, `Dellich`, `Miami`, `white visor`: 0 hits in the five files. `$` appears 3 times (featured overlay, Katie's Spain card, `trips.js`). Five cards carry `<p class="trip-tba">To be announced</p>`; no "TBD"/"TBA"/"coming soon" in the visible text. |
| 8 | Type and space | FAIL (H1 at 1440) | `marketing.css` `:root` defines `--t-5` … `--t--2` (eight steps; DESIGN.md says "nine" and lists these eight), `--s-3xs` … `--s-4xl` (ten), `--serif: Georgia, 'Courtside Serif Fallback', serif`, and the two `@font-face` rules with `size-adjust:94%; ascent-override:92%; descent-override:22%; line-gap-override:0%`, `local()` sources only. One bare `font-size` outside the token block: `.monogram span{font-size:5rem}` at 700px+ (the monogram letters; undocumented, reported as the exception). Computed: body 17.07px at 390 and 17.81px at 1440; hero H1 **56.65px at 390 and 97.6px at 1440 (DESIGN.md: 112)**; section H2 40.0 / 68.0 (DESIGN.md: 40 → 80); intro 18 / 20.3; eyebrow 14 / 14.4. The slopes are too shallow: `clamp(3.5rem, 2.59rem + 3.9vw, 7rem)` reaches 7rem at 1809px, not 1440. Widest paragraphs: 61.4ch at 1440 (`.section-head p`), 38.9ch at 390 (`.jeff-footnote`, 520px). |
| 9 | Contrast | FAIL | axe 4.14.0 after the hero settles, five pages × two widths: `color-contrast` serious on every page: `/` ×13 (eyebrows, pillar `.path-number` ×3, `.pro-role` ×3 at `#8a6d3c` on `#f4efe5` = **4.22:1**, needs 4.5:1 for 14px bold; plus the three `.steps .path-number` at `#b9985d` on the dark card `#443229` = 4.44:1), `/pros` ×4 (Katie's eyebrow, three `h3.profile-label`), `/invite`, `/privacy`, 404 ×1 (the eyebrow). No other serious or critical violation; one moderate (`region`: the sticky bar sits outside any landmark at 390). Eyebrow colour is `rgb(138, 109, 60)` = `#8a6d3c` as specified; `#8a6d3c` on cream is 4.23:1 (4.57:1 on paper), so DESIGN.md's "4.7:1" is wrong and the token fails WCAG AA on cream by 0.27. |
| 10 | Keyboard and focus | PASS (gate noted) | Skip link is the first Tab stop on `/`, `/pros`, `/privacy` and the 404, visible when focused, Enter moves focus to `#main`; on the 404 the next Tab is "Back to Courtside" (`a.primary[href="/"]`) with a ring. The gate has no skip link (it has no header to skip): Tab stops are `← Courtside` → `#inviteCode` → Enter. Tab walks: `/` 23 stops, `/pros` 16, `/invite` 3, `/privacy` 8, 404 10; focus leaves the document on every page; every stop `:focus-visible` with an outline; the featured button's and the three teaser links' rings sit on the `.panel` / `.pro-card` frames. Capture by keyboard: Enter on the opener → email → name → consent → privacy link → Join, each with a ring; Escape from inside the form closes it and returns focus. |
| 11 | Hover | PASS (two deviations noted) | Computed styles via `hover()`: primary `rgb(57,38,29)` → `rgb(38,25,20)` + `translateY(-2px)`, arrow `translateX(4px)`; secondary and pill transparent → espresso with cream text, −2px; nav link and no-code link `background-size` `0px 1px` → `100% 1px`; `.pro-card` `translateY(-4px)` + shadow; logo `scale(1.03)`. Same end state on `:focus-visible` for all seven (the no-code link gets the underline but not the espresso colour the hover rule adds). CSS scan: 19 `:hover` rules, 11 inside `@media (hover:hover)` including every moving one; outside it only colour/underline rules (`.footer-links a`, `.gate-back`, `.pros-jump a`, `.profile-links a`, `.profile-trip-line a`) and **`.dark .secondary:hover` (a background flood on the dark band)**, plus the reduced-motion resets. |
| 12 | Motion | PASS | On load 6 animations, all in the hero (H1, sub, intro, CTAs at 700ms with 120/200/280/360ms delays, `.hero-image::before` 900ms, label 440ms), `fill: both`; after settling all `finished`, copy at opacity 1, shade 0, nothing restarts. Reduced motion: 0 animations, copy opacity 1, shade 0, image opacity 1, `scroll-behavior: auto`, `#trips` lands instantly (top = scroll-margin), sticky bar `transition-duration: 0s` and visible at once. `/` → `/pros` → `/` → `/invite` → `/privacy` → `/` by clicks and `goto`: console silent, no `pageerror`; `document.startViewTransition` is a function and the `@view-transition` opt-in is inline in `<head>`. |
| 13 | 404, metadata, icons | PASS | `/nope`, `/nope/deeper`, `/404.html`, `/pros.html`, `/index.html` → 404 `text/html`, title "Page not found — Courtside Travel Co.", `lang="en"`, noindex; in the browser status 404, one `<h1>` "That page isn’t on the court.", links `a.primary` "/" and `a.secondary` "/invite"; `/api/nope` stays JSON. `/`, `/pros`, `/invite`, `/privacy`: canonical = `og:url` on `https://courtside-ivory.vercel.app/…`, `og:title`, `og:description`, `og:image` → `/assets/og/{home,pros,invite}.jpg` (served 200, 1200×630 by sharp), `twitter:card` `summary_large_image`, `link rel=icon` `/favicon.svg` (200 `image/svg+xml`), `apple-touch-icon` 180×180, noindex, unique titles; `/pros` description 156 chars. The 404 has icons and noindex but no canonical/og (right for an unknown URL). `/invite`: one `<main>` holding `#gate`, h1 "Enter your invitation.", `.gate-sub` "tennis takes you further." italic, lockup `width=640 height=258`, `#inviteForm` unchanged, footer "Courtside Travel Co. · Founding Season 2027" on one line. |
| 14 | Brand diff | PASS | `git diff main -- public/style.css public/js/gate.js` empty; `public/site.html` diff is exactly `+<style>@view-transition{navigation:auto}@media (prefers-reduced-motion:reduce){@view-transition{navigation:none}}</style>`; `site.js` 6 changed lines, three `location.replace('/')` → `/invite`. `marketing.css` hex outside `:root`: `#d7c9b9`, `#261914` (both in `style.css`); in `:root`: `#8a6d3c` only. No `@import`, no webfont URL, no cross-origin `<link>` in any public file; the two `@font-face` rules use `local()` only. |
| 15 | Lighthouse mobile | PASS (SEO by design) | Table below. Perf 100/99/100, a11y 95/95/95, best practices 100/100/100, SEO 69/69/69 raw, 100/100/100 with `is-crawlable` excluded. The a11y deduction is `color-contrast` (item 9). |
| 16 | Screenshots | PASS | 13 PNGs listed at the end, plus the squint pair. Squint 390: the headline and the one dark button are the only two shapes that survive the blur; the sub line and intro fade to texture. Squint 1440: headline with the clay word and the dark pill read first, the photo second, the no-code link disappears (fine). iPhone 14 in WebKit; Pixel 7 in Chromium with `--serif` forced to the fallback; Windows UA at 1440×900. |
| 17 | Page weight | PASS | `/` at 390: first view 184 KB (8 requests), whole page 258 KB (11); at 3×: 378 KB / 513 KB. `/pros`: 186 KB / 209 KB (1×), 312 KB / 395 KB (3×). Zero third-party requests. Scripts: one external `type="module"` per page plus the 41-character inline `html.js` toggle; nothing render-blocking. Hero image transfer: `hero-clay-45-480.webp` 49.8 KB at 1×, `hero-clay-45-960.webp` 145.6 KB at 3×; `/pros` first portrait `katie-portrait-34-480.webp` 31.8 KB (499 variant 35.0 KB at 3×). Sizes are uncompressed: the dev server sends no gzip; Vercel will compress HTML/CSS/JS (52 KB of CSS → about 9 KB). |

### Item 7, every hit

| pattern | file:line | verdict |
| --- | --- | --- |
| `players` | `index.html:45` hero intro | allowed: the approved sentence "For the players they coach and the friends they bring." |
| `players` | `index.html:63`, `:70`, `:87`, `:252` | allowed: "4–12 players" / the trust-row pair |
| `star` | `index.html:72`, `:77` | allowed: "five-star" with La Finca |
| `$` | `index.html:84`, `pros.html:116`, `trips.js:21` | allowed: "from $2,995 per player, six nights" |
| `star` | `pros.html:47`, `:79`, `pros.js:3`, `:4` | markup noise: `pros:start` / `pros-jump:start` markers |
| `guests`, `8–12`, `Dellich`, `Miami`, `white visor` | — | no hits |

## Lighthouse (mobile, simulated throttling, Lighthouse 13.5.0, Playwright Chromium)

| Page | Perf | A11y | Best practices | SEO raw | SEO ex `is-crawlable` | LCP | CLS | TBT | FCP |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/` before | 100 | 95 | 96 | 66 | — | 1504 ms | 0 | 0 | — |
| `/` after | 100 | 95 | 100 | 69 | 100 | 1731 ms | 0.000 | 0 | 1356 ms |
| `/pros` before | 100 | 95 | 96 | 66 | — | 1581 ms | 0 | 0 | — |
| `/pros` after | 99 | 95 | 100 | 69 | 100 | 1953 ms | 0.000 | 0 | 1353 ms |
| `/invite` before | 99 | 93 | 96 | 66 | — | 2251 ms | 0 | 0 | — |
| `/invite` after | 100 | 95 | 100 | 69 | 100 | 1352 ms | 0.000 | 0 | 1202 ms |

Failing audits after: `color-contrast` (a11y, the `#8a6d3c` nodes) and `is-crawlable` (SEO, `noindex` by design). Best practices went 96 → 100. The home and pros LCPs are 230–370 ms slower than the baseline: the LCP image is now the 4:5 clay crop (146 KB at Lighthouse's 2.6× phone, versus the 16 KB selfie) and the 499px portrait; both stay well inside the 2.5 s "good" band. `/pros` is the slowest page and the only one whose eager first image has no `<link rel="preload">`. Byte weight per Lighthouse: 315 / 257 / 80 KiB.

## Beyond the checklist

Copy and content

1. "Places and timing are set" (the Founding Season intro) sits above a card whose place is "To be announced" (Fall offseason residency). One of the two should give.
2. The `/pros` h1 at 390 breaks "the people / you’ll / play with.": the `&nbsp;` keeps "play with." together but `text-wrap: balance` leaves "you’ll" alone on the middle line. A no-break space between "you’ll" and "play" (or dropping the balance there) would give two lines.
3. The home `meta description` is 167 characters (the 160 convention; `/pros` 156, `/invite` 155, `/privacy` 158).
4. Five of six lineup cards read city, timing, "To be announced", button: honest per the content rules, but at 1440 the row of three identical "To be announced" cards is the thinnest moment on the page.

Cropping and images

5. Both portraits come from a 960px-wide source: Katie's crop is 499px, Eva's 403px. At 1440 the profile portrait is drawn at about 460px CSS, so on a 2× screen each is shown at roughly 2.3× its pixels and goes soft. Nothing the pipeline can fix; it is the full-resolution originals in the raw-material list.
6. On phones the hero is copy-first: at 390×844 (and the iPhone 14 frame) only the top strip of the clay photo is in the first viewport, so "says tennis in the first second" (decision 7) holds on desktop more than on phones. The squint test still passes because the headline and button carry it.
7. Nelson's monogram block on phones is a 342×428px gradient (4:5 at full width); on `/pros` at 1440 it is 320×400. Expected until a photo exists; a shorter ratio for the monogram alone would cost nothing.
8. The home page is 7,998px tall at 390 (down from about 11,000; the plan's estimate was roughly 6,500).

Spacing, type, colour

9. `#8a6d3c` fails AA on cream (item 9). `#7d6236` gives 4.99:1 on cream and 5.40:1 on paper and reads as the same gold; `#866a3a` is the lightest value that passes (4.43:1 does not, so no). The three `.steps .path-number` on the dark band fail at 4.44:1 with `--gold`; the cream at 62% used for the footnote, or `--cream`, passes there.
10. The fluid type slopes stop short (item 8). For 56 → 112px over 390 → 1440px the Utopia line is `clamp(3.5rem, 2.2rem + 5.33vw, 7rem)`; for 40 → 80px, `clamp(2.5rem, 1.57rem + 3.81vw, 5rem)`. Every step would need the same recalculation; the mins at 390 are right.
11. `.monogram span{font-size:5rem}` is the one bare size outside the token block.

Interaction

12. `.dark .secondary:hover` (the "Enter it here" step button) floods its background outside `@media (hover:hover)`, so on touch it keeps the hover colours after a tap while every cream button does not. The no-code link darkens to espresso on hover but not on `:focus-visible`.
13. Opening the general capture sends `trip_card_open` with detail `general`, which `POST /api/event` refuses with a 400 (not a trip id); the open is never logged and the client spends a request on it. Either `home.js` skips the event for `general` or `validate.js` accepts it.
14. axe moderate: the sticky bar (`.sticky-cta`) sits outside every landmark when it is on. Wrapping it in `<nav aria-label="Enter code">` or moving it inside `<footer>` clears it.
15. The gate still carries Phase 1's `.powered` line in its top corner at 9.28px and `.invite-hint` at 12.48px, the two smallest texts on the site; both come from `style.css`, which is frozen, and decision 8 only covered the shell header.

Checks that could not be made here

16. The Georgia fallback's `size-adjust` could not be exercised: this Mac has none of `Noto Serif`, `Droid Serif`, `Tinos` or `Liberation Serif`, so `document.fonts.check("16px 'Courtside Serif Fallback'")` is false and the Pixel 7 frame renders the generic `serif` (Times) instead; the H1 still breaks as "tennis takes / you further." The real check needs an Android phone (the brief's follow-up for KC).
17. The Windows frame is Chromium with a Windows user agent on this Mac: layout and spacing are what Windows Chrome gets, the sans glyphs are not (Segoe UI there, SF here).
18. The Lighthouse numbers come from the unthrottled local server with simulated throttling; the Vercel preview, behind deployment protection, was not measured.

## Failures and repro

1. **`#8a6d3c` on cream fails WCAG AA (item 9).** `node --test tests/e2e/polish.test.js` → "9. contrast" fails and lists every node with its ratio. By hand: `node -e` with the WCAG formula gives 4.229 for `#8a6d3c` on `#f4efe5` (4.572 on `#fbf8f2`); or open `/`, inject `node_modules/axe-core/axe.min.js`, `axe.run()` → `color-contrast`, 13 nodes. Lighthouse a11y 95 on all three pages for the same reason. Fix: a darker gold ink (`#7d6236` passes on both grounds) and a cream for the dark-band step numbers; then DESIGN.md's figures.
2. **Hero H1 is 97.6px at 1440, not 112 (item 8).** Same suite → "8. type and space › computed sizes" fails: `--t-5 = clamp(3.5rem, 2.59rem + 3.9vw, 7rem)` evaluates to 41.44 + 56.16 = 97.6px at 1440 and only reaches 112px at 1809px; `--t-4` is 68px, not 80. By hand: `getComputedStyle(document.querySelector('.hero h1')).fontSize` at 1440×900. Fix: recompute the eight `--t-*` and ten `--s-*` clamps for the 390 → 1440 range (slope = (max − min) / 1050px × 100vw).

## Assumptions

- `/invite` has no skip link and is counted as passing item 10: the gate shell has no header or repeated block to bypass, and the code field is the second Tab stop. If "every page" is meant literally, add `<a class="skip-link" href="#main">` to `invite.html` (one line, no behaviour change).
- The 404 page has no canonical or `og:*`; that is correct for an unknown URL and is not counted against item 13.
- The missing `<link rel="preload">` on `/pros` is reported, not failed: the plan preloads the hero only.
- "Nine `--t-*` steps" in the brief and DESIGN.md: eight are defined and eight are listed in DESIGN.md's own block; the test asserts those eight.
- Item 11's "all inside `@media (hover: hover)`" was applied to the treatments that move or flood (all inside); the colour-only rules outside are listed, with `.dark .secondary:hover` called out as the one flood.
- Transfer sizes are uncompressed bytes from the dev server (`content-length`); first view = everything fetched by `networkidle` before scrolling.
- Hover checks ran in Chromium with a mouse (`matchMedia('(hover: hover)')` true); keyboard checks use Tab and `:focus-visible`.
- Each browser context uses its own `x-forwarded-for`, so rate limits and the double-submit guard never cross tests; the waitlist test submits four times from one IP (limit 5).

## Files

Screenshots and data, all in `/private/tmp/claude-501/-Users-kc/f7a998c8-fdda-4c64-95a9-a7213f37aefa/scratchpad/qa-polish/`:

- `after-home-390.png` (390×7998), `after-home-1440.png` (1440×6419), `after-pros-390.png` (390×5109), `after-pros-1440.png` (1440×4079), `after-invite-390.png` (390×844), `after-invite-1440.png` (1440×1011)
- `after-home-390-reduced.png` (390×7998, 0 animations), `after-pros-390-reduced.png` (390×5109, 0 animations)
- `device-iphone14.png` (WebKit, `devices['iPhone 14']`, 1170×1992), `device-pixel7.png` (Chromium, `devices['Pixel 7']`, `--serif` forced to `'Courtside Serif Fallback', serif`, 1082×2202), `device-windows-1440.png` (Chromium, Windows UA, 1440×900)
- `squint-home-390.png`, `squint-home-1440.png` (hero viewport, sharp blur sigma 6; the unblurred `hero-home-390.png` / `hero-home-1440.png` beside them)
- `sheet-after-*.png`: contact sheets of the full pages used for review
- `lighthouse-home.json`, `lighthouse-pros.json`, `lighthouse-invite.json`; `shots-meta.json`; `shots.mjs`, `run-lighthouse.sh`, `probe-axe.mjs`
- Test logs: `unit-final.log`, `e2e-final.log`, `polish-run3.log`, `public-run1.log`

Repo: `tests/e2e/public.test.js` (rewritten), `tests/e2e/browser.test.js` (privacy note assertion), `tests/e2e/http.test.js` (canonical link allowed in the same-origin check), `tests/e2e/polish.test.js` (new), this file. `POLISH_REPORT.md` is the orchestrator's scaffold and was not touched.

## Rerun

```bash
export PATH="$HOME/.local/bin:$PATH" && cd ~/Desktop/courtside
npm test                                     # 196 unit/API tests
npm run test:e2e                             # browser, http, public, polish (2 expected failures: items 8 and 9)
node --test tests/e2e/polish.test.js         # the checklist suite alone, diagnostics per item
node --test tests/e2e/public.test.js         # the Phase 2 suite with the polish expectations
node public/js/pros-page.js --check
git diff main -- public/style.css public/js/gate.js            # must be empty
git diff main -- public/site.html public/js/site.js            # one <style> line; three redirects

# Screenshots (item 16): starts its own in-process server, writes the PNGs next to the script
node /private/tmp/claude-501/-Users-kc/f7a998c8-fdda-4c64-95a9-a7213f37aefa/scratchpad/qa-polish/shots.mjs

# Lighthouse (item 15): mock server on 4400, three pages, server stopped at the end
/private/tmp/claude-501/-Users-kc/f7a998c8-fdda-4c64-95a9-a7213f37aefa/scratchpad/qa-polish/run-lighthouse.sh
# which runs, per page:
#   CHROME_PATH="$(node -e "console.log(require('playwright').chromium.executablePath())")" npx --yes lighthouse http://127.0.0.1:4400/ \
#     --form-factor=mobile --screenEmulation.mobile --throttling-method=simulate \
#     --only-categories=performance,accessibility,best-practices,seo --output=json --output-path=<file> \
#     --chrome-flags="--headless=new --no-sandbox" --quiet
```
