# Concept 02, Wave 2: the local-only screens move into the Sheet (branch `concept-02-frontend`)

Authority: `CLAUDE_SHEETS_PROMPT_2.md` (KC, 2026-11-08). Status: **inventory and proposed tabs, awaiting KC's confirmation**. Wave 1's connection, store pattern, Log tab, setup script and tests are reused. No `main`, no production, no domain, no DNS.

## 1. Inventory: what each local screen stores or shows today

| Screen (route) | Writes | Reads / shows | Where the value comes from now |
| --- | --- | --- | --- |
| Group page `#/group` | group name, preferred date (one week or Flexible), tennis rhythm, payment mode (Individual travelers / Organizer requests group payment), "review needed" flag; add attendee (name, email, role Player / Non-playing partner); send or resend an invitation (email, sent time); cancel an invitation; remove an attendee | the group (organizer name and email, weeks, chosen week, players, partners, tennis, notes, stage Inquiry/Planning/Confirmed), each attendee's name, email, role, invite state, participation, planning complete, room, roommate, proposal status, payment status; per-person price (2995 player / 1995 partner); "what happens next" | `state.group` seeded from the request (`completeGroupInquiry`) or a sample group; attendees in `state.group.attendees` |
| Attendee invitation `#/attendee/<id>` and join link `#/join-group` | respond Interested / Still deciding / Not attending; join by name, email, role | the invitation (group name, organizer, dates, host line) | attendee record; join adds an attendee |
| Preferences `#/preferences` (per attendee) | participation, role, level, tennis, room, roommate, interests (multi), care notes, planning complete | the attendee's current answers | attendee record |
| Trip home `#/trip-home` (Overview, Itinerary, Group, Arrangements, Arrival) | arrival airport, date, flight, time (`saveArrival`), creating a transfer-review task | the traveler's state, proposed departure, group character (counts of interested, party), shared program (static copy), personal arrangements (room, extras from approved concierge items, base price and payment status), `.ics` download (built in the browser) | attendee record, group, concierge requests; itinerary text is static |
| Concierge `#/help`, `#/help/new/<kind>`, `#/help/<id>` | create a request (category Stay change / Activity / Transport / Proposal question / Other, subject, message, preferred timing for activities); cancel a request | status (Received / Checking options / Approval needed / Approved / Declined / Unavailable / Confirmed / Canceled), Courtside's offer and cost, history lines, owner | `state.requests` |
| Proposal `#/proposal` (per traveler) | accept → proposal status Payment pending | proposed dates, stay, room preference, hosted experience, base price by role, extras (approved concierge costs), payment responsibility, "quoted separately" items, booking terms | computed from attendee + group + requests |
| Payment `#/payment` | "confirm" → marks the traveler paid and the group Confirmed (sample) | shared-room base, payment details, booking terms (not established), "no card details collected" | computed; nothing recorded |

Team-side screens (`#/host-desk`, `#/operations`: offering a concierge option, moving an application through stages, supplier and task boards) are out of this wave: they stay local behind the demo flag, because the Sheet itself is the team view for now.

## 2. Proposed tabs and headers (row 1, exact)

| Tab | Headers |
| --- | --- |
| `Groups` | `group_id, request_id, trip_id, name, organizer_name, organizer_email, weeks, chosen_week, players, partners, tennis, payment_mode, notes, stage, review_needed, created_at, updated_at` |
| `GroupMembers` | `member_id, group_id, name, email, role, invite_status, participation, planning_complete, level, tennis, room, roommate, interests, care_notes, proposal_status, payment_status, arrival_airport, arrival_date, arrival_flight, arrival_time, invited_at, joined_at, updated_at, removed` |
| `ConciergeRequests` | `concierge_id, group_id, member_id, requester_name, category, subject, details, preferred_timing, status, offer, cost, assigned_to, history, created_at, updated_at` |
| `Proposals` | `proposal_id, group_id, member_id, request_id, trip_id, week, role, room, players, partners, inclusions, addons, base_price, extras_total, package_total, currency, deposit_amount, balance_due_date, status, version, created_at, sent_at, accepted_at` |
| `Payments` | `payment_id, proposal_id, group_id, member_id, payer_name, payer_email, type, amount, currency, method, provider_ref, status, due_date, paid_at, notes, created_at` |

