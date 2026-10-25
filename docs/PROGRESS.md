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

Notes for the founder: see `docs/DECISIONS.md` (Prisma 6 instead of 7 until adapter packages are approved).
