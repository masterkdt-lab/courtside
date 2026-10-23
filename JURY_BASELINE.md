# Courtside Travel Co.: jury score (baseline, before polish)
Estimate, not affiliated with Awwwards. Independent critic (a fresh subagent that saw only screenshots and the audit), from 5 pages (home, pros, invite, privacy, 404) on 2026-10-22, branch `polish` at `ec29a44`, served locally in mock mode on 127.0.0.1:4400. The Vercel preview could not be scored: it sits behind Vercel deployment protection, which the critic's browser reads as a login wall.

**The idea, as the critic read it:** an invitation-only tennis-travel club where a pro, Katie Delich, hosts groups of 4–12 for week-long stays at a real club abroad, starting with a seven-week Spanish offseason at Club de Tenis Almoradí; clear from the hero and the first scroll, but as a web concept "an editorial brochure with a code gate, not an interaction idea".
**Critic overall: 6.0** (0.4 Design + 0.3 Usability + 0.2 Creativity + 0.1 Content, on the critic's strict scale)
**Jury estimate: about 7.1** (critic + 1.1, measured on two recent Sites of the Day)
**Band, from the estimate:** Honorable Mention range (6.5 to 7.1), at its top edge

| Criterion | Score | Evidence |
|---|---|---|
| Design (40%) | 6 | For: a real type system (serif display with one italic rust word, tracked gold eyebrows, sans body, pills) and a consistent palette across `home/d-01`, `pros/d-01`, `invite/d-01`; the invite split is the one composed frame. Against: a grainy phone selfie as the first frame (`home/d-01-hero.png`); six empty gradient blocks with the city printed three times (`home/d-05`, `d-06`); the pros hero leaves the right 55% empty (`pros/d-01`); the privacy h1 in bold sans; a server-default 404; hovers barely register (`home/h-01`, `h-02`). |
| Usability (30%) | 6 | For: mobile LCP 624–808 ms, CLS 0, 60 fps, no overflow, skip link first on home/pros/privacy. Against: `home/report.json` `keyboard.stuck: true` on three waitlist `summary` stops; invisible focus on "Enter with your invitation" (home ×1, pros ×2); the phone header drops Trips and Meet the pros with no menu (`home/m-01`); `noHoverChange` 4/3/3; the 404 has no way back. |
| Creativity (20%) | 6 | Known patterns competently assembled (split hero, three pillars, stat strip, featured card, 3×2 grid, dark band, team cards). The invitation framing is specific and carried in the copy, but drives no layout, motion or signature moment; page changes are hard cuts (`home/d-90-*` identical to `d-91`); nothing moves at rest. |
| Content (10%) | 6 | For: specific, honest copy with voice and real photos of Katie and Eva. Against: the pros page is mostly placeholders ("Bio to come" ×3, "To come" ×10, "Photo to come", "Role to come"); the privacy page carries a red placeholder pill; one sentence repeated six times on home; the pros meta description runs 208 characters. |

| Developer | Score | Evidence |
|---|---|---|
| Semantics/SEO | 4 | audit FAIL: `/invite` has no `<main>`; no canonical anywhere; privacy skips h1→h3; the 404 has no h1, title or lang; `/invite` reuses the home h1 text. Unique titles per page keep it off the floor. |
| Animations/Transitions | 4 | No page transition; logo, Trips and the header CTA do not react to the pointer on any page; every remaining CTA is a colour-only change (`home/h-01`, `h-02`, `pros/h-01..03`, `invite/h-01`). Only smooth 60 fps scroll passes. |
| Accessibility | 5 | axe serious on every page: `color-contrast` ×16 home, ×14 pros, ×2 privacy, ×1 invite (gold `#b9985d` on cream at 2.37–2.56:1); 404 adds `document-title` and `html-has-lang`; keyboard stuck on home; invisible focus ×3; no skip link on invite or 404. Passes: nothing hidden or moving under reduced motion, visible focus on nav. |
| WPO | 8 | Throttled-phone LCP 624–808 ms, CLS 0, 0 KB JS, 8 KB CSS gzipped, heaviest page 688 KB, 60–61 fps. Note `pros` `settledMs` 4191 and `invite` 3419: the first screen keeps repainting for about 3 s after it is readable. |
| Responsive | 6 | No overflow; phone frames composed, not squished. Misses: "Enter it here." 89×18 px, nav links 42×17 and 115×17 px; two of three nav links vanish on phones; `pros/m-01` h1 breaks "you'll play / with."; an 870 px "NR" gradient block on `pros/m-05`; the invite footer orphans "2027". |
| Markup/Meta-data | 3 | No og:title, og:description, og:image or twitter:card on any page; no favicon; the invite lockup `<img>` has no width/height. |

## Fixes, most score first (the critic's list, verbatim in substance; `POLISH_PLAN.md` section 7 maps each to a step or a decision)
1. [Animations, Usability, Design] Hover and page transitions on all pages: logo, Trips and the header CTA change nothing; pills only lighten. Flood the outline pill to solid espresso and the solid pill to a darker tone with a 2 px rise; draw a 1 px underline in from the left on text nav; add a 300 ms cross-fade under the persistent header so a click is not a hard cut.
2. [Content, Design] Placeholders on pros and privacy: write Katie's and Eva's bios, delete stat cells with no value instead of printing "To come", remove Nelson's profile until there is a photo and a role, remove the privacy pill.
3. [Usability, Responsive] Phone navigation: the 390 px header keeps only the pill; add Trips and Meet the pros as a second row under the logo, or a menu button.
4. [Accessibility, Usability] Keyboard: Tab cannot leave the waitlist `details/summary` cards on home; replace with a real `<button aria-expanded>`. Apply the nav's 2 px espresso ring to "Enter with your invitation".
5. [Semantics, Accessibility, Design] A real 404 in the site shell with a way back and a 404 status.
6. [Markup] Share metadata on all pages: one 1200×630 OG image, per-page og:title/description, `twitter:card`, a favicon and apple-touch-icon; width/height on the invite lockup.
7. [Semantics] Wrap the gate in `<main>` and give `/invite` its own h1; canonical links and a sitemap; pros meta description under 160 chars; privacy h3 → h2.
8. [Accessibility] Darken gold text to about `#8a6d35` on cream, keep the lighter gold for rules; lift `.jeff-footnote` to about `#a89b92` on the footer.
9. [Design] Home lineup cards: six gradient blocks say the city three times; use a real place photo or a 120 px tinted strip with the month, and say the city once. Put the clay-court shot in the hero and move the selfie, small, to the "A pro hosts it" pillar.
10. [Design] Pros hero: the right 55% is empty; pull the three portraits into the hero as a column, or set the h1 across the full measure.
11. [Design] Privacy h1 in the serif display with an italic word, like every other page.
12. [Responsive] Tap targets: pad nav links to 32 px tall, make "Enter it here." a small outline pill; after an anchor jump the link sits under the sticky header.
13. [Design] "powered by tgl.rsvp" sits in the header corner of every page and again in the footer; keep it in the footer only.
14. [Responsive] Line breaks: "play with." should not split on the pros h1 at 390; the invite footer orphans "2027".
15. [WPO] Late repaint: pros `settledMs` 4191 and invite 3419 against LCPs under a second; check the serif swap and the lockup without dimensions.
16. [Content] "The people you'll play with." is both the home teaser heading and the pros h1; give the home section its own line.

## Measured
Mobile LCP: home 752 ms, pros 808, invite 648, privacy 624. CLS 0 on every page (desktop invite 0.013). Loader: none. FPS 60–61 desktop and throttled phone. axe serious: color-contrast 16/14/1/2 nodes on home/pros/invite/privacy, plus document-title and html-has-lang on the 404. Overflow: none. `noHoverChange`: home 4, pros 3, privacy 3. `colorOnly`: home 2, pros 3, invite 2. Idle motion: false everywhere. Audit: 1 FAIL (`/invite` no main landmark), 37 WARN (og/twitter tags and favicon on four pages, canonical, sitemap, three repeated sentences on pros, en dashes on invite and privacy, privacy heading skip, invite lockup without dimensions, 404 without h1). Heaviest page `/` about 688 KB, JS 0 KB gzipped, CSS 8 KB gzipped.

Not scored: anything stills can't show (how motion feels, sound).
