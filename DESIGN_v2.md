# Courtside Design System v2
Gold standard: **Six Senses** (sixsenses.com). The tagline is *good places. better people.* Everything below is unchanged from v1 except that Canela replaces Georgia and a licensed sans (GT America) is added.

## Fonts
| Role | Face | Foundry | License notes |
|---|---|---|---|
| Display / headlines (t-5…t-1) | **Canela** (Light 300 / Regular 400, italic for emphasis) | Commercial Type, https://commercialtype.com/catalog/canela | Captured pricing: **$325 per family**, one-time fee for perpetual use; the full collection and per-style prices are also listed on the page. For mockups use the Commercial Type **trial** only; trial fonts may not ship in production. Buy a desktop and web licence before launch and check the EULA at commercialtype.com. No other prices are claimed here. |
| UI, body, labels (t-0…t--2) | **GT America Standard** (Regular 400 / Medium 500, Regular Italic) | Grilli Type, https://www.grillitype.com/typeface/gt-america | Licensing: https://www.grillitype.com/licensing. Price not captured; confirm on the page. Mockups use the Grilli Type **trial** fonts only (evaluation/client approval; no kerning, accents or OpenType features). Trial fonts must never ship; buy desktop + web licences before launch. |

**Why GT America:** Kasey compared Söhne, Founders Grotesk and GT America against Canela (fonts/sans-compare.png, Nov 1 2026) and picked GT America. It blends American gothic warmth with European grotesk precision, so it reads confident and friendly at body sizes while staying quiet enough for Canela's flared strokes to carry the brand voice. It holds up at 14px caps with 0.16em tracking (t--2) and avoids the default look of Inter, Roboto or system fonts. It also replaces Graphik, which Kasey rejected. Note: this means two foundries (Commercial Type + Grilli Type) and two licences.

Fallback stacks:
`--font-display: "Canela", "Canela Web", Georgia, serif;`
`--font-sans: "GT America", "GT America Standard", -apple-system, "Helvetica Neue", sans-serif;`

## Type scale (fluid, clamp from 375px to 1440px)
| Token | Size | Face | Use |
|---|---|---|---|
| t-5 | 56 → 112 | Canela Light, lh 1.0, -0.01em | Hero line, one per page |
| t-4 | 40 → 80 | Canela Light, lh 1.05 | Section openers |
| t-3 | 28 → 40 | Canela Regular, lh 1.15 | Trip names, card titles |
| t-2 | 22 → 30 | Canela Regular, lh 1.2 | Sub-heads, pull quotes (italic) |
| t-1 | 18 → 21 | GT America Regular, lh 1.5 | Lead paragraph |
| t-0 | 17 → 18 | GT America Regular, lh 1.6 | Body |
| t--1 | 14.4 → 15.5 | GT America Regular, lh 1.5 | Meta, captions, form help |
| t--2 | 14, CAPS, +0.16em | GT America Medium | Eyebrows, nav, button labels |

## Color tokens
```
--cream:#f4efe5;  --paper:#fbf8f2;  --white:#fffdfa;
--espresso:#39261d; --brown:#5d4031; --ink:#2e211b; --muted:#74685f;
--gold:#b9985d; --gold-ink:#7d6236; --gold-bright:#c9a86a;
--clay:#a44927; --sage:#8c9684; --line:rgba(57,38,29,.18);
```
- The page background is cream. Paper is for raised surfaces; white is for inputs only.
- Text is ink. Muted text must be ≥ t--1 and sit on cream or paper.
- Gold is an accent; use gold-ink when gold text sits on cream. Clay is for urgent or alert states only (e.g. "2 spots left"), at most once per screen. Sage is for confirmations and calm states.

## Spacing
4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96 / 128 (`--s-1`…`--s-10`). Use 96–128 between sections and 24–32 inside cards. No other values.

## Radius
- Cards and photos: **26**
- Chips and inputs: **18**
- Buttons and pills: **999**
- Hairline rules: 0
Mixing these three on purpose is the point; a single radius everywhere fails the rules below.

## Buttons
- **Primary:** espresso fill, cream label in t--2 caps, 999 radius, height 52, 0 32 padding. Hover goes to brown; pressed shifts down 1px.
- **Secondary:** transparent with a 1px espresso border and espresso label. Hover fills with paper.
- **Text link:** ink with a gold-ink underline offset 4px.
- At most **one primary per screen** (one ask).
- Focus: 2px gold-ink outline, 3px offset.

## Motion: "settle like paper"
- Easing `cubic-bezier(.2,.7,.2,1)` everywhere.
- Feedback (hover, press, toggle): **240ms**.
- Hero and section reveal: **600–900ms**, translateY 12→0 plus opacity.
- List and card stagger: **80ms**.
- No bounce, no parallax beyond 8%, no spinning loaders on the hero. Respect `prefers-reduced-motion` (opacity only).

## Anti-AI-slop rules (every screen must pass)
1. **No generic fonts**: no Inter, Roboto, Poppins, Montserrat or system serifs for display. Canela and GT America only (trial in mockups).
2. **No purple or blue gradients**, no neon, no gradient text. Colour comes from the palette above.
3. **No glassmorphism**: no backdrop-blur cards and no frosted nav over photos (use a solid cream bar or nothing).
4. **No three identical cards in a row.** Only exception: the **pros set** (host cards). Trips use varied sizes, one feature plus a list, or an Airbnb-style row of photos with prices.
5. **Don't use one radius everywhere**: 26 / 18 / 999 are each used for their own job.
6. **No generic headlines** ("Elevate your game", "Unlock…", "Experience the difference"). Headlines name a place, a person or a feeling.
7. **One ask per screen**: one primary button per viewport. Everything else is secondary or a text link.
8. **Name the pain first**: open with what's wrong today (e.g. tennis trips that are just drills in a resort with strangers) before the offer.
9. **Be specific**: real places (Costa Blanca, Mallorca, Geneva), real host names, dates, group size, what's included. No placeholders or vague claims.
10. **Photography first**: full-bleed, warm, real people and places. No stock-looking handshakes or 3D illustrations.
11. **Six Senses pass/fail check:** put the screen next to sixsenses.com. Fail if any of these is true:
    - The hero has more than one sentence of display type.
    - The image isn't full-bleed.
    - There is more than one filled button.
    - Text sits on a busy area of a photo without scrim or placement.
    - The page feels busier than Six Senses at the same scroll depth.
