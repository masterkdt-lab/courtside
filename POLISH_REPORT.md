# Polish report (branch `polish`)

Date: 2026-10-22. Scope: the public pages `/` and `/pros`, plus the gate heading, privacy page and a designed 404, per `COURTSIDE_POLISH_BRIEF.md` and the approved `POLISH_PLAN.md`. Brand unchanged: cream and espresso, Georgia, the lockup, the existing photos, the "good places. better people." tone.

<!-- SCORES: filled in after the second jury run -->

## 1. Score change

| | Before | After |
| --- | --- | --- |
| Critic overall (blind subagent, 0.4 D + 0.3 U + 0.2 Cr + 0.1 Co) | 6.0 | _pending_ |
| Jury estimate (critic + 1.1) | about 7.1 | _pending_ |
| Design / Usability / Creativity / Content | 6 / 6 / 6 / 6 | _pending_ |
| Semantics · Animations · Accessibility · WPO · Responsive · Markup | 4 · 4 · 5 · 8 · 6 · 3 | _pending_ |

Cards: `JURY_BASELINE.md` (before) and `JURY_AFTER.md` (after). Both from fresh critics that saw only screenshots and the audit.

## 2. Lighthouse, mobile simulated

Lighthouse 13.5 through Playwright's Chromium, mobile form factor, simulated throttling, against the local server in mock mode. Before = branch `polish` at `8fcbad0` (the Phase 2 pages); after = the final commit of this branch.

| Page | Performance | Accessibility | Best practices | SEO raw | SEO without "is-crawlable" | LCP | CLS | TBT |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/` | 100 → 100 | 95 → 100 | 96 → 100 | 66 → 69 | 100 | 1.50 → 1.65 s | 0 → 0 | 0 → 0 ms |
| `/pros` | 100 → 100 | 95 → 100 | 96 → 100 | 66 → 69 | 100 | 1.58 → 1.73 s | 0 → 0 | 0 → 0 ms |
| `/invite` | 99 → 100 | 93 → 100 | 96 → 100 | 66 → 69 | 100 | 2.25 → 1.35 s | 0 → 0 | 0 → 0 ms |

SEO is capped by `noindex`: Lighthouse's "is-crawlable" audit fails by design on a private site, so the raw score cannot reach 90 while the site stays invitation-only. With that one audit excluded every page scores 100. The home and Pros LCPs are slightly slower than before because the largest image is now the clay-court crop instead of the small coast selfie; both are well inside the 2.5 s "good" band. JSON files: `/private/tmp/claude-501/-Users-kc/f7a998c8-fdda-4c64-95a9-a7213f37aefa/scratchpad/lighthouse-before/` and `…/lighthouse-after/`.

## 3. What changed and why

**Message and CTA hierarchy (brief item 1).** The hero now carries the H1, the tagline, two sentences ("Small tennis trips hosted by pros: great clubs, beautiful places, and the long lunch after. For the players they coach and the friends they bring.") and one button, "Enter invite code", with the text link "Don't have an invite code?" scrolling to the lineup. The eyebrow and the second hero button are gone. The header pill reads "Enter code" on every page and phones get Trips and Meet the pros on a second header row; a sticky "Enter code" bar appears on phones once the hero scrolls out. Each lineup card opens an inline waitlist capture for that trip; a general capture closes the page after the pros teaser. Every control's destination is in `POLISH_PLAN.md` section 2.

**Waitlist and logging (brief item 2).** `POST /api/waitlist` writes the Waitlist tab (timestamp, email, name, trip name, source) with the same validation, honeypot, rate limit and double-submit guard as the request route. `POST /api/event` writes `no_code_click`, `trip_card_open` and the server-side `waitlist_submit` to the Log tab. No third-party analytics; personal data goes only to the Sheet.

**Type and space (DESIGN.md).** Sixteen ad-hoc sizes became eight fluid steps that run from 390px to 1440px (first shipped with the wrong slope, caught by QA, corrected), plus two page-specific steps for the gate title and the five-word Pros title. A ten-step space scale replaced magic numbers, and sections use three rhythm moods. Paragraph measure is capped at 62 characters, display lines are balanced with a no-break space before the last word. A local `@font-face` with `size-adjust` keeps Georgia's measure on Android, where Georgia does not exist.

**Contrast (APCA and WCAG).** Gold text on cream is `#7d6236` (4.99:1, about Lc 70) and on the espresso band `#c9a86a` (5.9:1); the brand gold stays for rules and ornament. The first candidate, `#8a6d3c`, measured 4.22:1 and was replaced after QA.