Differences from the suggested tabs, and why:
- `Groups` carries the request's planning fields (weeks, players, partners, tennis, payment mode, notes) because the group page edits them after the request; `stage` is Inquiry / Planning / Proposal sent / Confirmed; `review_needed` is the "organizer changed something, Courtside should look" flag the app already sets.
- `GroupMembers` also holds the preferences and the arrival details, so Trip home needs no tab of its own. `role` values: `Organizer + player`, `Organizer + partner`, `Player`, `Non-playing partner`. `invite_status`: `Not invited`, `Link shared`, `Responded`, `Invitation canceled`. `participation`: `Interested`, `Still deciding`, `Not attending`, blank until they answer. `removed` is `TRUE` instead of deleting a row.
- `ConciergeRequests` keeps `member_id` (who asked) with `requester_name`; `history` is one cell with one line per event; `assigned_to` and `offer`/`cost`/`status` are Courtside's columns to edit in the Sheet.
- `Proposals` is **per traveler**, not per group, because the app prices per person (base by role plus that person's approved extras); `group_id` links them. `inclusions` is the fixed six-item package text; `addons` lists the approved concierge items.
- `Payments` as suggested, plus `created_at`; `provider_ref` stays blank for Square.
- Dropdowns on `Groups.stage`, `GroupMembers.participation`, `ConciergeRequests.status`, `Proposals.status`, `Payments.type` and `Payments.status`, so Katie and Jeff edit them from a list. The site never deletes rows and never edits columns it does not own (`assigned_to`, `offer`, `cost`, `status` on concierge, `status`/`paid_at` on payments are Courtside's).

## 3. Access model (needs a yes)

- **Organizer**: the `cs_session` invite cookie that already protects the existing routes, plus the group's unguessable id (`CSG-XXXXXXXX`) in every call. Reads return only that group.
- **Invited attendees** have no invite code. Their personal link `/#/join/CSM-XXXXXXXX` carries an unguessable member id; opening it sets a second signed HttpOnly cookie, `cs_member`, scoped to that member and group, using the same HMAC machinery as `cs_session`. Reads and writes for members require that cookie and are scoped to it.
- No route is public. Ids come from `lib/ids.js` in the `CS-` style: `CSG-` groups, `CSM-` members, `CSR-` concierge, `CSP-` proposals, `CSY-` payments.

## 4. Behaviour changes to confirm

1. **Invitations are links, not emails.** "Send invitation" marks the member `Link shared` and gives the organizer the member's link to copy and send themselves. Emailing invitations is a next step (Mailchimp or Resend).
2. **A group is created by the request.** The group path of `POST /api/inquiry` also creates the `Groups` row and the organizer's `GroupMembers` row, linked by `request_id`; the receipt links to `#/group/CSG-…`. The sample group disappears from the public build.
3. **Proposals**: a traveler's proposal row is created in `draft` the first time they open `#/proposal` (base by role plus their approved extras); Courtside can edit it in the Sheet and set it to `sent`. Accepting (from `draft` or `sent`) sets `accepted`, creates one `Payments` row of type `deposit`, status `pending`, and sets the member's `proposal_status` to Payment pending. Placeholder rules until you set real ones: deposit = 20% of the package total, balance due 60 days before the chosen week. Both are constants in one file.
4. **Payment page becomes a ledger.** It lists the traveler's Payments rows and says Courtside will send payment instructions. The guest can no longer "confirm" and mark themselves paid; Courtside sets a row to `paid` in the Sheet, which unlocks Trip home.
5. **Concierge**: guests create and cancel requests; everything else on a request (status, offer, cost, owner, history additions) is Courtside's, edited in the Sheet. The guest sees those edits on reload. Approving an offer: the guest approves from the request page (status `Approved`), which also feeds the proposal's extras.
6. **Trip home** reads the group, members, concierge and payments; the itinerary stays static copy; the `.ics` download stays client-side.
7. **Weeks** on the group edit form come from `/api/lineup`, like the request flow.

## 5. KC's confirmation (2026-11-08)

Confirmed as proposed, with one change: **deposit rules live in a `Settings` tab** and are read from there, never hard-coded. Placeholders: $300 per person, $3,000 per group, balance due 60 days before the week.

| Tab | Headers | Seed rows (only when the tab is empty) |
| --- | --- | --- |
| `Settings` | `key, value, note` | `deposit_per_person, 300, "Deposit per traveler when travelers pay individually (USD)"` · `deposit_per_group, 3000, "Deposit when the organizer requests group payment (USD)"` · `balance_due_days_before, 60, "Balance due this many days before the chosen week starts"` · `deposit_due_days, 7, "Days after acceptance by which the deposit is due"` · `currency, USD, "Ledger currency"` |

`lib/settings.js` reads the tab through the store with a 60-second cache and falls back to those defaults when a key is missing or not a number. Courtside changes a rule by editing the `value` cell.

## 6. Contracts (binding for both agents)

### Identity and access
- A second signed HttpOnly cookie, `cs_member`, built with `lib/cookie.js`: payload `{ scope:"member", groupId, memberId, exp }`, 90 days, SameSite=Lax, Secure off localhost. `lib/access.js` exports `memberSession(request)` → payload or null, and `requireMember(request)` → `{ groupId, memberId, member, group, isOrganizer }` or a 401 response. `isOrganizer` = the member's `role` starts with `Organizer`.
- The cookie is set by: the group path of `POST /api/inquiry` (the organizer's own member row), `POST /api/member` action `open` (a personal link), and action `join` (the shared group link). The invite cookie `cs_session` is not used for group access.
- Ids from `lib/ids.js`: `CSG-` groups, `CSM-` members, `CSR-` concierge, `CSP-` proposals, `CSY-` payments, 8 Crockford base32 characters.
- Every route: JSON in and out, `Cache-Control: no-store`; errors `400 { ok:false, errors:{ field: message } }`, `401 { ok:false, reason:"unauthorized" }`, `403 { ok:false, reason:"forbidden" }`, `404 { ok:false, reason:"not_found" }`, `409 { ok:false, reason, message }`, `429 { ok:false, reason:"rate_limited" }`, `500 { ok:false, reason:"server_error" }`. Rate limit bucket `group` 30 writes per 10 minutes per IP hash for every write action below. Every write appends a Log row `{ code:<event>, result:<id> }` (best effort).

### Store (`lib/store.js` interface, mock + Sheets)
`getGroup(groupId)`, `appendGroup(row)`, `updateGroup(groupId, patch)`, `listMembers(groupId)` (includes removed, the routes filter), `getMember(memberId)`, `appendMember(row)`, `updateMember(memberId, patch)`, `listConcierge(groupId)`, `getConcierge(conciergeId)`, `appendConcierge(row)`, `updateConcierge(conciergeId, patch)`, `getProposalForMember(memberId)`, `appendProposal(row)`, `updateProposal(proposalId, patch)`, `listPayments(groupId)`, `appendPayment(row)`, `listSettings()`. Rows use camelCase keys of the headers in section 2 and 5; `patch` updates only the given keys plus `updatedAt`. The Sheets implementation finds the row by its id column and updates that row's cells only; it never deletes. The mock implementation mirrors it in `.data/mock.json` under `groups, group_members, concierge_requests, proposals, payments, settings` (snake_case, `tests/fixtures/seed.json` gets empty arrays and the five Settings rows).

### `POST /api/inquiry` (Wave 1 route, extended) — group path only
After the Requests row: create the `Groups` row (`groupId`, `requestId`, `tripId` spain, `name` = first name + "’s Spain group", organizer name and email, `weeks` labels, `chosenWeek` = the first chosen week id or `flexible`, `players`, `partners`, `tennis`, `paymentMode` "Individual travelers", `notes`, `stage` Inquiry, `reviewNeeded` FALSE, timestamps) and the organizer's `GroupMembers` row (`role` "Organizer + player", `inviteStatus` Responded, `participation` Interested, `planningComplete` FALSE, `tennis` from the request, `proposalStatus` Draft, `paymentStatus` Not due, `joinedAt`). Response adds `{ groupId, memberId }` and sets `cs_member`. Log `group_create`, `member_add`. The match path is unchanged.

### `GET /api/group` (cookie)
`200 { ok:true, group, me:{ memberId, role, isOrganizer }, members:[…], weekLabels:{ id: label } }`. `group` = the Groups row in camelCase. Organizers get every non-removed member with all columns; other members get `{ memberId, name, role, participation, planningComplete }` only. `members[*].paymentStatus` and `proposalStatus` are the stored columns.

### `POST /api/group` (cookie, organizer only → else 403)
Body `{ action:"update", name, chosenWeek, tennis, paymentMode }`: `name` ≤ 120 required; `chosenWeek` a week id from `listWeeks()` or `flexible`; `tennis` one of the five Concept 02 rhythms; `paymentMode` `Individual travelers` | `Organizer requests group payment`. Updates the row, sets `weeks` to the label (or Flexible), `reviewNeeded` TRUE, `updatedAt`. `200 { ok:true, group }`. Log `group_update`.

### `POST /api/member`
Actions and who may call them (`requireMember` unless noted):
- `open` (no cookie) `{ memberId }`: member exists and not removed → set `cs_member`, `200 { ok:true, group:{ groupId, name, organizerName, chosenWeek, weekLabel, tennis, stage }, member:{ memberId, name, role, inviteStatus, participation, planningComplete }, isOrganizer }`; else 404. Log `member_open`.
- `join` (no cookie) `{ groupId, name, email, role }` (`role` Player | Non-playing partner): existing non-removed member with that email in the group → reuse; else append (`inviteStatus` Responded, `participation` Interested, `joinedAt`). Sets `cs_member`. `200 { ok:true, memberId, group:{…} }`. Log `member_join`. 404 when the group is unknown.
- `add` (organizer) `{ name, email, role }`: duplicate email in the group → 400 `email` "That email is already in your group."; appends (`inviteStatus` Not invited). `200 { ok:true, member, link:"/#/join/CSM-…" }`. Log `member_add`.
- `invite` (organizer) `{ memberId, email? }`: sets `email` if given, `inviteStatus` Link shared, `invitedAt`; `200 { ok:true, member, link }`. Log `member_invite`.
- `cancel` (organizer) `{ memberId }`: `inviteStatus` Invitation canceled, `participation` "". Log `member_cancel`.
- `remove` (organizer) `{ memberId }`: `removed` TRUE (never the organizer themself → 400). Log `member_remove`.
- `respond` (self) `{ participation }` (Interested | Still deciding | Not attending): sets `participation`, `inviteStatus` Responded, `joinedAt` if blank. Log `member_respond`.
- `preferences` (self) `{ participation, role, level, tennis, room, roommate, interests:[…], care, complete:boolean }`: values from the Concept 02 selects (role Player | Non-playing partner, kept as `Organizer + player/partner` for organizers; level "" | 2.5…5.0+; tennis one of Help me decide / Four mornings / Daily tennis / Extra tennis / A lighter schedule / Non-playing partner; room Help me decide / Shared room / Private room / Interested in an upgrade; interests any of Food + wine, Golf, Extra tennis, Spa, Exploring, More downtime, Culture; care ≤ 1000). Sets `planningComplete`. Log `member_preferences`.
- `arrival` (self) `{ airport, date, flight, time }` (≤ 120 each; date `YYYY-MM-DD` or free text ≤ 40): sets the four arrival columns. Log `member_arrival`.
Every action returns `member` (own full row) in `200 { ok:true, member, … }`.

### `GET /api/concierge` (cookie) → `200 { ok:true, requests:[…] }`: the member's own rows; organizers get the whole group's. `history` is returned split into lines.
### `POST /api/concierge` (cookie)
- `create` `{ category, subject, details, timing }`: category Stay change | Activity | Transport | Proposal question | Other; subject ≤ 160 required; details ≤ 4000 required; timing ≤ 60 optional. Row: status Received, `assignedTo` "", `history` "Request received. Courtside will review the details. · <ISO>". If category is Proposal question, the member's `proposalStatus` becomes Review requested. `200 { ok:true, request }`. Log `concierge_create`.
- `cancel` `{ conciergeId }` (own request, status not Confirmed) → Canceled + history line. Log `concierge_cancel`.
- `approve` / `decline` `{ conciergeId }` (own request, status Approval needed) → Approved / Declined + history line. Log `concierge_approve` / `concierge_decline`.
Courtside's columns (`status` to Checking options / Approval needed / Unavailable / Confirmed, `offer`, `cost`, `assignedTo`) are edited in the Sheet only.

### `GET /api/proposal` (cookie)
Returns the member's proposal, creating it in `draft` on first call: `role`, `room` (member's), `week` = group `chosenWeek` label, `players`/`partners` from the group, `inclusions` = "Six-night resort stay; Four tennis mornings; Daily breakfast; Scheduled club transfers; Welcome + farewell dinners; Courtside trip support", `addons` = the member's Approved concierge subjects joined, `basePrice` 2995 (player) or 1995 (partner), `extrasTotal` = sum of Approved concierge `cost`, `packageTotal` = base + extras, `currency` from Settings, `depositAmount` = Settings `deposit_per_person`, or `deposit_per_group` on the organizer's proposal when the group's `paymentMode` is "Organizer requests group payment" (other members then 0), `balanceDueDate` = chosen week `start` minus `balance_due_days_before` days (blank when flexible), `status` draft, `version` 1. While still `draft`, a later read with changed extras updates the row and bumps `version`. `200 { ok:true, proposal, settings:{ depositDueDays } }`.
### `POST /api/proposal` `{ action:"accept", proposalId }` (own proposal, status draft or sent)
Sets `accepted`, `acceptedAt`; member `proposalStatus` Payment pending and `paymentStatus` Deposit pending; if `depositAmount` > 0 appends one `Payments` row `{ type: deposit, amount: depositAmount, currency, method:"", providerRef:"", status: pending, dueDate: now + deposit_due_days, payerName/Email from the member, notes:"" }`; if the member is the organizer and this is the first accepted proposal in the group, group `stage` → Proposal sent. `200 { ok:true, proposal, payment }`. Log `proposal_accept`, `payment_create`.
### `GET /api/payments` (cookie) → `200 { ok:true, payments:[…] }`: own rows; organizers get the group's. Read-only; Courtside marks `status` paid and `paidAt` in the Sheet.

### Frontend routes
`#/group` (organizer view; 401 → a page that says to open the personal link from the receipt), `#/join/CSM-…` (open → organizer to `#/group`, others to `#/attendee`), `#/join-group/CSG-…` (shared join form), `#/attendee` (the invitation for the current member: respond), `#/preferences`, `#/planning-saved`, `#/help`, `#/help/new/<kind>`, `#/help/<id>`, `#/proposal`, `#/payment` (ledger), `#/trip-home` (+ `#/arrival`). Trip home opens once the member's proposal is `accepted`; before that `#/trip-home` shows the proposal page. `#/received` shows the group link and the organizer's own personal link to copy. The sample group, `state.active` traveler switching and "Preview attendee" leave the public build (demo flag only). Week choices on the group edit form come from `/api/lineup`.

## 6. Preview verification

One submission per screen with `TEST – Claude` / `kc@nextwave.bet`, rows read back and reported as tab, row, what landed.
