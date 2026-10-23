# Courtside Travel Co. — design system (extracted, not invented)

Branch `polish`. This documents the system the public pages already use, read out of `public/style.css`, `public/marketing.css` and the rendered pages, plus the corrections the polish pass makes. The brand is locked (KC, 2026-10-22): cream and espresso palette, Georgia serif, the lockup logo, the existing photos, the "good places. better people." tone. Nothing here introduces a new font, colour family or image source.

## Brief

- **Subject**: Courtside Travel Co., small tennis trips hosted by a pro, built around Katie Delich, Eva and Club de Tenis Almoradí. First trip: The Spanish Offseason, Costa Blanca, winter 2027. Six more Founding Season destinations on a waitlist.
- **Audience**: affluent tennis players in Katie's orbit, most arriving on a phone from a text or DM, many with an invite code already.
- **Job of the public pages**: understood in five seconds; then one action. Invited: enter the code. Not invited: join a waitlist. Everyone: learn who Katie is.
- **Tone**: lowercase italic serif taglines, short sentences, "Katie" not "we", no exclamation marks, specific nouns, numbers only when true.

## Concept card (the existing idea, stated so the critic's reading can be compared)

```
Idea:        A pro invites you to play where she plays: her club, her coast, her friends.
Metaphor:    A handwritten invitation, not a brochure. Paper, warm light, one voice.
Signature:   The hero settles into place like a card laid on a table: photo shade lifts,
             lines rise, the button arrives last. Once, on load, CSS only.
Emotion:     Calm, personal, slightly exclusive. "This is real and it's for me."
Motion verb: settle like paper. Short, eased, never bouncy; things arrive, they do not fly.
Screenshot:  The hero at 1440: the coast photo, "tennis takes you further." and one button.
```

## Palette (existing tokens, roles named)

| Token | Hex | Role |
| --- | --- | --- |
| `--cream` | `#f4efe5` | ground |
| `--paper` | `#fbf8f2` | raised cards, alternate bands |
| `--espresso` | `#39261d` | ink for display, primary buttons, dark bands |
| `--brown` | `#5d4031` | hover ink, secondary text on cream |
| `--ink` | `#2e211b` | body text |
| `--muted` | `#74685f` | meta text, captions |
| `--gold` | `#b9985d` | accent: eyebrows, tags, rules |
| `--clay` | `#a44927` | emphasis: the italic word in the H1, closed tags, errors |
| `--sage` | `#8c9684` | gradient panels for trips without photos |
| `--line` | `rgba(57,38,29,.18)` | hairlines |
| `--white` | `#fffdfa` | text on photos |

Also in use: `#d7c9b9` and `#65351f` as image placeholders behind photos (keep), the shade gradient `rgba(37,23,16,.72)` over photos, and `rgba(244,239,229,.62)` for muted text on dark bands.

**Contrast correction (the only token change proposed).** Gold `#b9985d` text on cream measures 2.4:1 WCAG and about Lc 43 APCA, which fails for 11–12px bold caps. Add `--gold-ink: #8a6d3c` for gold *text* on cream and paper (4.7:1 WCAG, about Lc 64 APCA, passes for 14px bold caps) and raise eyebrow text to 14px. `--gold` stays for rules, tags on espresso and anything decorative. On dark bands gold text already passes.

## Type

- **Families**: Georgia for display and the italic voice; the system sans stack (`Inter, ui-sans-serif, system-ui, …`) for everything else. No webfonts. Georgia is absent on Android, where the fallback serif changes measure and rhythm; the fix is a local `@font-face` named `Courtside Serif Fallback` with `size-adjust`, `ascent-override`, `descent-override` and `line-gap-override` fitted to Georgia's metrics (ascent 0.917, descent 0.219, line gap 0; average width about 94% of Noto Serif), and `--serif: Georgia, 'Courtside Serif Fallback', serif`.
- **Current sizes** (read from the CSS): hero H1 `clamp(4rem,7vw,7.7rem)`, section H2 `clamp(3.1rem,5vw,5.4rem)`, builder H2 `clamp(3.6rem,6vw,6.4rem)`, card H3 2.25/2/1.65rem, italic sub `clamp(1.45rem,2.2vw,2rem)`, body 1.02–1.05rem, meta .78–.95rem, caps .65–.72rem with .12–.22em tracking, display tracking −.04 to −.055em. Line-heights: display .88–.97, body 1.45. Sixteen distinct small sizes exist; the scale below replaces them with nine steps.
- **Fluid scale** (Utopia method, 390px → 1440px, base 17 → 18px, ratio 1.2 → 1.333). Steps are the contract; each page uses only these.

```css
--t-5: clamp(3.5rem, 2.59rem + 3.9vw, 7rem);        /* hero H1, 56 → 112px, lh .92, ls -.045em */
--t-4: clamp(2.5rem, 1.85rem + 2.67vw, 5rem);       /* section H2, 40 → 80px, lh .96, ls -.04em */
--t-3: clamp(1.75rem, 1.56rem + .8vw, 2.5rem);      /* card / profile H3, 28 → 40px, lh 1.05, ls -.02em */
--t-2: clamp(1.375rem, 1.24rem + .53vw, 1.875rem);  /* italic sub, pull lines, 22 → 30px, lh 1.2 */
--t-1: clamp(1.125rem, 1.07rem + .22vw, 1.3125rem); /* lead paragraph, 18 → 21px, lh 1.5 */
--t-0: clamp(1.0625rem, 1.05rem + .07vw, 1.125rem); /* body, 17 → 18px, lh 1.55 */
--t--1: clamp(.9rem, .88rem + .08vw, .96875rem);    /* meta, captions, 14.4 → 15.5px, lh 1.45 */
--t--2: clamp(.875rem, .86rem + .05vw, .9rem);      /* caps and eyebrows, 14 → 14.4px, lh 1.3, ls .16em, weight 700 */
```

