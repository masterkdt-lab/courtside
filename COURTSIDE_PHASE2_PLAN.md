# Courtside Travel Co. — Phase 2 Plan: public homepage + Meet the Pros

Audience: Claude Code agents working in this repo. Owner: KC. Status: awaiting KC's approval; nothing is built until he says go.
Read `COURTSIDE_PHASE1_PLAN.md` first for the architecture, the gate, the Sheet and the tooling. This plan adds two public pages in front of the existing invite gate and changes nothing about requests, email, payments or the domain.

## 1. Mission

1. A public homepage at `/` that sells Courtside and points invited guests to the gate.
2. A "Meet the Pros" page at `/pros` with Katie's full profile and a data-driven template for more pros.
3. Design that matches the existing brand exactly (the Spanish Offseason page is the reference), mobile first, fast, accessible, noindex kept.
4. The existing gate keeps working, including personal links already sent.

Non-goals: no waitlist backend, no email, no payments, no domain, no changes to `/site`, the API, the Sheet or the request flow. Nothing copied from Airbnb: patterns only, all code, copy and images ours.

## 2. What exists (as of commit 6de91fa on `main`)

- `public/index.html` is the invite gate; `public/js/gate.js` posts to `/api/code` and goes to `/site` on success; personal links are `/?invite=CODE` (alias `?code=`).
- `public/site.html` + `public/js/site.js` is the protected Spanish Offseason page. On a 401 it sends the browser to `/`.
- `middleware.js` redirects `/site` and `/site.html` to `/` without a valid cookie. `scripts/dev-server.js` mirrors that and maps `/` → `index.html`, `/privacy` → `privacy.html`.
- `public/style.css` (71 lines, 22 KB) holds the brand: tokens on `:root`, `.site-header`, `.site-nav`, `.invite-pill`, `.primary`, `.secondary`, `.eyebrow`, `.caps`, `.section`, `.section-inner`, `.section-head`, `.media-card` (+ `.shade`, `.overlay`), `.path-card`, `.quickfacts`, `.footer`, `.hero`, breakpoints at 1050px and 700px, reduced-motion guards.
- Assets (`public/assets/`): `courtside-lockup.png` (880×355), `courtside-lockup-footer.png` (743×269, for dark backgrounds), `katie-eva-coast.jpg` (768×1024), `play-katie-eva-clay.jpg` (960×2042), `life-eva-paella.jpg` (768×1024), `life-friends-court.jpg` (1024×768), `life-friends-family.jpg` (1120×700). EXIF already stripped. Three remote images stay in `public/js/images.js` for `/site` only; the public pages use local assets only.
- Tests: 150 unit/API (`npm test`) and 38 e2e (`npm run test:e2e`, Playwright Chromium). Several assert the gate is at `/`; they change in this phase.
- Deploy: Vercel project `courtside`, production from `main`, preview per branch. Preview has no env vars, so the gate's API returns 500 on preview URLs until they are added.

## 3. Decisions (KC confirms or changes before go)

1. **The gate moves to `/invite`.** `/` becomes the homepage. Old links keep working: middleware (and the dev server) redirect `/?invite=CODE` and `/?code=CODE` to `/invite?invite=CODE`. `/site` without a cookie now redirects to `/invite`. README's personal-link format becomes `https://<domain>/invite?invite=CODE`.
2. **Upcoming trips on the homepage: the 2027 Founding Season** (KC, 2026-10-22). The featured trip is The Spanish Offseason (invitation only). The upcoming cards, all "Waitlist", in this order:
   - *Charleston* · late March + early April 2027 · a local green-clay week + the Charleston Open
   - *Geneva* · May 2027
   - *Mallorca* · June 2027
   - *New York* · the full US Open window, 2027
   - *Los Angeles* · the Laver Cup, September 24–26, 2027
   - *Fall offseason residency* · destination shown as "To be announced" · October to the week before Thanksgiving, 2027
   No Miami. Dates and descriptions exactly as above; where KC gave no detail, the card carries only place and timing. None of these has a photo in the repo: those cards use the gradient panel, never a Spain photo and never a stock image. All live in `public/js/trips.js`.
