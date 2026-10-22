# QA report — Phase 2, Wave 3 (public homepage, Meet the Pros, gate at /invite)

Date: 2026-10-22. Branch `public-pages` at `e0eebb6` (three commits ahead of `main`). QA agent only; nothing was fixed.

## How it was run

- Node 22.23.1 from `~/.local/bin`, `npm install` already done, Playwright Chromium 1243 installed. `axe-core` 4.14.0 added as a devDependency (the only change outside the two files this report owns).
- Every gate, redirect and API check ran against an in-process dev server started through `tests/e2e/helpers.js` (mock store in a temp file, free port, log-mode email), exactly as the existing suites do. No code was ever submitted to the Sheets-mode server on port 3000; it was only used to confirm that `/`, `/pros`, `/invite` and `/privacy` are byte-identical to the branch files (`curl … | cmp`) and that its `/?invite=GUEST1` → 302 `/invite?invite=GUEST1`, `/site` → 302 `/invite`, `/marketing.css` → 200 `text/css`, `/index.html` → 404.
- The automatable items are `tests/e2e/public.test.js` (28 tests, `node --test`, part of `npm run test:e2e`). Four of them fail on purpose: each documents a defect listed under "Failures and repro".
- Screenshots: full-page PNGs from the in-process server at 390×844 and 1440×900 (plus `/` at 390 with reduced motion), reviewed by eye as viewport-sized tiles.

## Checklist