- **Measure**: body and lead paragraphs capped at `max-width: 62ch`; intro under the hero 48ch; card copy 40ch. Display lines balanced with `text-wrap: balance`, widows avoided with a non-breaking space before the last word of each H1/H2.
- **Details**: `font-kerning: normal; text-rendering: optimizeLegibility` on display; hanging quote for the week note; tabular numerals for prices and dates; real apostrophes and quotes.

## Space and rhythm

- **Space scale** (Utopia, 390 → 1440): `--s-3xs` 4→5, `--s-2xs` 8→9, `--s-xs` 12→14, `--s-s` 16→18, `--s-m` 24→27, `--s-l` 32→36, `--s-xl` 48→54, `--s-2xl` 64→72, `--s-3xl` 96→108, `--s-4xl` 128→144 (px, as `clamp()`).
- **Section rhythm** (three moods, assigned on purpose): hero full viewport minus header; "what Courtside is" airy (`--s-3xl`); featured trip normal (`--s-2xl`); trip lineup normal; how it works airy on the dark band; pros teaser normal; waitlist close tight (`--s-xl`); footer normal. The current single `clamp(70px,9vw,140px)` becomes these moods.
- **Grid**: 12 columns from 1050px with a `clamp(24px,6vw,90px)` outer margin (existing), 6 columns at 700px, single column below. Text blocks hang from column 1; the featured trip is an asymmetric pair (photo 7 columns, panel 5); the pros teaser is three equal cards (allowed: it is a set of three people); trips are a 3-up grid at 1050, 2-up at 700, compact rows at 390.
- **Shape**: one radius rule: photo cards and panels 26px, chips and small cards 18px, pills 999px. The stray 10/14/16/22/28px radii in the Phase 1 builder stay (not public pages).

## Motion language

- **Verb**: settle like paper. Ease `cubic-bezier(.2,.7,.2,1)` (one family), durations 240ms for feedback, 600–900ms for the hero settle, staggers 80ms. Transform and opacity only.
- **Signature, once per load**: hero photo shade eases from 1 to its resting opacity while the H1 lines, the sub line, the intro and the button rise 12px and fade in, in reading order, 80ms apart. Pure CSS `@keyframes`, `animation-fill-mode: both`. Under `prefers-reduced-motion: reduce` the animation is removed and everything is in its final state.
- **Hover and focus, one treatment per role**: primary and secondary buttons: the background floods from espresso to brown and the trailing arrow travels 4px; nav links and the "Don't have an invite code?" link: underline draws from the left, and the current page keeps it; cards (trips, pros): lift 4px with the shadow (existing) and the photo scales to 1.03 inside its clipped frame; utility links (footer): colour only. Every hover state also appears on `:focus-visible`; hovers sit inside `@media (hover: hover)`; under reduced motion the end state shows without movement.
- **Idle**: still at rest, by decision. A quiet invitation does not fidget.
- **Page transitions**: none by default. Optional, if KC wants it: the native `@view-transition { navigation: auto }` cross-fade at 180ms, no library, off under reduced motion.
- **No** loader, no smooth-scroll library, no scroll-driven effects, no parallax.

## Composition plan (homepage, mobile first)

```
390px                                   1440px
┌──────────────────────┐                ┌──────────────────────────────────────┐
│ logo        [Enter]  │ header         │ logo   Trips  Meet the pros  [Enter] │
├──────────────────────┤                ├─────────────────┬────────────────────┤
│ tennis takes         │ hero           │ tennis takes    │                    │
│ you further.         │                │ you further.    │   coast photo      │
│ good places. …       │                │ good places. …  │   (object-position │
│ 2 sentences          │                │ 2 sentences     │    per breakpoint) │
│ [Enter invite code]  │                │ [Enter invite code]                  │
│ Don't have a code?   │                │ Don't have an invite code?           │
├──────────────────────┤                ├──────────────────────────────────────┤
│ what Courtside is    │ 3 stacked      │ three columns + trust row            │
├──────────────────────┤                ├─────────────────────┬────────────────┤
│ Spain photo card     │ featured       │ photo (7 col)       │ panel (5 col)  │
│ panel                │                │                     │ [Enter w/ inv] │
├──────────────────────┤                ├──────────────────────────────────────┤
│ Charleston   row ▸   │ lineup as      │ 3-up cards, gradient art, waitlist   │
│ Geneva       row ▸   │ compact rows   │ button opens the capture under card  │
│ …                    │                │                                      │
├──────────────────────┤                ├──────────────────────────────────────┤
│ how it works 01 02 03│ dark band      │ three steps                          │
├──────────────────────┤                ├──────────────────────────────────────┤
│ Katie / Eva / Nelson │ teaser         │ three cards                          │
├──────────────────────┤                ├──────────────────────────────────────┤
│ [Join the waitlist]  │ general        │ one button, the capture opens inline │
├──────────────────────┤                ├──────────────────────────────────────┤
│ footer               │                │ footer                               │
└──────────────────────┘                └──────────────────────────────────────┘
 sticky bar: [Enter code] after the hero scrolls out (< 700px only)
```

## Genericness test

Where a generic model would land: a centered hero over a gradient, three equal feature cards, an eyebrow above every heading, "elevate your game" copy. Here: the hero is a split frame with a real photo and one button; eyebrows are cut back to the section heads that need orientation and dropped from the hero; the three "what Courtside is" columns are the one allowed set of three because the content is three real facts; copy is Katie's nouns (the club, the coast, the long lunch). The cream-serif-editorial look is the brand's own and predates this pass; the polish makes it precise rather than replacing it.