3. **"Join the waitlist" placeholder.** The button reveals an inline note: "Waitlist opens soon. Invitations go out first; check back or ask Katie." No form, nothing stored.
4. **Pros: three full profiles** (KC, 2026-10-22), each from the same template in `public/js/pros.js`:
   - **Katie Delich** (spelled *Delich*, everywhere, always): founder + host, hosts The Spanish Offseason; portrait from `play-katie-eva-clay.jpg`; bio and unknown facts as marked placeholders.
   - **Eva**: co-host of The Spanish Offseason, Club de Tenis Almoradí; linked to the Spain trip; portrait from `life-eva-paella.jpg` ("Eva with paella by the water"); surname unknown, so the name is "Eva" until KC supplies it; bio and facts placeholders.
   - **Nelson Ramos**: no trip assigned yet, so the trips block reads "Trips to be announced"; no photo in the repo, so the portrait is a brand-coloured monogram panel; bio and facts placeholders.
   The homepage teaser shows all three as small cards linking to `/pros#katie`, `/pros#eva`, `/pros#nelson`.
5. **Images.** Add `sharp` as a devDependency and `scripts/make-images.js`, which writes resized WebP and JPEG variants (widths 480, 960, 1600) into `public/assets/derived/` from the five photos, metadata stripped. Pages use `srcset`/`sizes`, explicit width/height, lazy loading below the fold. Originals untouched. If `sharp` will not install on this Mac, the pages fall back to the originals and the report says so.
6. **Public header and footer.** A shared header for the public pages: logo → `/`, nav "Trips" (`/#trips`), "Meet the pros" (`/pros`), and a pill "Have an invitation?" → `/invite`. The footer is the existing one plus links to Pros, Privacy and the gate. The gated `/site` header is unchanged.
7. **No invented claims** (KC, 2026-10-22). The public pages may state a guest count, a price or a "five-star" claim only if the repo's source content, `public/site.html`, already says it. The allowed facts are exactly: "4–12 players" (private groups, from the quick facts and the path card), "from $2,995" as the "6-night player base" for The Spanish Offseason, and "five-star" for La Finca Resort ("Five-star home base"). "8–12 guests" is not in the source and must not appear. Anything else about group size, pricing, ratings, experience, credentials or dates that KC did not give is shown as a visible placeholder (`.placeholder` style, text like "Details to come") or left out. The QA agent greps the public pages for `\$`, `guests`, `players`, `star` and checks every hit against this list.
8. **Homepage CTAs** (KC, 2026-10-22). The hero's primary button "See The Spanish Offseason" scrolls to the featured trip section `#trips` (smooth unless reduced motion). Only the featured card's "Enter with your invitation" link, and the header pill, go to `/invite`.
9. **Branch and preview.** Work goes on branch `public-pages`, pushed to GitHub, never `main`. Vercel builds a preview per push. I add the five non-secret env vars to the Preview environment so the preview matches production; the two secrets are only needed if KC wants to test the gate on the preview URL (same two commands as before with `preview` instead of `production`). The gate is also verified locally in mock mode.

## 4. Pages

### 4.1 Homepage `/` (`public/index.html`, `public/js/home.js`, `public/js/trips.js`)

Order, top to bottom. Copy is written fresh in the existing voice: lowercase italic serif lines, short sentences, "Katie" not "our team".

