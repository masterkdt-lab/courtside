# Turning on Google Analytics 4 for courtsidetravel.co

The site is ready for GA4 but sends nothing until a measurement ID is set. While `GA_MEASUREMENT_ID` in `public/analytics.js` is empty, there is no cookie banner and no request to Google. Once the ID is set, visitors see a small banner ("Allow" / "No thanks"); Google's script loads only after they click Allow.

## 1. Create the property and the web stream (about 5 minutes)

1. Go to https://analytics.google.com and sign in with the Google account that should own Courtside's analytics (ideally Courtside's Google Workspace account).
2. Click **Admin** (the gear, bottom left), then **Create** → **Property**.
3. Property name: `Courtside Travel Co.` Time zone and currency: yours. Click **Next**, answer the business questions, click **Create**.
4. Choose the platform **Web**.
5. Website URL: `https://courtsidetravel.co`. Stream name: `courtsidetravel.co`.
6. Open **Enhanced measurement** (the gear on that screen) → **Page views** → **Show advanced settings** and **turn off "Page changes based on browser history events"**. The site sends its own page views, with personal links stripped; this setting would send duplicates with the full address. Leave the rest on. Click **Create stream**.
7. Copy the **Measurement ID** shown at the top right of the stream page. It looks like `G-ABC123XYZ9`.

Don't install the "Google tag" snippet Google offers: the site already has it.

## 2. Put the ID into the site

Either send the `G-…` ID to Claude, or edit `public/analytics.js` yourself:

```js
const GA_MEASUREMENT_ID = 'G-ABC123XYZ9';
```

The test `analytics.js ships with an empty measurement ID` in `tests/pages.test.js` will then fail on purpose: change it to expect the real ID in the same commit. Then deploy as usual. Open the site, click **Allow** on the banner and check **Reports → Realtime** in GA4: your visit should appear within a minute.

## 3. Mark the lead event as a key event

The site sends `generate_lead` (with `lead_type` = `trip_request`, `waitlist` or `host_application`, and nothing personal) after a successful trip request, waitlist sign-up or host application.

1. Wait until the event has been sent at least once (submit one yourself, or wait a day).
2. GA4 **Admin** → **Data display** → **Events**, find `generate_lead` and switch on **Mark as key event**.
3. Optional: **Admin** → **Custom definitions** → **Create custom dimension**, name `Lead type`, scope Event, parameter `lead_type`, to split leads by form.

## 4. Link Search Console

1. If Search Console is not set up yet: https://search.google.com/search-console → **Add property** → **Domain** `courtsidetravel.co`, verify with the DNS record it shows (Namecheap or wherever the domain's DNS lives), then **Sitemaps** → submit `https://courtsidetravel.co/sitemap.xml`.
2. In GA4: **Admin** → **Product links** → **Search Console links** → **Link**, choose the `courtsidetravel.co` property, choose the `courtsidetravel.co` web stream, **Submit**.

## What visitors and Google see

- Consent Mode v2: everything is denied by default; Allow grants only `analytics_storage` (advertising stays denied).
- Private screens (group, trip home, proposal, join links…) are reported as the route name only, for example `https://courtsidetravel.co/#/join`. Group, member and request IDs, invitation codes and emails are never sent. In GA4 reports these appear under **Page location**; the **Page path** dimension shows `/` for them.
- "Cookie settings" in the footer reopens the banner at any time. Choosing "No thanks" afterwards withdraws consent and deletes the `_ga` cookies.
- The privacy notice (`/privacy`) already describes Google Analytics as optional, consent-based analytics.
