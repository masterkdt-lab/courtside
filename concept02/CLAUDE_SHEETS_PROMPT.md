# Claude Code prompt: Courtside Concept 02 → Google Sheets + Vercel preview

Paste everything below the line into Claude Code in the existing Courtside project. Before you do, put `courtside-hosted-journeys-site-2026-11-08.zip` in the project root.

---

You're working in the existing Courtside project. It already has (1) a working Google Sheets connection used by the current prototype's invite-code/request flow, and (2) a temporary Vercel deployment. **Don't create a new Sheets connection, service account, or Google Cloud project, and don't create a new Vercel project.** Reuse what's there.

## Goal
Replace the current frontend with the archived "Courtside Concept 02" site (the launch design) and make its forms write real rows to the existing Google Sheet **TGL COURTSIDE** (ID `1GrHTKXt0O2esWmz8tsOM3ki73RuQ9EhlT7d32gwdeaI`). Then deploy a **preview** only.

## Steps
1. **Inspect first.** Find how the current prototype talks to Sheets: the API route or serverless function, env var names, auth method, and the helpers for invite validation, request append, waitlist, and log. Find the linked Vercel project (`.vercel/project.json`, `vercel.json`). Summarize what you found before you change anything. Create a git branch `concept-02-frontend`.
2. **Import the frontend.** Unzip `courtside-hosted-journeys-site-2026-11-08.zip`. The runnable site is in `courtside-site/site/` (index.html, styles.css, v2.css, pages.js, app.js, assets/, fonts/). It's a static, hash-routed vanilla-JS SPA. Currently every form only saves to localStorage (key `courtside-concept-v2`). See `courtside-site/FORMS_AND_FLOWS.md`. Make it the site's public frontend. Keep the existing API routes. Keep the design pixel-identical. Remove the "CONCEPT 02 / prototype perspective" bar and the Host/Courtside-team demo views (#/host-desk, #/operations) from the public build, or put them behind a flag, and show me the diff.
3. **Wire the forms to the existing Sheets helpers.** Do this through server-side endpoints only. Never expose credentials to the browser.
   - **#/invite:** replace the hard-coded `'JEFF'` check with the existing invite validation against the `Invites` tab (`code,issued_to,guest_email,guest_mobile,invited_by,max_uses,uses,status,created_at,last_used_at`). Keep incrementing `uses` and `last_used_at`, and keep appending to `Log` (`time,code,result,ip_hash`), the same way the old prototype does.
   - **#/request (4-step trip request, `submitInquiry`):** on the final step, append a row to `Requests`. Match these existing columns: `request_id,submitted_at,trip_id,request_type,weeks,guest_name,guest_email,guest_mobile,players,partners,room,single_rooms,tennis,addons,party_type,level,tennis_style,travel_style,priorities,note,player_estimate,partner_estimate,group_estimate,brief,invite_code,invited_by,status,owner,internal_notes`. Use the `CS-XXXXXXXX` id format, ISO `submitted_at`, `trip_id=spain`, and `status=New`. Map each Concept 02 field to the closest column. Put anything without a column into `note` or `brief`. Don't rename or reorder existing columns. Respect `Trips` and `Weeks` open/closed status (`Weeks`: `week_id,trip_id,label,start_date,end_date,status,closed_message`). Ideally the week options are driven by `Weeks`.
   - **#/waitlist:** append to `Waitlist` (`timestamp,email,name,trip,source`), with `source=concept02-waitlist`.
   - **#/application (host application, `saveApplication`):** there's no tab for this yet. Create a new tab `HostApplications` with clear headers (timestamp, name, email, club, plus every form field) and append to it.
   - Leave the group, trip-home, and concierge demo flows local-only for now. Label them clearly in your summary.
   - Add server-side validation, a honeypot or simple rate limit, and real loading, success, and error states in the UI. The existing success screens should only appear after the sheet write succeeds.
4. **Test locally**, then **deploy a Vercel preview** to the existing project (`vercel` without `--prod`). Use the same env vars the current deployment already has.
5. **Verify on the preview URL.** Make one test submission per wired form, using name `TEST – Claude` and email `kc@nextwave.bet`. Confirm each row landed in the correct tab and columns by reading the sheet back. Then report the preview URL, the row numbers written, and the field-to-column mapping. Don't delete other rows.
6. **Stop.** Don't promote to production, don't run `vercel --prod`, don't add or change domains, and don't touch DNS. Ask me before any of those.

Out of scope for now (just list them as next steps): Square deposits and balances, Mailchimp, GA4 conversion tracking, automated receipts and reminders, and the bookings/payments ledger and dashboard.

---

## Later: connecting a GoDaddy domain to Vercel
The domain is **still undecided: `courtside.co` vs `courtsidetravel.co`.** Don't do this until Jeff, Katie, and Kasey pick one and the preview is approved.
1. In Vercel, open Project → Settings → Domains → Add. Enter the apex (e.g. `courtsidetravel.co`) and also `www.`. Choose which one redirects to the other.
2. Vercel will show the exact records to add. Typically that's:
   - Apex `@`: **A** record pointing to the IP Vercel shows (commonly `76.76.21.21`).
   - `www`: **CNAME** pointing to the target Vercel shows (e.g. `cname.vercel-dns.com` or a project-specific `xxxx.vercel-dns-0xx.com`).
   - Sometimes a **TXT** `_vercel` record for ownership verification.
3. In GoDaddy, go to My Products → (domain) → **DNS** → **Manage DNS** → DNS Records. Edit the existing `@` A record (delete GoDaddy's "Parked" A record and any domain forwarding). Edit or replace the `www` CNAME, and add the TXT record if Vercel asked for one. Keep the nameservers on GoDaddy. Don't touch the MX records, or email will break.
4. Wait for Vercel to show "Valid Configuration." SSL is issued automatically. That can take anywhere from a few minutes to a few hours.