**Images.** Named crops generated with sharp from the originals: a 3:2 and a 4:5 hero crop of the clay-court photo, a 3:4 portrait of each player (Katie left, Eva right, per `public/assets/PHOTOS.md`), a 4:3 Spain card, a small square of the coast photo for the "A pro hosts it" column. Every image has width, height, alt and the right `sizes`, so phones never fetch a variant wider than they draw. The eager portrait on `/pros` is preloaded; the late-repaint the baseline measured came from the full-size clay file and the undimensioned lockup, both gone.

**Motion.** One hero settle on load in CSS; hover and focus treatments per role (buttons flood and rise with a travelling arrow, nav links draw an underline, cards lift and their photo scales, the logo scales, footer links change colour); native cross-document view transitions at 220ms with the opt-in inline in each page head (the external-stylesheet opt-in made Chrome abort every navigation with a console error). Nothing on scroll, no loader, no library, and nothing under reduced motion.

**Housekeeping from the jury.** A designed 404 served with a 404 status; Open Graph and Twitter tags with 1200×630 images, a favicon and touch icon, canonical links; the gate inside `<main>` with its own H1 "Enter your invitation."; privacy in the serif with proper heading levels; the duplicate "people you'll play with" line replaced on the home teaser; tap targets padded; the "powered by" credit footer-only on the public pages. Placeholders are hidden on `/pros` (section 4).

## 4. Placeholders, every one, and its decision

Hidden in production (the data stays in `public/js/pros.js` with `placeholder: true`, and renders the moment the flag is removed):

| Pro | Hidden rows |
| --- | --- |
| Katie Delich | home base; playing level and coaching facts; bio; two on-court lines (playing level, coaching) |
| Eva | home base; playing level and coaching facts; bio; two on-court lines |
| Nelson Ramos | role; home court, hosts, playing level and coaching facts; bio; three on-court lines; photo (monogram shown) |

Shown as honest "To be announced": the place of the fall offseason residency, and every lineup detail KC did not give for Charleston, Geneva, Mallorca, New York and Los Angeles beyond their timing.

Still visibly marked: the privacy page's note "Final wording to come from Courtside Travel Co.", now a muted line rather than a red pill, until the wording arrives.

Not invented anywhere: prices, dates, guest counts, ratings, years. The only numbers on the public pages are the three the source already carried: 4–12 players, from $2,995 for Spain, five-star for La Finca.

## 5. Raw material still wanted from Katie (follow-ups, not blockers)

- The exact invitation text she sends by iMessage or DM, so the homepage and gate copy continue that conversation.
- A voice memo or call notes about the trips and the people, for bios and section copy in her cadence.
- Full-resolution originals of every photo, and anything else from Spain, viewed as a contact sheet; one or two frames with a clear court and a clear face would replace the current hero crop.
- Real bio and on-court facts for Katie, Eva and Nelson; Eva's surname; Nelson's role and a photo.
- Which photos are cleared for public use, and a confirmation of who is who in `life-eva-paella.jpg` (see section 7).
- The final privacy wording.
- The real domain, so the canonical and Open Graph URLs can be swapped from `courtside-ivory.vercel.app`.

## 6. Validation

- **Tests**: `npm test` 196 of 196 (40 new for the waitlist and event routes, the store and the 404). `npm run test:e2e` 91 of 91: the Phase 2 suites updated for the approved design, plus `tests/e2e/polish.test.js` with 24 checks covering the hero, the CTA map, the capture and event flow against the mock Sheet, hidden placeholders, the crops and who is in them, the no-invented-claims grep, the type and space tokens, axe on five pages at two widths, keyboard and focus, hover treatments, motion and reduced motion, 404 and metadata, the brand diff against `main`, and page weight.
- **axe-core**: zero serious or critical violations on `/`, `/pros`, `/invite`, `/privacy` and the 404 at 390 and 1440, contrast included.
- **Jury evidence, after**: 0 console errors, 0 overflow, CLS 0, 60 fps on every page; audit 0 FAIL and 4 WARN (was 1 FAIL and 37); the two remaining WARNs are the en dashes in the Spain dates, which are KC's content, and the absence of a sitemap, which a noindex site does not want.
- **Page weight at 390**: `/` 184 KB first view, 258 KB whole page at 1×; `/pros` 186 KB and 209 KB; no third-party requests; one module script.
- **Brand diff**: `public/style.css` and `public/js/gate.js` byte-identical to `main`; `public/site.html` differs by one inline line, the view-transition opt-in; `public/js/site.js` only in the three redirect targets from Phase 2.
- **Screenshots** (`/private/tmp/claude-501/-Users-kc/f7a998c8-fdda-4c64-95a9-a7213f37aefa/scratchpad/`): `before/` holds the baseline hero frames at 1440, 390 and reduced motion; `qa-polish/` holds the after frames (`after-home-390.png`, `after-home-1440.png`, `after-pros-390.png`, `after-pros-1440.png`, `after-invite-390.png`, `after-invite-1440.png`, `after-home-390-reduced.png`, `after-pros-390-reduced.png`), the device frames (`device-iphone14.png` from WebKit, `device-pixel7.png`, `device-windows-1440.png`) and the squint pair (`squint-home-390.png`, `squint-home-1440.png`: the headline and one dark button are the only shapes that survive the blur at both widths).
- **Device caveats**: the iPhone frame is real WebKit; the Pixel frame is Chromium with the Pixel 7 descriptor and the fallback serif forced, but this Mac has none of the Android serifs, so `size-adjust` itself could not be exercised; the Windows frame is Chromium with a Windows user agent on macOS. One screenshot each from a real iPhone and Android phone on the preview URL would close that gap.
- **Known tool artefacts**: the capture tool reports "no hover change" on the dark band's "Enter it here" pill and "invisible focus" on the featured card's link; a direct Playwright check shows the pill floods cream and rises 2px on hover, and the card's focus ring sits on its frame by design.

