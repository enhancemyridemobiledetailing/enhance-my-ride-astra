# Enhance My Ride booking backend

This Worker serves the static site and exposes same-origin `/api/config`, `/api/health`, and `/api/bookings` routes. It uses D1 for booking records and the notification outbox, private R2 storage for submitted photos, Turnstile Siteverify for spam protection, and Resend for booking email to `info@enhancemyride.com`.

## Booking-data retention

Booking details and uploaded photos are retained for 90 days from submission, then removed from D1 and the private R2 bucket by a daily Worker cron at 12:02 UTC. If an R2 deletion fails, its D1 record remains so the next daily run can retry it. Hashed rate-limit entries older than 24 hours are also removed. The notification copy and photo attachments delivered to the business email mailbox are outside this Worker cleanup and must be managed under that mailbox's retention settings.

## Cloudflare setup status

- D1 database `enhance-my-ride-bookings` and its schema are present in the authenticated Cloudflare account; `wrangler.jsonc` contains its database ID.
- R2 bucket `enhance-my-ride-booking-photos` is present, uses the Standard class, and has public access disabled.
- Turnstile widget `Enhance My Ride Booking Form` is configured for `enhancemyride.com`; its public site key is in `wrangler.jsonc`.
- Resend domain `enhancemyride.com` is verified and its DNS records are present. No Resend API key or Worker secret is stored in this repository.
- The Worker has not yet been deployed or attached to the production domain.

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

## Remaining activation steps

1. Create a Resend API key scoped to sending from the verified domain. Add it as Worker secret `RESEND_API_KEY`, and set `MAIL_FROM` to a sender on `enhancemyride.com`.
2. Add the Turnstile secret as Worker secret `TURNSTILE_SECRET_KEY`, and set a random `RATE_LIMIT_SALT` as a Worker secret. Keep both out of source control and frontend files.
3. Deploy the Worker first to its `workers.dev` URL, then verify its health/config endpoints and run a controlled booking request.
4. After those checks pass, attach the Worker to the apex and `www` production hostnames. Keep the existing GitHub Pages DNS records available for rollback.
5. Verify the live site, booking submission, email notification, photo storage, and scheduled retention.

Never place Turnstile secret, Resend API key, or rate-limit salt in site HTML/JavaScript, `.dev.vars`, or source control. Local mock files are ignored by Git.
