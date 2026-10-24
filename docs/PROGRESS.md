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

Notes for the founder: see `docs/DECISIONS.md` (Prisma 6 instead of 7 until adapter packages are approved).