| # | Item | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | `npm test` and `npm run test:e2e` pass | PASS before this suite; FAIL with it | `npm test`: 156/156. `npm run test:e2e` before `public.test.js`: 40/40. With it: 68 tests, 64 pass, 4 fail; the 4 are the defect tests below (pros-page re-render, axe contrast, `/pros` preload, README). All 9 pre-existing e2e suites `ok`. |
| 2 | `/` is the homepage | PASS | 200, `noindex,nofollow`, no `id="inviteForm"`, one `<h1>` ("tennis takes you *further.*"). `body` children: `a.skip-link`, `header.site-header`, `main#main`, `footer.footer`. `main` children in order: `section.hero`, `section#about` (3 pillars), `section.quickfacts.trust` (Katie Delich · 4–12 · Almoradí · La Finca), `section#trips`, `section#season` (6 cards), `section#how` (3 steps), `section#pros` (3 cards → `/pros#katie`, `#eva`, `#nelson`). No console output. |
| 3 | `/pros` from `pros.js` | PASS (see Beyond 1) | `node public/js/pros-page.js --check` → "pros.html matches pros.js (3 pros) and IMAGES matches manifest.json". Sections `#katie`, `#eva`, `#nelson` in that order, jump row `#katie/#eva/#nelson`. Nelson: `.pro-portrait.monogram` = "NR", no `<img>`, "Trips to be announced.", no trip card. Katie and Eva: one card each (`#katie-trip-spain`, `#eva-trip-spain`, "The Spanish Offseason", tag "Invitation only", link `/invite`). "Dellich" absent. `/pros#eva` fresh load: `#eva` top 72px vs header bottom 70px at 390; 84px vs 82px at 1440 (scrollY 2675 / 2202). |
| 4 | `/invite` is the gate; flows | PASS | `#inviteForm` present, noindex, one `<h1>`, `← Courtside` link to `/`. Browser: GUEST1 → `/site` (`#site` visible). PAUSED1 → "This invitation is paused. Reach out to Katie."; ONCE1 after one use → "This invitation has already been used."; NOPE99 → "We couldn't find that invitation. Check the code and try again."; all stay on `/invite`. `/invite?invite=GUEST1` → `/site`, session `{ok, GUEST1, Katie, Ana Guest}`. `/?invite=GUEST1` → one 302 to `/invite?invite=GUEST1` → `/site`. `/site` without cookie: HTTP 302 `Location: /invite`; browser lands on `#inviteForm`. |
| 5 | Homepage CTAs | PASS | Hero `.primary` "See The Spanish Offseason" `href="#trips"`: after click URL is `/#trips`, a `window` marker survives (no navigation), `#trips` top = its `scroll-margin-top` (84px) just below the 82px header. Hero `.secondary` "Meet the pros" → `/pros`; header pill "Have an invitation?" → `/invite`; featured panel "Enter with your invitation" → `/invite`; teaser "Meet the pros" → `/pros`. Four `/invite` links on `/` (pill, featured card, step 01, footer). |
| 6 | No invented claims (decision 7) | PASS | 12 hits, all allowed (table below). `guests`, `8–12`, `Dellich`, `Miami`: 0 hits in the four files (case-insensitive). "Katie Delich" present on both pages. |
| 7 | Trips data and cards | PASS (one note) | `TRIPS` is the 7 entries with the plan's wording and order; all `waitlist` except `spain` (`invitation`); waitlist entries have `price/photo/link` null and `hostIds []`; Spain `hostIds ['katie','eva']`, price "from $2,995 per player, six nights"; no Miami. Six homepage cards match `trips.js` field by field (id, art label, "Waitlist" tag, name, "place · timing", blurb, "Join the waitlist", note). Note: the featured overlay reads "Costa Blanca, Spain · Winter 2027 · seven Sunday–Saturday weeks · from $2,995 per player, six nights" (plan 4.1 wording); `trips.js`'s blurb also carries "January 10 – February 27, 2027", which the card shows in its panel paragraph instead. Charleston blurb is capitalised with a full stop ("A local green-clay week + the Charleston Open."). |
| 8 | 390 and 1440 layout | PASS | `scrollWidth == innerWidth` on `/`, `/pros`, `/invite` at both widths after loading every lazy image. Smallest Phase 2 text 10.88px (`.caps`-size labels, `.gate-back`). Logos drawn at their natural ratio (`fill`/`contain`), every photo `object-fit:cover`; no leaf-text overlaps; header items do not collide; `main` starts below the sticky header. Tiles reviewed: no clipping, no stretched faces, cards and pills intact. Page heights: `/` 10,998px at 390 (see Beyond 3), 6,672px at 1440; `/pros` 6,791 / 5,128px. |
| 9 | Accessibility | FAIL (axe) | Skip link is the first Tab stop, visible when focused, Enter moves focus to `#main`, next Tab is the hero CTA (on `/pros`: the first jump pill). Landmarks: one `header`, one `main`, one `footer`, navs "Site", "Footer" (+ "Pros on this page"). One `<h1>`; 6 `<img>` per page, all with non-empty alt; `lang="en"`. Tab walk: 22 stops on `/`, 16 on `/pros`, every stop `:focus-visible` with an outline (the `.pro-link` ring sits on its `.pro-card`), order identical to DOM order. Waitlist `<details>`: Enter opens (note visible, exact text), Space closes. **axe 4.14.0: `color-contrast` serious, 16 nodes on `/` and 14 on `/pros`, same at 390 and 1440** (details below). No moderate or minor violations. "Incomplete" (manual review): `color-contrast` on 12 nodes (`/`) and 3 (`/pros`), all white text over photos/gradients; legible in the screenshots. |
| 10 | Performance | FAIL (`/pros` preload) | `/` at 390 (DPR 1): 9 requests, 179 KB first view, 565 KB whole page (HTML 14, CSS 32, images 517: lockup 20, hero 16, clay-480 96, clay-960 318, paella-480 44, footer lockup 23). Every request same-origin, nothing aborted. Hero `loading="eager" fetchpriority="high"`, `<link rel="preload" as="image">` whose `imagesrcset` equals the hero `<source>` srcset, served as WebP, no "preloaded but not used" warning. Every other `main` image lazy; footer logo lazy; header logo the only other eager image. No `<script>` on `/`. `/pros` at 390: 11 requests, 547 KB first view, 570 KB whole page; first portrait eager + high priority, **no preload link**; the one script is `type="module"`. DPR 3 (`/` at 390): 641 KB. |
| 11 | Reduced motion | PASS | With `prefers-reduced-motion: reduce`: `html` `scroll-behavior` is `auto`; right after the click `#trips` is at 72px (= its scroll margin) with `document.getAnimations()` empty; `.trip-card` `transition-duration` 0s and `transform` none on hover. Screenshot `home-390-reduced-motion.png`. |
| 12 | Brand | PASS (two notes) | `marketing.css` has no `:root`; its only hex literal is `#d7c9b9`, which `style.css` already uses for `.media-card` (a literal, not a token); its `rgba()` values are cream/espresso alphas, two of them new alpha steps (`rgba(244,239,229,.06)` and `.78`). No `@font-face`, `@import` or font URL in any public file; every `font:` shorthand ends in `var(--serif)`/`var(--sans)`. Headings compute to Georgia weight 400 on both pages, except `h3.profile-label` (About / On court / Trips), a sans small-caps label by design. `git diff main -- public/site.html public/style.css public/js/gate.js` is empty; `public/js/site.js` differs in exactly 6 lines: three `location.replace('/')` → `location.replace('/invite')`. |
| 13 | README | FAIL | Documents `/`, `/pros`, `/invite` (pages table), `https://<domain>/invite?invite=CODE`, `npm run images`, `public/js/trips.js` and `public/js/pros.js`. But it names `public/js/home.js`, which does not exist (the waitlist note is a `<details>`, no JS), lists a `dates` field that `trips.js` calls `timing`, says the variants are "widths 480, 960, 1600" while `derived/` holds 320–1120 (capped at the originals), and "Phase 2 candidates" still proposes "Miami Courtside as a second trip" (decision 2: no Miami). |
| 14 | Screenshots | PASS | Seven PNGs listed at the end. |