## 7. Open questions for KC

1. **Who is in `life-eva-paella.jpg`?** Its alt from the prototype says Eva, but the frontend agent judged the person closer to the left-hand clay player, who per your note is Katie. The photo is now off the public pages, so nothing is wrong on screen; confirm before it is used again, and `PHOTOS.md` will be updated.
2. **Phone hero is copy-first.** At 390px the first viewport is the headline, the tagline, the two sentences and the button; the court photo begins just below. The squint test passes, and it keeps the one-button rule, but if you want the photo in the first phone viewport the hero becomes a photo-over-text frame, which costs legibility. Default kept as built.
3. **The gate's two smallest texts** (the "powered by" corner at 9px and the code hint at 12.5px) come from the frozen Phase 1 stylesheet. Leaving them was deliberate to keep the gate byte-identical; say the word and they lift to the scale's smallest step.
4. **Nelson's profile** is name, monogram and "Trips to be announced" until a role and photo exist. The critic would rather he were not listed yet; the brief keeps him. Your call either way.

## 8. Scripts for after launch

### 8.1 Five-second test and first-click test (six people Katie recruits)

Run one person at a time, on their own phone, over a short call or in person. Do not explain the site first. Record answers verbatim.

1. Say: "I'm going to show you a web page for five seconds. Then I'll ask what you remember." Send the link to `/`. Count five seconds from when the page is visible, then ask them to lock the phone.
2. Ask, in this order, and write down exactly what they say:
   - "What is this?"
   - "Who is it for?"
   - "What would you do next on it?"
   - "What's one thing you remember seeing?"
3. First-click test. Say: "Open it again. Imagine Katie sent you a code and you want to use it. Tap the first thing you'd tap." Note what they tapped. Then: "Now imagine you don't have a code but you're interested in Charleston. Tap the first thing you'd tap." Note it.
4. Ask one open question: "Anything confusing, or anything you'd want to know before you'd sign up?"

Scoring, target five of six on each line:
- Understood: the answer to "What is this?" mentions tennis trips and a host, pro or Katie.
- Audience: "Who is it for?" mentions tennis players, Katie's people, or friends.
- Action: "What would you do next?" mentions entering a code or joining a waitlist.
- First click, with code: the hero button, the header pill or the sticky bar.
- First click, no code: "Don't have an invite code?", a lineup card's "Join the waitlist", or the general waitlist button.

Record results in a six-row table (person, understood, audience, action, click 1, click 2, note). Anything two or more people trip on becomes the first fix of the next pass.

### 8.2 Katie's read-aloud

Send Katie the homepage and the Pros page and ask her to read every sentence aloud, on a call, without preparing. Note each place she:
- changes a word without noticing (that is her phrasing; adopt it),
- stumbles or re-reads (rewrite the sentence),
- says "I wouldn't say that" (cut or rewrite in her words),
- laughs or says "yes, exactly" (keep).
Then ask: "If you were texting this to a friend you want on the trip, what would you say?" Use that line as the model for the hero's two sentences and the gate's intro.

### 8.3 Reading the numbers after two weeks

From the Sheet's Log tab and the Waitlist tab, two weeks after launch and two weeks after the last change, compare:
- code attempts (`ok` + `invalid` + `paused` + `used_up`) and the share that are `ok`,
- `no_code_click` per homepage visit (homepage visits are not logged; use `no_code_click` against `ok` entries as a ratio),
- `trip_card_open` per trip, and `waitlist_submit` per trip and `general`,
- Waitlist rows per week.
A rising share of `ok` codes and more waitlist rows per week than before is the result; a trip with many opens and few submits needs a better card or a clearer form.
