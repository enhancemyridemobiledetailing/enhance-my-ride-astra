# Enhance My Ride booking backend

This Worker serves the static site and exposes same-origin `/api/config`, `/api/health`, `/api/bookings`, `/api/reviews`, and `/api/google-review-photo` routes. It uses D1 for booking records, the notification outbox, and privacy-preserving rate limits; private R2 storage for submitted booking photos; Turnstile for spam protection; and Resend for booking email to `info@enhancemyride.com`.

## Booking-data retention

Booking details and uploaded photos are retained for 90 days from submission, then removed from D1 and the private R2 bucket by a daily Worker cron at 12:02 UTC. If an R2 deletion fails, its D1 record remains so the next daily run can retry it. Hashed rate-limit entries older than 24 hours are also removed. The notification copy and photo attachments delivered to the business email mailbox are outside this Worker cleanup and must be managed under that mailbox's retention settings.

## Cloudflare setup status

- D1 database `enhance-my-ride-bookings` and its schema are present in the authenticated Cloudflare account; `wrangler.jsonc` contains its database ID.
- R2 bucket `enhance-my-ride-booking-photos` is present, uses the Standard class, and has public access disabled.
- Turnstile widget `Enhance My Ride Booking Form` is configured for `enhancemyride.com`; its public site key is in `wrangler.jsonc`.
- Resend domain `enhancemyride.com` is verified and its DNS records are present. No Resend API key or Worker secret is stored in this repository.
- The Worker and site are deployed on the existing Cloudflare production service. This project update intentionally leaves the optional Google Places feed disabled until a Google API key is configured.

## Optional live Google Maps reviews and photos

The read-only feed requests the current Place Details response from Google Places API (New) when a visitor opens the site. It returns up to five relevance-sorted reviews, the current rating and review count, reviewer names/profile photos when Google supplies them, and up to four separate photos from the business listing with contributor credits. Place Details reviews do not include vehicle photos attached to an individual review; any photos returned by this integration are listing photos and are shown separately. The API key is used only by the Worker and is never sent to the browser.

Review and photo content is not written to D1 or R2 and is served with `no-store` headers. Review requests are limited to 12 per client IP per hour and photo media requests to 30 per client IP per hour using hashed identifiers in the existing rate-limit table. The client-side feed falls back to the site's existing selected customer feedback while the integration is not configured or unavailable.

To activate it:

1. In Google Cloud, select a project, enable Places API (New), enable billing, create an API key, and restrict that key to Places API (New). Reviews are a billable Place Details Enterprise + Atmosphere field; rating and review count are billable Enterprise fields. Photo media requests can also incur charges. Check current Google Maps Platform pricing before enabling the key.
2. Add the key as a Cloudflare Worker secret named `GOOGLE_PLACES_API_KEY` for the `enhance-my-ride-astra` Worker. Do not commit the key or place it in HTML, JavaScript, Wrangler `vars`, or `.dev.vars`.
3. Keep the public `/privacy.html` and `/terms.html` pages available. They describe the Google Maps content and link to Google's terms, privacy and Places API policies.
4. Verify `/api/reviews` and the attributed image display after the secret is set. The feed makes a fresh upstream request on page load and does not store Google content.

## Local mock booking flow (no Node or external accounts needed)

From this directory, run:

```sh
python3 local_mock_server.py
```

Then open `http://127.0.0.1:8770/`. This local-only server uses SQLite under `.local/` as a D1 stand-in, local private files as an R2 stand-in, a fixed local Turnstile token, and a JSONL mock email outbox. It never contacts Cloudflare or Resend and never sends email. The success message explicitly says the request and attachments were recorded locally and no email was sent.

The local test database is at `.local/mock-d1.sqlite3`, uploaded photos are kept under `.local/mock-r2/`, and the simulated Resend outbox is `.local/mock-resend-outbox.jsonl`. Remove `.local/` to erase local test submissions.

## Run the actual Worker against Wrangler's local D1/R2 emulators

Install a supported Node.js runtime, then from `worker/` run `npm install` and `npx wrangler d1 migrations apply enhance-my-ride-bookings --local`, followed by `npx wrangler dev --config wrangler.jsonc`. Wrangler's local mode uses local D1 and R2 state; no remote buckets or databases are accessed unless a remote binding is explicitly enabled. See [Cloudflare D1 local development](https://developers.cloudflare.com/d1/best-practices/local-development/) and [R2 Workers API](https://developers.cloudflare.com/r2/get-started/workers-api/).

The terminal session used to prepare this project does not have Node.js or Wrangler installed, so the actual Wrangler runtime could not be launched here. The Worker handler is dependency-injected for local mock testing; the Python preview server supplies the integrated browser booking flow without pretending it is the Cloudflare production backend.

## Booking backend activation steps

1. Create a Resend API key scoped to sending from the verified domain. Add it as Worker secret `RESEND_API_KEY`, and set `MAIL_FROM` to a sender on `enhancemyride.com`.
2. Add the Turnstile secret as Worker secret `TURNSTILE_SECRET_KEY`, and set a random `RATE_LIMIT_SALT` as a Worker secret. Keep both out of source control and frontend files.
3. Confirm the existing production Worker health/config endpoints and run controlled booking checks without generating live customer records.
4. Verify the live site, booking submission, email notification, photo storage, and scheduled retention.

Never place Turnstile secret, Resend API key, or rate-limit salt in site HTML/JavaScript, `.dev.vars`, or source control. Local mock files are ignored by Git.

