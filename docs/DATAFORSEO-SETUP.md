# DataForSEO setup

The app uses fake data (`SEO_PROVIDER=mock`) until you switch it. Do these steps in order.

## 1. Get the API password

1. Sign in at https://app.dataforseo.com and open https://app.dataforseo.com/api-access.
2. Copy your **API login** and **API password**. The API password is not the password you sign in with.
3. Put them in `.env` (never in chat or in git):

```
DATAFORSEO_LOGIN=your login
DATAFORSEO_PASSWORD=your API password
DATAFORSEO_BASE_URL=https://sandbox.dataforseo.com
```

## 2. Try the free Sandbox

The Sandbox answers with made-up data in the real shapes and costs nothing.

```
pnpm dataforseo:check
```

Each line says `ok` or `FAIL`. If a line fails, send the line to the developer. The check covers
rankings, Bing rankings, keyword ideas and metrics, ranked keywords, backlinks, referring domains
and the site audit. The vendor docs say AI endpoints are not in the Sandbox.

## 3. Switch to real data

Change `DATAFORSEO_BASE_URL=https://api.dataforseo.com`, set `SEO_PROVIDER=dataforseo`, restart the
web app and the worker. Add money to the DataForSEO account first. Real calls cost money; the
platform budget guard (`MONTHLY_PROVIDER_BUDGET_USD`) pauses paid work when it is used up.

## What does not work with DataForSEO yet

Directory listing checks, AI visibility checks, AI topic demand, AI answer mentions and review
tracking. The app shows a "Not available yet" notice on those pages and does not start the work.
Google Search Console, Google Analytics, URL Inspection and business profiles are not DataForSEO
features; they need the Google setup in `docs/GOOGLE-SETUP.md`.
