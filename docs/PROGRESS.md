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

Notes for the founder: see `docs/DECISIONS.md` (Prisma 6 instead of 7 until adapter packages are approved).
