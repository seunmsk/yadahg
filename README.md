# Yadah-G Global Insurance Brokers — website

A fast, secure (HTTPS) replacement for yadahg.com, built to run on Cloudflare Pages at no monthly cost.

## What it does
- **Instant premium estimator** for motor, home, health, life, group life, industrial all risk, fire, goods in transit and professional indemnity.
- **Quote requests**, **claim reporting** (with photo/PDF upload) and **claim tracking** by reference and phone number.
- **Renewal reminders** with a days-to-expiry countdown.
- **Corporate risk review** booking and **call-back** requests.
- WhatsApp buttons everywhere (+234 802 321 6201).
- **Staff desk** at `/#admin`: see every request, update claim stages (customers see them when tracking), sort renewals by expiry, message clients on WhatsApp, and edit the estimator's rates.

Without storage connected, the site runs in **preview mode**: forms save in the visitor's browser only.

## Go live on Cloudflare (about 10 minutes)
1. **Workers & Pages → Create → Pages → Connect to Git** and pick this repo.
   Framework preset: **None**. Build command: *(empty)*. Build output directory: *(empty, the site is at the repo root)*.
2. **Storage & Databases → KV → Create** a namespace called `yadahg-data`.
   Optional: **R2 → Create bucket** called `yadahg-files` (for claim photos).
3. **Workers & Pages → yadahg → Settings → Bindings**, add:
   - KV namespace, variable name `DB` → `yadahg-data`
   - R2 bucket, variable name `FILES` → `yadahg-files` (optional)
4. **Settings → Variables and Secrets**, add a secret `ADMIN_PASSWORD` (long and private).
   Optional email alerts: `RESEND_API_KEY`, `NOTIFY_EMAIL` (e.g. `info@yadahg.com`), `FROM_EMAIL`.
5. **Deployments → latest → Retry deployment.**
6. Open `/#admin`. When the badge says **Live** and the preview banner is gone, it's working.
7. **Custom domains → Set up a custom domain** → `yadahg.com` and `www.yadahg.com`. Cloudflare issues the SSL certificate automatically.

## Editing
- Text and design: `index.html`.
- API: `functions/api/[[path]].js`.
- Estimate rates: change them in the staff desk, no code needed.

Estimates are indicative. Defaults: motor comprehensive 3–5% of vehicle value; third-party private car ₦15,000 (NAICOM minimum since Jan 2023); group life sum assured at least 3× annual emoluments (Pension Reform Act 2014). Confirm current rates with the team before launch.