1. **Public header** (decision 6). Skip link to `#main`.
2. **Hero**: full-bleed photo (`katie-eva-coast.jpg` at desktop, cropped via `object-position`; eager, `fetchpriority="high"`, preloaded). Eyebrow "Tennis-pro-hosted travel". H1 "tennis takes you *further.*" (the gate's line, so the brand reads the same from first touch to gate). Italic serif line "good places. better people." One-sentence intro. Two CTAs: primary "See The Spanish Offseason" → `#trips` (decision 8), secondary "Meet the pros" → `/pros`.
3. **What Courtside is**: three short columns on cream: *A pro hosts it* (Katie, on court with you), *Small by design* (groups of 4–12 players for private weeks, the only group size in the source), *Real places* (a real club, a real town, long lunches). Under them a quiet trust row reusing `.quickfacts`: "Hosted by Katie Delich", "4–12 players", "Club de Tenis Almoradí", "La Finca Resort".
4. **Featured trip** (`#trips`): one big photo card (`.media-card` pattern, `play-katie-eva-clay.jpg`), overlay: "Invitation only" tag, "The Spanish Offseason", "Costa Blanca, Spain · Winter 2027 · seven Sunday–Saturday weeks · from $2,995 per player, six nights". Below: two lines of description and the primary link "Enter with your invitation" → `/invite`.
5. **Upcoming trips, "2027 Founding Season"**: a grid of cards from `trips.js` (decision 2), each with place, timing, the one-liner KC gave if any, a "Waitlist" tag and a "Join the waitlist" button (decision 3). None has a photo: each uses a sage/espresso gradient panel with the place name in italic serif.
6. **How it works**: three numbered steps in `.path-card` style: *01 Get your invitation* (Katie invites her community first), *02 Choose your week, or let Katie curate your group*, *03 Katie confirms the details with you*. The step copy links to `/invite` once.
7. **Meet the pros teaser**: three small cards (Katie, Eva, Nelson Ramos: portrait or monogram, name, role, one line) → `/pros#katie`, `/pros#eva`, `/pros#nelson`.
8. **Footer** (decision 6).

`trips.js` exports an array: `{ id, name, place, dates, blurb, status: 'invitation' | 'waitlist' | 'announced', price, photo: { src, alt } | null, link }`. The homepage and the Pros page both read it so Katie's "trips she hosts" never drifts from the cards.

### 4.2 Meet the Pros `/pros` (`public/pros.html`, `public/js/pros.js`, `public/js/pros-page.js`)

1. Public header, skip link.
2. Intro band: eyebrow "Meet the pros", H2 "the people you'll *play with.*", one sentence on why a pro hosts every Courtside trip.
3. One profile section per pro from `pros.js` (decision 4: Katie Delich, Eva, Nelson Ramos), each with an `id` for `/pros#katie`, `/pros#eva`, `/pros#nelson`:
   - Portrait in a rounded `.media-card` (or the monogram panel when `portrait` is null), name, role, home base, and a row of trust facts (`.quickfacts` style). Facts we do not have are shown as marked placeholders, never invented.
   - "About" with the bio placeholder text, clearly marked "Bio to come".
   - "On court": level/coaching facts as placeholders; for Katie and Eva, the Club de Tenis Almoradí partnership and that they co-host The Spanish Offseason.
   - "Trips": cards built from `trips.js` filtered by the trip's `hostIds`; when none, the block reads "Trips to be announced".
   - CTA: "Have an invitation?" → `/invite`.
4. Footer.

`pros.js` exports an array of `{ id, name, role, base, portrait: { src, alt, position } | null, facts: [{ label, value, placeholder: boolean }], bio: { text, placeholder: boolean }, onCourt: [{ text, placeholder: boolean }], links: { instagram?: string } }`; trips carry `hostIds` (Spain: `['katie', 'eva']`). The file includes a commented template entry. `pros-page.js` renders it; the HTML contains Katie's section server-side-free but fully, so the page reads without JS and JS only fills in from the data file (progressive enhancement: the markup is generated at build time by the agent from the data file and committed; `pros-page.js` re-renders from the same data so they cannot drift, and a test asserts the committed markup matches the renderer's output).

### 4.3 Gate `/invite` (`public/invite.html`, `public/js/gate.js`)

The current `index.html` moved as is, plus a small "← Courtside" link to `/` in the gate's top bar, `<title>` "Enter your invitation — Courtside Travel Co.". `gate.js` unchanged except a comment update. Success still goes to `/site`.

## 5. Design rules (top priority)

- Only the existing tokens: `--cream #f4efe5` page background, `--paper` for cards, `--espresso` for dark bands and primary buttons, `--gold` for eyebrows, `--clay` for emphasis and tags, `--sage` sparingly. Georgia serif for headings with the existing negative tracking and `font-weight:400`; the system sans stack for everything else. No new fonts, no webfont loads.
- Reuse existing classes before writing new ones. New components go in `public/marketing.css`, loaded after `style.css` by the three public pages only, written mobile-first (base styles for phones, `min-width` queries at 700px and 1050px to match the existing breakpoints).
- Photo cards: `border-radius:26px`, gradient shade, white overlay text in italic serif, tags as `.caps` pills. Buttons are the existing `.primary` / `.secondary` pills. Section rhythm is the existing `clamp(70px,9vw,140px)`.
- Patterns borrowed from Airbnb: large photo-led trip cards with place/dates/price line, a host profile block with portrait + trust facts, a "how it works" strip. Nothing else: no Airbnb code, icons, images, names or layouts copied.
- Accessibility: landmarks, skip link, one H1 per page, `:focus-visible` rings on links and buttons (add to `marketing.css`), alt text on every image, 44px minimum touch targets, colour contrast AA for body text (ink/muted on cream), gold eyebrows stay as the brand but are never the only carrier of information, reduced-motion respected, the waitlist note is `aria-live`.
- Fast: no JS required to read either page; `home.js` only wires the waitlist notes; images via `srcset` with lazy loading below the fold; hero preloaded; no third-party requests.
- Noindex on both pages (`<meta name="robots" content="noindex,nofollow">`), `robots.txt` unchanged.