### Decision-7 grep (item 6), every hit

| pattern | file:line | verdict |
| --- | --- | --- |
| `\$` | `public/index.html:66` (featured overlay) | allowed: "from $2,995 per player, six nights" |
| `\$` | `public/pros.html:75`, `:125` (Katie's and Eva's Spain card) | allowed: "$2,995" |
| `\$` | `public/js/trips.js:20` | allowed: "$2,995" |
| `players` | `public/index.html:45` (pillar 02) | allowed: "groups of 4–12 players" |
| `players` | `public/index.html:52` (trust row) | allowed: `<strong>4–12</strong><span>players, private groups` |
| `players` | `public/index.html:69` (featured panel) | allowed: "Private weeks for 4–12 players" |
| `players` | `public/index.html:144` (step 02) | allowed: "Bring 4–12 players" |
| `star` | `public/index.html:54` (trust row) | allowed: "five-star resort · home base" under La Finca |
| `star` | `public/index.html:59` (featured intro) | allowed: "La Finca Resort as the five-star home base" |
| `star` | `public/pros.html:33`, `public/js/pros.js:3` | markup noise: the `pros:start` marker |
| `guests`, `8–12`, `Dellich`, `Miami` | — | no hits |

### axe `color-contrast` nodes (item 9)

All gold `--gold #b9985d` on cream `#f4efe5` (2.37:1) or paper `#fbf8f2` (2.56:1), bold 11.2–11.5px, where 4.5:1 is required:

- `/`: `.eyebrow` ×7 (hero, What Courtside is, Featured trip, panel "Invitation only", 2027 Founding Season, How it works is on the dark band and passes, Meet the pros), `.pillar .path-number` ×3 (2.37:1), `.steps .path-number` ×3 on the dark band (4.44:1, just under), `.pro-role` ×3, and `.jeff-footnote` (muted on espresso, 3.68:1, Phase 1 footer).
- `/pros`: `.eyebrow` ×4 (intro + one per profile), `h3.profile-label` ×9 (About / On court / Trips per profile), `.jeff-footnote`.

Plan section 5 accepts gold eyebrows as brand "never the only carrier of information"; the `h3.profile-label` and `.pro-role` uses are new in Phase 2 and are the text itself. This is the one serious finding of the scan.

## Beyond the checklist

1. **`pros-page.js` re-renders `#prosRoot` on every load.** The module compares `template.innerHTML` with `root.innerHTML`; the committed region sits between two newlines inside `<div id="prosRoot">`, the template does not, so they never match and `replaceChildren` runs on every visit (`Element.prototype.replaceChildren` hook: `["prosRoot"]` at 390 and 1440). Its "nothing is touched" path never executes; `/pros#eva` lands correctly only because the fallback `scrollIntoView` fires. No visible flash was seen and images came from cache (no duplicate asset requests). Documented by the failing test "beyond: pros-page.js leaves the committed #prosRoot DOM alone".
2. **Waitlist note is not `aria-live`** (plan section 5). The `<details>` approach is sound (state is announced, content is in the DOM) but it is a deviation from the plan.
3. **Mobile page length.** At 390 the homepage is ~11,000px: each of the six waitlist cards has a 4:3 gradient panel (~260px of empty colour) above its text. A flatter aspect on phones would halve the season section.
4. **The Katie crop fetches the 960px variant everywhere.** `.crop-right` draws the photo at 200% width, so `sizes` is `200vw`/`64vw` and the 318 KB `play-katie-eva-clay-960.webp` is chosen even at 390px, on the homepage teaser and as the eager, high-priority first image on `/pros` (547 KB first view). A pre-cropped variant would be about a third of that.
5. **`/pros` has no `<link rel="preload">`** for its eager portrait (item 10), while `/` does.
6. **Phase 1 leftovers visible on the public pages**, unchanged in `style.css`: `.site-powered` "powered by tgl.rsvp" renders at 8.6–9px in the header and footer (hidden under 700px); `.jeff-footnote` is 3.68:1 on espresso. Both also appear on `/site`. The gate still loads the 213 KB original `courtside-lockup.png` (it moved as-is).
7. **Heading semantics on `/pros`:** `h3.profile-label` are headings styled as gold labels, and the trip card inside "Trips" uses another `<h3>` at the same level; axe did not flag `heading-order`, but the outline is flat.
8. **Header nav on phones:** `style.css` hides `.site-nav a` under 700px; `marketing.css` keeps only the pill. "Trips" and "Meet the pros" are not reachable from the header on a phone (the footer has "Meet the pros"; the teaser has a second link).
9. **`/privacy`** (out of scope): skip link targets `#top` on a `main` without `tabindex="-1"`, and the page has no `<h1>`.
10. **Copy:** the teaser heading reads "The people you’ll play with." (sentence case) while `/pros`'s `<h1>` is the lowercase brand line "the people you’ll *play with.*". Deliberate or not, worth a glance.
11. **Console:** no messages of any type on `/`, `/pros`, `/invite`, `/pros#eva` at 390 and 1440.
12. **Sheets-mode server (port 3000):** pages byte-identical to the branch files, redirects identical. Nothing was submitted there.

