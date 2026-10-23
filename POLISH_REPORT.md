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

<!-- LIGHTHOUSE: filled in from QA_REPORT_POLISH.md -->

SEO is capped by `noindex`: Lighthouse's "is-crawlable" audit fails by design on a private site. The table shows the raw score and the score with that audit excluded.

## 3. What changed and why

<!-- CHANGES: filled in from the wave reports -->

## 4. Placeholders, every one, and its decision

<!-- PLACEHOLDERS -->

## 5. Raw material still wanted from Katie (follow-ups, not blockers)

- The exact invitation text she sends by iMessage or DM, so the homepage and gate copy continue that conversation.
- A voice memo or call notes about the trips and the people, for bios and section copy in her cadence.
- Full-resolution originals of every photo, and anything else from Spain, viewed as a contact sheet; one or two frames with a clear court and a clear face would replace the current hero crop.
- Real bio and on-court facts for Katie, Eva and Nelson; Eva's surname; Nelson's role and a photo.
- Which photos are cleared for public use, and a confirmation of who is who in `life-eva-paella.jpg` (see section 7).
- The final privacy wording.
- The real domain, so the canonical and Open Graph URLs can be swapped from `courtside-ivory.vercel.app`.

## 6. Validation

<!-- VALIDATION: tests, axe, screenshots, devices -->

## 7. Open questions for KC

<!-- QUESTIONS -->

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