## 6. Platform changes

- `middleware.js`: matcher adds `/`; on `/` with `invite` or `code` in the query → 302 to `/invite` with the same query; otherwise `next()`. `/site` and `/site.html` unauthenticated → 302 `/invite`.
- `scripts/dev-server.js`: pages `/` → `index.html`, `/invite` → `invite.html`, `/pros` → `pros.html`, `/privacy` → `privacy.html`; `/marketing.css` whitelisted; `/assets/derived/` served; the same query redirect on `/`; the guard redirect target `/invite`.
- `public/js/site.js`: the three `location.replace('/')` become `/invite`. `public/privacy.html`: header logo → `/`, add the public nav.
- `package.json`: `sharp` devDependency, `"images": "node scripts/make-images.js"`.
- README: pages list, gate URL, personal-link format, `npm run images`.
- Tests: dev-server and e2e updated for the new map (`/` 200 homepage with noindex and no gate form, `/invite` 200 gate, `/?invite=X` → 302 `/invite?invite=X`, `/site` → 302 `/invite`, `/pros` 200 noindex, `/marketing.css` text/css, `/assets/derived/*` 200, `/index.html`/`/invite.html`/`/pros.html` 404 on the dev server). New e2e: both pages at 390px and 1440px have no horizontal scroll, every image has alt, one H1, skip link works, keyboard reaches every CTA, the gate flow still passes end to end from `/invite` and from `/?invite=GUEST1`, and an axe-core scan of `/` and `/pros` reports no serious or critical violations.

## 7. Agents and waves

Orchestrator: the main session. Branch `public-pages` from `main`. Commit after each wave. Push after Wave 3. Nothing goes to `main`.

| Agent | Owns | Job |
| --- | --- | --- |
| orchestrator (Wave 0) | branch, `package.json`, `scripts/make-images.js`, `public/assets/derived/` | Create the branch, install `sharp`, generate the image variants so both page agents can reference real files. |
| `home-page` (Wave 1) | `public/index.html`, `public/invite.html`, `public/marketing.css`, `public/js/home.js`, `public/js/trips.js` | Section 4.1, 4.3 and the shared public header/footer markup, documented in its final message for the pros agent. |
| `platform` (Wave 1) | `middleware.js`, `scripts/dev-server.js`, `public/js/site.js`, `public/privacy.html`, `tests/**`, `README.md` | Section 6, including the test updates and the new platform tests; keeps `npm test` and `npm run test:e2e` green against the home-page agent's files once both are in. |
| `pros-page` (Wave 2) | `public/pros.html`, `public/js/pros.js`, `public/js/pros-page.js`, additions at the end of `public/marketing.css` | Section 4.2 using the header/footer and card components from Wave 1. |
| `qa` (Wave 3) | `tests/e2e/public.test.js`, `QA_REPORT_PHASE2.md`, screenshots in the scratchpad | Runs everything, the section 6 e2e list, axe, keyboard pass, 390/1440 screenshots of `/`, `/pros` and `/invite`; records pass/fail with evidence; fixes nothing. |

Shared rules: read both plan files first; stay in owned paths; no secrets, no email, no deploy, no `main`; do not change the gate's behaviour or the API; final message lists what was built, skipped, assumed, and how to verify.

## 8. Done when

- [ ] `npm test` and `npm run test:e2e` pass
- [ ] `/` is the homepage with all eight sections, noindex, no gate form; `/pros` renders Katie from `pros.js`; `/invite` is the gate, unchanged in behaviour
- [ ] `/?invite=GUEST1` and `/invite?invite=GUEST1` both enter; `/site` without a cookie lands on `/invite`
- [ ] Both pages: no horizontal scroll at 390px, one H1, skip link, alt on every image, keyboard reaches every CTA, axe reports no serious/critical issues
- [ ] No request leaves the page to a third party; total transfer for `/` on mobile under 1 MB with images
- [ ] Only brand tokens used; no new fonts; the gated `/site` page is byte-identical except the three redirect targets in `site.js`
- [ ] Branch `public-pages` pushed; preview URL reported with desktop and mobile screenshots of both pages