## Failures and repro

1. **axe `color-contrast` (serious) on `/` and `/pros`** — item 9.
   `npm run test:e2e` → "axe-core: no serious or critical violations…" fails; the diagnostics list each node. Or by hand: open `/`, inject `node_modules/axe-core/axe.min.js`, `axe.run()`. Nodes: the gold eyebrows, pillar/step numbers, `.pro-role`, `h3.profile-label`, `.jeff-footnote`.
2. **`/pros` first image not preloaded** — item 10.
   `curl -s http://127.0.0.1:<port>/pros | grep -c 'rel="preload"'` → 0 (on `/` → 1). Test "/pros at 390px: … first image eager + preloaded …" fails at "the first image is preloaded".
3. **README inaccuracies** — item 13.
   `ls public/js/home.js` → no such file; `grep -n 'dates' README.md` (line 55) vs `grep -n timing public/js/trips.js`; `grep -n Miami README.md` (line 176); `ls public/assets/derived | grep -c 1600` → 0. Test "documents /, /pros, /invite … every public/js file it names exists" fails on `home.js` and `dates`.
4. **`pros-page.js` re-renders on every load** — Beyond 1.
   Test "beyond: pros-page.js leaves the committed #prosRoot DOM alone" fails with `replaceChildren() calls on load: ["prosRoot"]`. By hand: before load, patch `Element.prototype.replaceChildren` to log, open `/pros`.

## Assumptions

- Decision-7 verdicts: a `$` hit is allowed only as "$2,995"; a `players` hit only as "4–12 players" (or the trust-row pair); a `star` hit only as "five-star" on a line that names La Finca, or the `pros:start` marker.
- The 1 MB budget was measured at DPR 1 for the whole page after scrolling (lazy images included); first-view and DPR 3 numbers are reported alongside.
- The smallest-text check excludes the Phase 1 `.site-powered`/`.powered` line (unchanged `style.css`), reported separately; the Georgia check reports `h3.profile-label` rather than failing it.
- axe ran with its default rule set (WCAG 2.x A/AA + best practice), at 1440 and 390, after every lazy image had loaded.
- The in-process mock server serves the same static files as the Sheets-mode server, so screenshots from it stand for both.

## Screenshots

All in `/private/tmp/claude-501/-Users-kc/f7a998c8-fdda-4c64-95a9-a7213f37aefa/scratchpad/qa-shots/` (full page; `tiles/` holds the viewport-sized crops used for review):

- `home-390.png` (390×10998), `home-1440.png` (1440×6672)
- `pros-390.png` (390×6791), `pros-1440.png` (1440×5128)
- `invite-390.png` (390×844), `invite-1440.png` (1440×900)
- `home-390-reduced-motion.png` (390×10998)

## Rerun

```bash
export PATH="$HOME/.local/bin:$PATH" && cd ~/Desktop/courtside
npm test                                   # 156 unit/API tests
npm run test:e2e                           # all e2e suites, public.test.js included (4 expected failures until fixed)
node --test tests/e2e/public.test.js       # this suite alone
E2E_SCREENSHOT_DIR=/path/to/shots node --test tests/e2e/public.test.js   # also writes the seven PNGs
node public/js/pros-page.js --check        # pros.html vs pros.js
git diff main -- public/site.html public/style.css public/js/gate.js     # must be empty
git diff main -- public/js/site.js         # three redirect lines only
```
