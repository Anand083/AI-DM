# Progress

| Step                              | Status | Notes                                                                                                             |
| --------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------- |
| 0 Repo and tooling                | Done   | lint, typecheck, unit and E2E pass                                                                                |
| 1 Local infrastructure and config | Done   | env validation, Prisma 6, pino, `/api/health`; verified against real PG + Redis                                   |
| 2 Database schema v1 and seed     | Done   | migration `init`, idempotent seed, tenant guard (unit + real DB tests)                                            |
| 3 Authentication                  | Done   | sign up, verify, login, logout, reset, rate limit; unit, integration, E2E pass                                    |
| 4 Agencies, team, permissions     | Done   | onboarding, TenantContext, can(), withTenantAction, team page, invites; unit + integration + isolation + E2E pass |
| 5 App shell and UI kit            | Done   | sidebar/drawer, top bar, DataTable, dialog, toast, empty/error/loading states, settings page; E2E + axe pass      |
| 6 Clients and projects            | Done   | CRUD, archive, soft delete, domain normalization, plan limits; unit + integration + isolation + E2E pass          |

**Phase A (Steps 0 to 6) is complete.**
| 7 Provider layer and mock SEO provider | Done | interfaces, full mock (rankings, ideas, audit, backlinks, AI, reviews), DataForSEO stub, seoGateway with cache, lock, usage; tests pass |
| 8 Background jobs | Done | 7 BullMQ queues, worker with graceful shutdown, retries, scheduler (15 min), purge job, emails via queue; integration tests with real Redis pass |
| 8b DataForSEO wiring | Done | HTTP client (msw tests), pingback/postback routes, poll job, overrides, provider health; mock stays default |
| 8c DataForSEO sandbox (optional) | Skipped | Needs a free DataForSEO account (credentials). Waiting for the founder. |
| 9 Usage metering and limits | Done | usage period math, assertWithinLimit, gateway guard, team size limit, budget guard (80%/100%), usage page; all tests pass |
| 10 Rank tracker | Done | keywords, scheduled + live checks, rankings table, chart, summary, CSV, mock backfill; unit + integration + E2E pass |
| 11 Site audit | Done | catalog of 23 issues, delayed polling jobs, results with fix text, comparison, monthly auto audit; tests pass |
| 12 Keyword research | Done | search with filters and sparkline, saved lists, add to rank tracker, CSV; repeat searches are free; tests pass |
| 13 Dashboards and alerts | Done | agency dashboard, 3 alert rules with settings, bell + alerts page, daily digest; unit + integration + E2E pass |
| 14 Branding | Done | name, logo (checked + resized), colours with contrast warnings, live preview, storage provider; unit + integration + E2E pass |
| 15 Reports | Done | builder (period, sections, notes), pure assembler, mock summary, PDF (SVG chart) built in the worker, web view, authorized download, public share link with expiry and revoke, noindex; unit + integration + E2E pass |
| 16 Scheduled reports | Done | weekly or monthly schedule per project (agency time zone), 15-minute dispatcher, branded email with PDF attached (link if over 5 MB), never sent twice; schedules page; unit + integration + E2E pass |
| 17 Client portal | Done | invite client users from the client page, branded portal (login, invite, overview, rankings, audit summary, reports and PDF), no platform name in pages, titles, icon or emails; unit + integration + E2E pass |
| 18 Custom domains | Done | behind CUSTOM_DOMAINS_ENABLED (off by default); DNS steps and Verify, host routing in proxy.ts, domain-allowed endpoint, trusted sign-in origin; unit + integration + E2E pass |
| 19 Plans and mock billing | Done | billing provider interface + mock checkout (Pay / Fail payment, signed webhook), idempotent webhook route, subscription state machine, billing page, trial/payment/read-only banner, trial reminders, dev clock; unit + integration + E2E pass |
| 20 Super admin | Done | /admin (404 for others), overview with MRR/churn/margin, agencies list + detail with actions, support sessions (30 min, red banner, logged, billing blocked), queues, data provider, plans editor, platform settings, suspended page, admin:create CLI; unit + integration + E2E pass |
| 21 Security hardening | Done | security headers + CSP, rate limits (actions, public routes, provider callbacks), 2FA (authenticator app, required for admins), sessions page, data export zip, agency deletion, login activity log, CI audit + secret scan, route and action registry test; unit + integration + E2E pass |
| 22 Marketing site and onboarding | Done | home, features, pricing (from the plan table), about, contact form (limited, bot trap), terms and privacy placeholders, robots and sitemap; get-started checklist on the dashboard; in-app help; unit + integration + E2E pass |
| 23 Production Docker | Done | web and worker images, prod compose (caddy, postgres, redis, migrate + seed, backup, optional mailpit), prod env checks, smoke test script and browser check; stack runs locally and data survives a restart |
| 24 CI/CD | Done (pipeline untested) | CI builds and pushes web and worker images to GHCR (SHA + latest) after all checks; manual Deploy workflow over SSH; `scripts/deploy.sh` migrates, smoke tests and rolls back on failure (rollback proven locally); docs/DEPLOY.md lists the GitHub secrets. Real run needs the server from Step 25. |
| 25 AWS server setup | Scripts done, WAITING FOR HUMAN | `scripts/server-setup.sh` and `docs/SERVER-SETUP.md` written. You must do the AWS console steps, run the script, add GitHub secrets, run Deploy, then check the smoke test and a reboot. |
| 26 Backups and operations | Done (S3 upload and monitor need the server) | S3 upload job for the newest dump, restore and restore-test scripts (restore verified locally, row counts match), docs/OPERATIONS.md. Sentry skipped (package not approved). |
| 27 Backlink monitor | Done | tables + weekly snapshot job (modules queue), summary, history, filters (active, new, lost, suspicious), CSV, loss alert, report section, plan-aware window; unit + integration + isolation + E2E pass |
| 28 Competitor analysis | Done | up to 5 competitors per project, free ranking comparison from saved top 10 results, keyword gap job in the worker (cached 7 days), add to rank tracker, report section; unit + integration + isolation + E2E pass |
| 29 AI visibility tracker | Done | questions, brand and engine settings, weekly worker check with plan limit handling, mention rate, share of voice, cited pages, latest answers, mention-lost alert, report section; unit + integration + isolation + E2E pass |
| 30 Local SEO and reviews | Done | link a business, daily worker check, rating history, star counts, review list with suggested replies (summary provider), new-review alert (1 and 2 stars warn), mock reviews that change weekly, report section; unit + integration + isolation + E2E pass |
| 31 Search Console and GA4 | Done (real Google needs a human) | Google provider (mock default, real HTTP code tested with msw), OAuth start and callback with signed state and nonce cookie, tokens encrypted, choose site and property, daily worker sync with refresh and reconnect handling, Analytics tab, overview cards, report section, export covers all tenant tables. Real use needs the OAuth client from docs/GOOGLE-SETUP.md. |
| 32 Lead generation widget | Done | embed script + frameable widget page (only /widget may be framed), agency branding, IP and bot limits, worker mini audit (5 pages) counted as lead audits, neutral messages for visitors, email to owners and admins, Leads page with embed code and delete, export includes leads; unit + integration + E2E (embedded on another site) pass |

