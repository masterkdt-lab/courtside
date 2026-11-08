# Courtside Concept 02: forms and flows (captured 2026-11-08)
Source: https://courtside-hosted-journeys.marvelousstork.chatgpt.site/
This is a static, hash-routed vanilla-JS site (index.html, styles.css, v2.css, pages.js, app.js, assets/*.jpg|webp).
**None of the forms submit to a server.** Everything is saved to the browser's localStorage under the key `courtside-concept-v2`. The only network calls are the site's own files and Google Fonts. The copy also bundles the fonts locally. The footer bar says "Local demo · no real messages, payments or bookings".

| Route | Form / handler | What it does now |
|---|---|---|
| #/invite | inline: code field | Hard-coded: `JEFF` goes to #/trip, anything else goes to #/invite-unavailable |
| #/request (4 steps) | `submitInquiry` + `captureDraft` (weeks checkboxes, notes, etc.) | Saves `state.draft` locally, no network call |
| #/waitlist | inline: name, email, interests | Sets `state.waitlisted`, goes to #/waitlist-done |
| #/application (host apply) | `saveApplication` (name, email, club, background, community, story, etc.) | Saved locally |
| #/group, #/join-group | `addAttendee`, `sendInvite`, `saveGroup`, `joinGroupSubmit`, `savePreferences` | Local group-management demo |
| #/trip-home | `saveArrival`, `createRequest` (concierge requests), calendar .ics download | Local only. The .ics file is generated in the browser |
| #/host-desk, #/operations | `offerRequest`, `applicationStage` | Local host/team dashboard demo |
Payments: there's no integration (no Square or Stripe). External services: Google Fonts only, plus a Cloudflare bot-challenge script injected by the host, which was removed from the copy.