Notes for the founder: see `docs/DECISIONS.md` (Prisma 6 instead of 7 until adapter packages are approved).

**Phase F (Steps 27 to 32) is complete.** Phase G (Steps 33 to 36) needs real accounts and paid services, so it is waiting for the founder. Step 25 (server) is also waiting for the founder.

## Phase H (extra features from the founder's list)

| Step                          | Status | Notes                                                                                                                                                                                                                |
| ----------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1 Tasks                      | Done   | tasks with owner, priority, due day, estimate, repeat; create from audit issues; comments; overdue alert; Tasks pages; unit + integration + isolation + E2E pass                                                     |
| H2 Client collaboration       | Done   | client-visible tasks, approvals, client and team comments, milestones with client progress, task templates (built-in and own), report comments, client portal Tasks pages; unit + integration + isolation + E2E pass |
| H3 Reporting extras           | Done   | report templates, timeline notes, goals with daily points and labelled estimates, previous period comparison, data source labels, agency performance page + CSV; unit + integration + E2E pass                       |
| H4 Google breakdowns          | Done   | Search Console by query, page, country and device with change; Analytics landing pages; combined daily table with notes; sharp-fall and reconnect alerts; unit + integration + E2E pass                              |
| H5 AI visibility extras       | Done   | cited websites, competitor comparison, trends by engine and question, AI topic demand and LLM mentions (mock), coverage and freshness labels, evidence-based advice with confidence; unit + integration + E2E pass   |
| H6a Technical SEO             | Done   | Core Web Vitals, duplicate content, schema and sitemap checks, robots and sitemap findings, crawl settings, ignore or mark fixed in bulk, page change monitoring; unit + integration + E2E pass                      |
| H6b URL Inspection            | Done   | ask Google how one page is indexed (worker job, 20 a day per project), plain-English answer, reconnect alert; unit + integration + E2E pass                                                                          |
| H7 Keywords                   | Done   | CSV import, bulk tag and target edit, intent, clusters, opportunity score, page clashes, keyword to page map, volume and Bing positions (mock), trend, ranking change explanations; unit + integration + E2E pass    |
| OpenRouter provider           | Done   | language model writes report summaries and review replies (fixed sentences as backup); tested with fake responses and one real call                                                                                  |
| H8a Backlinks and competitors | Done   | anchor text types, suggested competitors, weekly competitor history, link comparison and link gap, competitor move alerts, links in reports; unit + integration + E2E pass                                           |
| H8b Local                     | Done   | up to 10 locations per project, local positions per location, directory listing consistency with exact differences, sample data labels; unit + integration + E2E pass                                                |
