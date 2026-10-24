# SEO Agency Platform: Build Plan

## 1. How to Use This Plan
- Build steps in order (Step 0 to Step 36, including Steps 8b and 8c). Each step lists tests that must pass.
- All SEO data and payments are MOCKED until Phase G. The app must look and behave like the real product using realistic fake data.
- Steps marked [HUMAN] need the founder to do something (AWS console, accounts, decisions).
- The product name is not final. Use `APP_NAME` from env everywhere. No hardcoded brand.
- There is no domain yet. The app must work on `localhost` and on a server IP or `<ip>.sslip.io` hostname.

## 2. Product Scope

### 2.1 Users
| User | What they do |
|---|---|
| Super admin (founder) | Manages all agencies, plans, usage, costs |
| Agency owner | Pays, manages team, branding, everything in the agency |
| Agency admin | Same as owner except billing and deleting the agency |
| Agency member | Works on clients, projects, keywords, audits, reports |
| Client user | Read-only branded portal for their own projects and reports |

### 2.2 Modules
Core (Phases A to D): auth, agencies, team, clients, projects, rank tracker, site audit, keyword research, alerts, dashboards, branding, reports (PDF and share link), scheduled reports, client portal, custom domains (behind a flag), plans and mock billing, usage limits, super admin.

Extra (Phase F): backlink monitor, competitor analysis, AI visibility tracker, local SEO and reviews, Google Search Console and GA4, lead generation widget.

### 2.3 Not in scope now
Mobile apps, multi-language UI, real payments, real SEO data, content writing tools, CRM, SSO.

## 3. Tech Stack
| Area | Choice |
|---|---|
| Language | TypeScript (strict) |
| Web app | Next.js (latest stable, App Router), Server Components, Server Actions |
| UI | Tailwind CSS, shadcn/ui, lucide-react, Recharts, TanStack Table |
| Forms | react-hook-form + Zod |
| Database | PostgreSQL 16 + Prisma |
| Auth | Better Auth (email + password, DB sessions, email verification, password reset, 2FA plugin) |
| Jobs | BullMQ + Redis, separate worker process |
| Email | Nodemailer + React Email. Dev and testing: Mailpit |
| PDF | @react-pdf/renderer (no headless browser, low memory) |
| Files | Storage provider: local disk now, S3 later |
| Logging | pino (JSON) |
| Tests | Vitest (unit, integration), Playwright (E2E), axe (accessibility) |
| Packages | pnpm |
| Deploy | Docker Compose on one EC2 instance, Caddy reverse proxy, images in GitHub Container Registry |

Use the latest stable versions at Step 0 and record them in `docs/DECISIONS.md`.

## 4. Architecture
```
Browser -> Caddy (HTTPS, reverse proxy)
             -> web (Next.js): pages, server actions, API routes
                  -> services -> Postgres
                              -> Redis (queues, rate limits, locks)
worker (BullMQ, internal only): rank checks, audits, reports, emails, alerts
  -> services -> providers: seo (mock | dataforseo), billing (mock), email, storage, summary
DataForSEO (later) -> pingback / postback routes -> web -> queue -> worker
```
Rules:
- Pages call services. Services call Prisma and providers. Components never call Prisma or providers.
- Web and worker share one codebase. Worker entry: `src/worker/index.ts`.
- "Check now" style actions enqueue a job and the UI polls for the result.

## 5. Folder Structure
```
.
├─ CLAUDE.md
├─ docs/ (PLAN.md, PROGRESS.md, DECISIONS.md, OPERATIONS.md)
├─ docker/ (web.Dockerfile, worker.Dockerfile, Caddyfile)
├─ docker-compose.yml            # dev services
├─ docker-compose.prod.yml
├─ prisma/ (schema.prisma, migrations/, seed.ts)
├─ scripts/ (server-setup.sh, smoke-test.sh, restore.sh, mock-backfill.ts, admin-create.ts)
├─ src/
│  ├─ app/
│  │  ├─ (marketing)/            # home, pricing, features
│  │  ├─ (auth)/                 # login, signup, reset, verify, invite/[token]
│  │  ├─ app/[agencySlug]/       # agency app
│  │  ├─ portal/[agencySlug]/    # client portal
│  │  ├─ admin/                  # super admin
│  │  ├─ r/[shareToken]/         # public report share
│  │  └─ api/                    # health, webhooks, providers/dataforseo, widget, internal
│  ├─ components/ (ui/, charts/, layout/)
│  ├─ server/
│  │  ├─ auth/ (better-auth.ts, permissions.ts, tenant-context.ts, actions.ts)
│  │  ├─ db/ (client.ts, tenant-guard.ts, admin-client.ts)
│  │  ├─ services/               # one folder per module
│  │  ├─ providers/ (seo/, billing/, email/, storage/, summary/)
│  │  ├─ jobs/ (queues.ts, scheduler.ts, processors/)
│  │  ├─ audit/issue-catalog.ts
│  │  └─ admin/
│  ├─ worker/index.ts
│  ├─ data/ (locations.ts, languages.ts, competitor-domains.ts)
│  ├─ emails/                    # React Email templates
│  ├─ lib/ (utils, formatting, shared zod schemas)
│  └─ env.ts
└─ tests/ (factories/, integration/, integration/isolation/, e2e/, fixtures/, fixtures/dataforseo/)
```

## 6. Environment Variables (`.env.example`)
```bash
# App
NODE_ENV=development
APP_NAME="SEO Platform"              # placeholder until final name
APP_URL=http://localhost:3000
LOG_LEVEL=info

# Database and cache
DATABASE_URL=postgresql://app:app@localhost:5432/app
DATABASE_URL_TEST=postgresql://app:app@localhost:5433/app_test
REDIS_URL=redis://localhost:6379

# Auth
BETTER_AUTH_SECRET=change-me-at-least-32-characters
BETTER_AUTH_URL=http://localhost:3000
COOKIE_SECURE=false

# SEO data provider
SEO_PROVIDER=mock                    # mock | dataforseo
SEO_PROVIDER_OVERRIDES=              # e.g. "rankings=dataforseo,audit=mock"
ALLOW_MOCK_IN_PROD=false
MOCK_LATENCY_MS=200
MOCK_FAILURE_RATE=0
MOCK_AUDIT_SECONDS=20
MONTHLY_PROVIDER_BUDGET_USD=50

# DataForSEO (unused until Step 8c or Phase G)
DATAFORSEO_LOGIN=
DATAFORSEO_PASSWORD=
DATAFORSEO_BASE_URL=https://sandbox.dataforseo.com   # or https://api.dataforseo.com
DATAFORSEO_CALLBACK_MODE=poll                        # poll | pingback | postback
DATAFORSEO_CALLBACK_SECRET=change-me

# Billing
BILLING_PROVIDER=mock                # mock | stripe | razorpay
MOCK_BILLING_WEBHOOK_SECRET=change-me

# Email
EMAIL_PROVIDER=smtp                  # console | smtp | ses
SMTP_HOST=localhost
SMTP_PORT=1025
EMAIL_FROM="SEO Platform <no-reply@localhost>"

# Storage
STORAGE_PROVIDER=local               # local | s3
STORAGE_LOCAL_DIR=./storage
S3_BUCKET=
AWS_REGION=

# Other
SUMMARY_PROVIDER=mock
CUSTOM_DOMAINS_ENABLED=false
WORKER_CONCURRENCY=2
SENTRY_DSN=
ENCRYPTION_KEY=change-me-32-bytes    # OAuth tokens (Step 31)
```

## 7. Data Model

### 7.1 Tenancy rules
- Every tenant-owned table has a required, indexed `agencyId`.
- IDs are cuid2 strings. Never sequential numbers in URLs.
- Services receive `TenantContext { userId, agencyId, role, clientIds?: string[] }`.
- Prisma client extension `src/server/db/tenant-guard.ts` throws (in dev and test) if a read, update, or delete on a tenant model has no `agencyId` in `where`. Super admin code uses a separate `adminDb` client, only inside `src/server/admin`.
- Soft delete (`deletedAt`) for agencies, clients, projects. A maintenance job purges after 30 days.

### 7.2 Models
Platform and auth:
- `User`: Better Auth fields + `isSuperAdmin`, `timezone`.
- Better Auth tables: `Session`, `Account`, `Verification`.
- `Agency`: name, slug (unique), timezone, status (ACTIVE, SUSPENDED, DELETED), deletedAt.
- `AgencyMember`: agencyId, userId, role (OWNER, ADMIN, MEMBER). Unique (agencyId, userId).
- `Invitation`: agencyId, email, role (ADMIN, MEMBER, CLIENT), clientId (for CLIENT), tokenHash, expiresAt, acceptedAt, invitedById.
- `Client`: agencyId, name, website, contactName, contactEmail, notes, status (ACTIVE, ARCHIVED).
- `ClientUser`: agencyId, clientId, userId. Unique (clientId, userId).
- `Project`: agencyId, clientId, name, domain (normalized), locationCode, languageCode, device (DESKTOP, MOBILE), rankCheckFrequency (DAILY, WEEKLY), rankCheckHourUtc.

SEO data:
- `Keyword`: agencyId, projectId, phrase (lowercase, trimmed), tags (text[]), targetUrl. Unique (projectId, phrase).
- `RankCheck`: agencyId, keywordId, date, checkedAt, position (null = not in top 100), rankingUrl, serpFeatures (json), topResults (json: top 10 {position, domain, url, title}), provider. Unique (keywordId, date).
- `Audit`: agencyId, projectId, status (QUEUED, RUNNING, COMPLETED, FAILED), providerTaskId, progress, maxPages, pagesCrawled, healthScore, counts (json), startedAt, finishedAt, error.
- `AuditPage`: agencyId, auditId, url, statusCode, title, loadTimeMs, wordCount, issueCount.
- `AuditIssue`: agencyId, auditId, code, severity (CRITICAL, WARNING, NOTICE), url, details (json).
- `KeywordList`, `KeywordListItem`: saved research (phrase, volume, cpc, difficulty, intent).
- `Alert`: agencyId, projectId, type (RANK_DROP, RANK_GAIN, AUDIT_CRITICAL, BACKLINKS_LOST, AI_MENTION_LOST, NEW_REVIEW), severity, title, body, data (json), readAt, emailedAt.

White label and reports:
- `Branding` (1:1 Agency): displayName, logoKey, primaryColor, accentColor, supportEmail, website, customDomain (unique, nullable), customDomainStatus (NONE, PENDING, VERIFIED, FAILED), domainVerifyToken.
- `Report`: agencyId, clientId, projectId, title, periodStart, periodEnd, sections (json), notes, status (QUEUED, GENERATING, READY, FAILED), fileKey, summaryText, shareToken (unique), shareExpiresAt, createdById.
- `ReportSchedule`: agencyId, projectId, frequency (WEEKLY, MONTHLY), dayOfWeek, dayOfMonth, hourLocal, recipients (text[]), sections (json), active, nextRunAt, lastRunAt.

Billing, usage, providers:
- `Plan`: code (unique), name, currency, priceMonthlyCents, priceYearlyCents, limits (json, see 9.6), isPublic, sortOrder.
- `Subscription` (1:1 Agency): planId, status (TRIALING, ACTIVE, PAST_DUE, CANCELED, EXPIRED), interval (MONTH, YEAR), provider (MOCK, STRIPE, RAZORPAY), providerCustomerId, providerSubscriptionId, trialEndsAt, currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd, graceEndsAt.
- `Invoice`: agencyId, provider, providerInvoiceId, amountCents, currency, status, issuedAt, pdfUrl.
- `BillingEvent`: provider, providerEventId (unique), type, payload (json), processedAt, error.
- `UsageRecord`: agencyId, projectId, metric (RANK_CHECK, LIVE_CHECK, AUDIT_PAGE, KEYWORD_RESEARCH, BACKLINK_QUERY, COMPETITOR_QUERY, AI_CHECK, REVIEW_QUERY, LEAD_AUDIT), quantity, costMicros, provider, requestHash, createdAt. Index (agencyId, metric, createdAt).
- `ProviderCache`: provider, operation, requestHash (unique), response (json), expiresAt.
- `PendingProviderTask`: provider, operation, providerTaskId (unique), agencyId, projectId, tag (our job ID), requestHash, status (PENDING, READY, PROCESSED, FAILED), attempts, createdAt, readyAt, processedAt.

Platform:
- `ActivityLog`: agencyId, actorUserId, impersonatorUserId, action, targetType, targetId, metadata (json), ip, createdAt.
- `PlatformSetting`: key, value (json). Budget, feature flags, maintenance mode.

Phase F models are added in their own steps.

## 8. Roles and Permissions
One table in `src/server/auth/permissions.ts` behind `can(role, action)`. Unit test every cell.

| Action | Owner | Admin | Member | Client |
|---|---|---|---|---|
| View clients, projects, data | Yes | Yes | Yes | Own client only |
| Create or edit clients, projects, keywords | Yes | Yes | Yes | No |
| Delete clients or projects | Yes | Yes | No | No |
| Run audits, research, check now | Yes | Yes | Yes | No |
| Create reports and schedules | Yes | Yes | Yes | No |
| Download reports | Yes | Yes | Yes | Own client only |
| Invite or remove team members | Yes | Yes (not owners) | No | No |
| Invite client users | Yes | Yes | Yes | No |
| Edit branding and custom domain | Yes | Yes | No | No |
| Billing and plan changes | Yes | No | No | No |
| Export or delete agency | Yes | No | No | No |

Super admin (`User.isSuperAdmin`) only applies to `/admin`.

## 9. Provider Layer

### 9.1 Pattern
Each external service has an interface, a mock, and later a real implementation. A factory picks one from env.
```
src/server/providers/
  seo/      types.ts, index.ts, pricing.ts, mock/, dataforseo/ (client.ts, adapter.ts, mappers/)
  billing/  types.ts, index.ts, mock/
  email/    types.ts, index.ts, console.ts, smtp.ts, ses.ts (stub)
  storage/  types.ts, index.ts, local.ts, s3.ts
  summary/  types.ts, index.ts, mock.ts (templated text now, LLM later)
```

### 9.2 SEO provider interface (internal types only, never vendor shapes)
```ts
interface SeoDataProvider {
  name: "mock" | "dataforseo";
  testConnection(): Promise<{ ok: boolean; balanceUsd?: number; message?: string }>;
  getRankings(i: { domain: string; keywords: string[]; locationCode: number; languageCode: string; device: "desktop" | "mobile"; priority: "standard" | "live" }): Promise<RankResult[]>;
  getKeywordIdeas(i: { seed: string; locationCode: number; languageCode: string; limit: number }): Promise<KeywordIdea[]>;
  startAudit(i: { domain: string; maxPages: number }): Promise<{ taskId: string }>;
  getAuditStatus(taskId: string): Promise<{ status: "queued" | "running" | "completed" | "failed"; progress: number }>;
  getAuditResult(taskId: string): Promise<AuditResult>;
  getBacklinkSummary(domain: string): Promise<BacklinkSummary>;
  getBacklinks(i: { domain: string; limit: number; offset: number }): Promise<Backlink[]>;
  getRankedKeywords(i: { domain: string; locationCode: number; languageCode: string; limit: number }): Promise<RankedKeyword[]>;
  checkAiVisibility(i: { prompt: string; brand: string; domain: string; engine: AiEngine }): Promise<AiVisibilityResult>;
  getReviews(i: { businessName: string; locationCode: number }): Promise<ReviewSummary>;
  estimateCostMicros(op: SeoOperation, units: number, priority?: "standard" | "live"): number;
}
```

### 9.3 Mock SEO provider rules
- Deterministic: seed a small PRNG (for example mulberry32) with a hash of operation + normalized input + UTC date. Same input on the same day gives the same output. The next day changes a little.
- Rankings: each (domain, keyword) has a stable base position: 15% in 1 to 3, 25% in 4 to 10, 25% in 11 to 30, 20% in 31 to 100, 15% not ranking. Daily movement is a small random walk (mostly 0 to 3 positions). About 2% of keywords per day drop 10+ positions so alerts can be tested. Top 10 results mix the project domain with fake competitor domains from `src/data/competitor-domains.ts`.
- Keyword ideas: variations of the seed with modifiers (best, near me, price, how to, vs, for beginners, review, cheap, current year). Volume log-normal from 10 to 100,000, CPC 0.10 to 15.00, difficulty 0 to 100, intent from the modifier, 12-month trend.
- Audit: async. Status goes queued, then running with rising progress, then completed after `MOCK_AUDIT_SECONDS`. Pages 20 to 300 (capped by maxPages). Issues come from the issue catalog (Step 11).
- Latency from `MOCK_LATENCY_MS`. Random failures at `MOCK_FAILURE_RATE` (0 to 1) to test retries.
- `testConnection()` always returns ok with a fake balance.
- When the mock is active, the agency app shows a small "Demo data" badge. Production refuses to start with the mock unless `ALLOW_MOCK_IN_PROD=true`.

### 9.4 Cost estimates
Unit costs live in `providers/seo/pricing.ts` as micro-dollars, with a comment to verify against DataForSEO's pricing page before go-live. Every provider call records a `UsageRecord` with `costMicros`, even with the mock, so cost and margin screens work from day one. When the real API returns an actual cost, save that instead of the estimate.

### 9.5 Cache, dedupe, budget
- `requestHash` = sha256 of operation + normalized input (+ date for rankings).
- Check `ProviderCache` before every call. TTLs: rankings until end of UTC day, keyword ideas 30 days, ranked keywords 7 days, backlinks 7 days, reviews 1 day.
- Dedupe: Redis lock on `requestHash` so the same request is never sent twice at once. Real APIs may charge for duplicates.
- Budget guard: sum of `costMicros` this month vs `MONTHLY_PROVIDER_BUDGET_USD`. At 80%, alert super admin. At 100%, pause all scheduled jobs and show a banner in admin.
- All modules call providers only through a `seoGateway` service that applies limits, cache, dedupe, usage, and budget.

### 9.6 Plan limits (`Plan.limits`, -1 means unlimited)
```json
{ "maxClients": 5, "maxProjects": 5, "maxKeywords": 250, "maxTeamMembers": 2, "maxClientUsers": 5,
  "auditPagesPerMonth": 2000, "keywordResearchPerMonth": 100, "liveChecksPerMonth": 50,
  "aiChecksPerMonth": 100, "backlinkQueriesPerMonth": 50, "leadAuditsPerMonth": 50,
  "reportSchedules": 5, "customDomain": false, "whiteLabel": true }
```
Seed: STARTER (5 clients, 250 keywords), GROWTH (20 clients, 1,000 keywords), AGENCY (unlimited clients, 3,000 keywords). Prices editable in admin.

### 9.7 DataForSEO Connection Points (build now, use later)

**Provider selection**
- `SEO_PROVIDER` sets the default. `SEO_PROVIDER_OVERRIDES` lets each module use a different provider (for example real rankings, mock audits). Module keys: rankings, keywords, audit, backlinks, competitors, ai, reviews.

**HTTP client** (`providers/seo/dataforseo/client.ts`)
- HTTP Basic auth with `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD`, base URL from `DATAFORSEO_BASE_URL`, 30s timeout.
- Retry on 429 and 5xx with exponential backoff (max 3).
- Check DataForSEO status codes inside the response body, not only the HTTP status. Map errors to internal error types.
- Read the real `cost` field from responses and save it in `UsageRecord.costMicros`.
- Log path, task IDs, cost, duration. Never log credentials.
- All vendor response shapes are mapped to internal types in `dataforseo/mappers/`. Nothing outside the adapter sees vendor shapes.

**Endpoint map** (verify every path in docs.dataforseo.com/v3 before coding)
| Method | DataForSEO endpoint |
|---|---|
| testConnection | GET /v3/appendix/user_data |
| getRankings (standard) | POST /v3/serp/google/organic/task_post, GET .../tasks_ready, GET .../task_get/advanced/{id} |
| getRankings (live) | POST /v3/serp/google/organic/live/advanced |
| getKeywordIdeas | POST /v3/dataforseo_labs/google/keyword_ideas/live (or related_keywords/live) |
| search volume | POST /v3/keywords_data/google_ads/search_volume/live |
| startAudit | POST /v3/on_page/task_post |
| getAuditStatus | GET /v3/on_page/summary/{id} |
| getAuditResult | POST /v3/on_page/pages, /v3/on_page/links |
| getBacklinkSummary | POST /v3/backlinks/summary/live |
| getBacklinks | POST /v3/backlinks/backlinks/live |
| getRankedKeywords | POST /v3/dataforseo_labs/google/ranked_keywords/live |
| competitors, keyword gap | POST /v3/dataforseo_labs/google/competitors_domain/live, domain_intersection/live |
| checkAiVisibility | AI Optimization API (LLM responses and LLM mentions endpoints) |
| getReviews | POST /v3/business_data/google/reviews/task_post, then task_get |
| locations, languages | GET /v3/serp/google/locations, /v3/serp/google/languages |

**Task tracking**
- Every async task sent to DataForSEO creates a `PendingProviderTask` row. The `tag` field carries our internal job ID.

**Inbound routes** (no user session, rate limited, logged, excluded from CSRF checks)
- `GET /api/providers/dataforseo/pingback?id=$id&tag=$tag&secret=...`
  Check secret, find task by providerTaskId, mark READY, enqueue a job that calls task_get. Return 200 fast. Never trust data in the request; always fetch results from the API.
- `POST /api/providers/dataforseo/postback?secret=...`
  Check secret, gunzip body, confirm task ID exists and is PENDING, store result, enqueue processing. Idempotent: a second delivery of the same task does nothing.
- Unknown task ID returns 404. Bad secret returns 401.

**Callback modes** (`DATAFORSEO_CALLBACK_MODE`)
- `poll` (default, works on localhost): a job every 5 minutes calls tasks_ready per operation and processes ready tasks.
- `pingback` or `postback` (needs a public HTTPS URL): task_post includes the callback URL. The poll job still runs every 30 minutes and picks up any task PENDING for more than 30 minutes, as a safety net for missed callbacks.

**Health check**
- `/api/health` includes provider status, cached 5 minutes, using `testConnection()` only (no cost).

## 10. Testing Rules
- Unit (Vitest): pure logic, permissions, formulas, mock generator, state machines. `*.test.ts` next to the code.
- Integration (Vitest): services against a real Postgres test DB and real Redis from Docker. Truncate between test files. Factories in `tests/factories`.
- E2E (Playwright): real browser against the dev server with seeded data. Helpers for login and reading emails from the Mailpit API.
- Tenant isolation suite (`tests/integration/isolation/`): creates Agency A and Agency B and checks every service and route returns not found for the other agency's IDs. Every step that adds a tenant model or route adds cases here.
- External HTTP (DataForSEO, Google, payments) is mocked with msw in tests. CI never calls the network.
- Accessibility: axe on main pages, no serious or critical violations.
- CI runs lint, typecheck, unit, integration, and E2E on every push.
- Coverage target: 80% for `src/server/services` and `src/server/providers/seo/mock`.

## 11. Build Steps

### Phase A: Foundation

**Step 0: Repo and tooling**
Build:
- Next.js + TypeScript strict, Tailwind, shadcn/ui, ESLint, Prettier, pnpm.
- Vitest and Playwright configured. Scripts: dev, build, start, lint, typecheck, test, test:unit, test:integration, test:e2e, db:migrate, db:seed, worker:dev.
- `docs/PROGRESS.md`, `docs/DECISIONS.md`, `.env.example`, `README.md` (run locally).
- GitHub Actions: lint, typecheck, tests.
Tests:
- One sample unit test and one E2E test that opens the home page. CI green.

**Step 1: Local infrastructure and config**
Build:
- `docker-compose.yml`: postgres, postgres-test, redis, mailpit.
- `src/env.ts` with Zod. App fails fast with a clear message on missing or bad vars.
- Prisma setup, `src/server/db/client.ts`, pino logger, `GET /api/health` (checks DB and Redis).
Tests:
- Unit: env validation rejects bad or missing values.
- Integration: health returns ok with services up; reports failure when Redis is unreachable.

**Step 2: Database schema v1 and seed**
Build:
- Prisma models for platform, auth, tenancy, clients, projects, plans, subscriptions, activity log.
- Tenant guard extension (7.1).
- `prisma/seed.ts`: super admin, plans, Agency One and Agency Two with owners and members, 3 clients and 2 projects each. Idempotent. Demo passwords printed only in dev.
Tests:
- Migration runs on an empty DB. Seed runs twice with no duplicates.
- Tenant guard throws without `agencyId` and passes with it.

**Step 3: Authentication**
Build:
- Better Auth: email and password, DB sessions, email verification, forgot and reset password, logout.
- Email provider (console, SMTP to Mailpit), React Email templates (verify, reset, invite).
- Redis rate limiting on sign-in, sign-up, reset (for example 5 per 15 minutes per IP and per email).
- Pages: /login, /signup, /forgot-password, /reset-password, /verify-email.
Tests:
- E2E: sign up, open verify link from Mailpit, log in, log out. Reset password flow.
- Unit: rate limiter. Integration: unverified users cannot reach /app.

**Step 4: Agencies, team, permissions**
Build:
- Onboarding after first login: create agency (name, slug, timezone from browser). Creator becomes OWNER. Start a 14-day TRIALING subscription on STARTER (mock).
- `TenantContext` loader for `/app/[agencySlug]/*`; 404 if not a member.
- `can()` table (section 8) and `withTenantAction()` wrapper for server actions (auth + permission + Zod).
- Team page: invite by email with role, resend, revoke, accept (new or existing user), change role, remove. Agency switcher.
- Activity log entries for these actions.
Tests:
- Unit: every permission cell.
- Integration: isolation cases for agencies and members; admin cannot remove an owner.
- E2E: owner invites member, member accepts from Mailpit link and sees the agency.

**Step 5: App shell and UI kit**
Build:
- Layout: sidebar (Dashboard, Clients, Projects, Reports, Team, Branding, Billing, Usage, Settings), top bar with agency switcher, user menu, notification bell placeholder, "Demo data" badge.
- Shared components: data table (sort, filter, paginate), forms, dialogs, toasts, empty states, skeletons, error boundary, 404 page.
- Agency settings page (name, timezone).
Tests:
- E2E: every menu item opens without errors. axe passes on dashboard and settings.

**Step 6: Clients and projects**
Build:
- Clients: list, create, edit, archive, soft delete.
- Projects under clients: domain (normalize and validate), location and language from `src/data/locations.ts` (DataForSEO-style codes such as 2840 United States, 2826 United Kingdom; verify codes later), device, check frequency.
- Plan count limits (maxClients, maxProjects) with a clear upgrade message.
Tests:
- Unit: domain normalization (protocol, www, trailing slash, invalid input).
- Integration: CRUD, limits, isolation cases.
- E2E: create client and project, see them listed.

### Phase B: Data Engine and SEO Modules

**Step 7: Provider layer and mock SEO provider**
Build:
- Interfaces and factory (section 9). Full mock provider (9.3). Empty DataForSEO adapter folder with methods throwing `NotImplementedError`.
- `seoGateway` service with cache, dedupe lock, usage recording, cost estimates (9.4, 9.5).
- Production guard for the mock.
Tests:
- Unit: same input same day gives same output; next day differs; ranking distribution roughly matches targets over 10,000 samples; failure rate works.
- Integration: identical second call hits cache (provider called once); concurrent identical calls make one provider call; usage records include cost.

**Step 8: Background jobs**
Build:
- BullMQ queues: rank-checks, audits, reports, emails, alerts, provider-tasks, maintenance. Worker with graceful shutdown, concurrency from env, 3 retries with exponential backoff, failed jobs kept 7 days.
- Idempotent job IDs (for example `rank:{projectId}:{yyyy-mm-dd}`).
- Scheduler every 15 minutes: enqueue projects due for rank checks (by `rankCheckHourUtc`), spread across the hour.
- Dev script prints queue counts (admin page comes in Step 20).
Tests:
- Integration (real Redis): job runs; failing job retries then lands in failed; duplicate job ID ignored; shutdown waits for the active job.

**Step 8b: DataForSEO wiring (mock data stays default)**
Build:
- Everything in section 9.7 except full method implementations: HTTP client, mappers folder, `PendingProviderTask` model, pingback and postback routes, poll job, callback modes, health check integration.
- Factory reads `SEO_PROVIDER_OVERRIDES` so each module can use a different provider.
- Adapter methods stay `NotImplementedError` except a working `testConnection()`.
Tests:
- Unit (msw): client sends Basic auth, retries on 429 and 5xx, maps error status codes, reads cost.
- Integration: pingback with bad secret returns 401; unknown ID returns 404; valid pingback enqueues exactly one job; duplicate postback processed once; gzip body parsed.
- Integration: poll job picks up READY tasks and stale PENDING tasks.
- Integration: overrides route rankings to one provider and audits to another.

**Step 8c (optional) [HUMAN: free DataForSEO account]**
Build:
- Implement adapter methods against the free sandbox (`DATAFORSEO_BASE_URL=https://sandbox.dataforseo.com`). Sandbox returns dummy data, so this tests wiring, not data quality.
- Record sandbox responses as fixtures in `tests/fixtures/dataforseo/`.
Tests:
- Contract tests: every mapper turns recorded fixtures into valid internal types. CI uses fixtures only, never the network.

**Step 9: Usage metering and limits**
Build:
- `usageService`: current period from subscription, usage by metric, `assertWithinLimit(ctx, metric, qty)` throwing `LimitExceededError`.
- Gateway checks limits before every call. Count limits for keywords, team members, client users.
- Usage page: bar per metric with percent used and reset date.
- Platform budget guard (9.5).
Tests:
- Unit: period math (monthly, yearly, trial) and unlimited (-1).
- Integration: at the limit, the call is blocked and the provider is never called; at 100% budget, scheduled jobs pause.

**Step 10: Rank tracker**
Build:
- Add keywords: bulk paste (one per line), dedupe, tags, optional target URL. Limits enforced.
- Scheduled checks in the worker in batches of 100. "Check now" uses live priority, counts against `liveChecksPerMonth`, runs as a job, UI polls.
- Rankings table: keyword, position, change (1d, 7d, 30d), best position, ranking URL, SERP features, tags. Filters, CSV export.
- Keyword detail: position history chart (inverted axis), top 10 results.
- Project overview: average position, visibility score, distribution (1-3, 4-10, 11-20, 21-50, 51-100, not ranking), top movers.
- `pnpm mock:backfill --days 90` creates history.
Formulas:
- Change = previous position minus current (positive = improved). Not ranking counts as 101 in math, shown as "100+".
- Visibility = average CTR weight across keywords x 100. Weights: pos 1 = 0.30, 2 = 0.15, 3 = 0.10, 4 = 0.07, 5 = 0.05, 6-10 = 0.03, 11-20 = 0.01, else 0.
Tests:
- Unit: change, visibility, distribution.
- Integration: one RankCheck per keyword per day, usage recorded, no duplicates when run twice.
- E2E: add 10 keywords, run check, see table and chart.

**Step 11: Site audit**
Build:
- `src/server/audit/issue-catalog.ts`: code, title, severity, why it matters, how to fix (simple English). At least: missing title, duplicate title, title too long, missing meta description, duplicate meta description, missing H1, multiple H1, 4xx links, 5xx errors, redirect chains, slow pages, large images, missing alt text, no HTTPS, mixed content, noindex pages, missing canonical, thin content, missing structured data, not mobile friendly, missing sitemap, robots.txt blocking, orphan pages.
- Start audit (max pages from plan). Job polls the provider with delayed jobs every 10 seconds until done, then stores pages and issues.
- Results: health score, issues by severity, issue detail with affected URLs and how to fix, pages table, compare to previous audit (fixed, new, still present).
- Optional monthly scheduled audit per project.
Formula: health = round(100 x (1 - min(1, (3 x critical + warning + 0.2 x notice) / (2 x pages)))).
Tests:
- Unit: health score, compare logic.
- Integration: full lifecycle with mock; usage = pages crawled; provider failure sets FAILED with error.
- E2E: start audit, wait, see score and issues.

**Step 12: Keyword research**
Build:
- Seed keyword, location, language. Results: keyword, volume, CPC, difficulty, intent, trend sparkline. Sort and filter by volume, difficulty, intent.
- Save to keyword lists, "Add to rank tracker", CSV export.
- Repeat searches come from cache and do not count against limits.
Tests:
- Integration: repeat search uses cache with no new usage; limit enforced.
- E2E: search, filter, add 3 keywords to rank tracker.

**Step 13: Dashboards and alerts**
Build:
- Agency dashboard: every client with average position trend, last audit score, open alerts; usage summary.
- Alert rules after jobs: drop of 5+ positions for a keyword in top 20, entered top 10, new critical audit issues. Thresholds in agency settings.
- Notification bell with unread count, alerts page, mark as read, optional daily email digest.
Tests:
- Unit: each alert rule.
- Integration: a forced rank drop creates exactly one alert.
- E2E: alert appears in bell and can be marked read.

### Phase C: White Label, Reports, Client Portal

**Step 14: Branding**
Build:
- Settings: display name, logo (PNG, JPG, WebP only, max 1 MB, resized), primary and accent colors (hex, warn on low contrast), support email, website. Live preview.
- Storage provider (local volume now, S3 later). Files served through an authorized route.
- Branding applied as CSS variables in portal, reports, and client emails. Agency app shows the agency logo.
Tests:
- Unit: color validation and contrast.
- Integration: rejects SVG and oversized files.
- E2E: change color and logo, preview updates.

**Step 15: Reports**
Build:
- Builder: project, period (last 7 days, last 30 days, last month, custom), sections (summary KPIs, ranking distribution, top movers, full rankings, audit health, top issues, keyword opportunities, notes). Phase F sections register here later.
- Report assembler service: pure function from DB data to a typed report model.
- Web view and PDF (@react-pdf/renderer) from the same model. Charts as simple SVG in the PDF.
- Mock summary provider writes a short plain-English summary from the numbers.
- Share link with token and expiry, `noindex`. Report list with status and download. Generation runs in the worker.
Tests:
- Unit: assembler with fixtures.
- Integration: PDF is non-empty, contains the agency display name, and does NOT contain `APP_NAME`.
- E2E: build and download report; share link works logged out; expired link returns 404.

**Step 16: Scheduled reports**
Build:
- Per project: weekly (day) or monthly (day 1 to 28), hour in agency timezone, recipients, sections.
- Dispatcher every 15 minutes: generate due reports, send branded email (from name = agency display name, reply-to = agency support email), attach PDF or link if over 5 MB, update nextRunAt.
Tests:
- Unit: nextRunAt across timezones and month ends.
- Integration: due schedule creates a report and an email in Mailpit, never sent twice.

**Step 17: Client portal**
Build:
- Invite client user from a client page (role CLIENT, linked to clientId).
- Portal at `/portal/[agencySlug]`: branded login, dashboard for their projects, rankings (read only), latest audit summary, reports list and download.
- No platform name in portal pages, titles, emails, or favicon. Use agency logo or initials.
Tests:
- E2E: client user sees only their client; another client's project returns 404; page text and `<title>` never contain `APP_NAME`.
- Integration: isolation cases for client scope.

**Step 18: Custom domains (behind flag)**
Build:
- `CUSTOM_DOMAINS_ENABLED=false` by default.
- Branding page: enter domain, show DNS steps (CNAME to platform host, TXT token), "Verify" button with DNS lookup.
- Host-based routing in Next.js middleware (or `proxy.ts` in newer Next.js versions): verified custom domain serves that agency's portal at `/`.
- `GET /api/internal/domain-allowed?domain=` returns 200 only for verified domains (for Caddy on-demand TLS later).
Tests:
- Unit: host resolver; DNS verify with a mocked resolver.
- E2E with flag on: `http://agency-one.lvh.me:3000` (lvh.me resolves to 127.0.0.1), set as a verified domain, shows Agency One's portal.

### Phase D: Billing, Admin, Security

**Step 19: Plans and mock billing**
Build:
- Billing interface: createCheckout, changePlan, cancel, resume, getPortalUrl, verifyAndParseWebhook.
- Mock: in-app checkout page with "Pay" and "Fail payment" buttons that send an HMAC-signed webhook to `/api/webhooks/billing`.
- Webhook handler: verify signature, store `BillingEvent` (unique event ID), apply state machine, idempotent.
- State machine: TRIALING to ACTIVE; payment failure to PAST_DUE with 7-day grace, then EXPIRED (read-only: data visible, no new jobs); cancel at period end; reactivate; upgrade immediately; downgrade at period end, blocked if usage exceeds the new plan.
- Billing page: plan, usage, change plan, cancel, mock invoices. Trial banner and reminder emails (3 days and 1 day before).
- Dev and test only endpoint to move a subscription's clock forward.
Tests:
- Unit: every state transition.
- Integration: same webhook twice is processed once; bad signature rejected; read-only mode blocks job creation.
- E2E: trial agency upgrades to GROWTH via mock checkout and new limits apply.

**Step 20: Super admin**
Build:
- `/admin` only for `isSuperAdmin` (others get 404). CLI `pnpm admin:create --email`.
- Overview: agencies by status, MRR, weekly signups, churn, provider cost vs budget, gross margin.
- Agencies list (search, filter) and detail (members, subscription, usage chart, cost vs revenue, activity log). Actions: suspend, unsuspend, change plan, extend trial, add bonus usage.
- Impersonation: 30-minute limit, red banner, every action logged with impersonator ID, billing blocked.
- Queue page: counts, failed jobs with errors, retry, remove, pause, resume.
- Data Provider page: active provider per module, environment (sandbox or live), callback mode, "Test connection" button, account balance, today's and this month's spend, copyable callback URLs.
- Plans editor. Platform settings (budget, maintenance mode, feature flags).
Tests:
- E2E: non-admin gets 404; suspended agency users see a suspended page; impersonation shows banner and logs actions; Test connection works with the mock.
- Integration: MRR and margin math with fixtures.

**Step 21: Security hardening**
Build:
- Headers: CSP, X-Frame-Options DENY (except widget route in Step 32), Referrer-Policy, Permissions-Policy, HSTS on HTTPS.
- Rate limits on all mutations and public routes (including provider callback routes). Login lockout after repeated failures.
- TOTP 2FA (Better Auth plugin), required for super admins.
- Sessions page: list and revoke.
- Agency data export (JSON zip) and deletion (owner types agency name, soft delete, purge after 30 days).
- Activity log covers logins, role changes, branding, billing, deletions, impersonation.
- `pnpm audit` and secret scanning in CI.
Tests:
- Integration: headers present; isolation suite covers every route handler and server action (keep a registry of all actions and assert each enforces tenancy).
- E2E: 2FA setup and login; data export downloads.

**Step 22: Marketing site and onboarding**
Build:
- Public pages: home, features, pricing (from Plan table), about, contact form, terms and privacy placeholders.
- New agency checklist: add client, add project, add keywords, run audit, set branding, create report.
- In-app help page with short guides.
Tests:
- E2E: public pages load; pricing matches DB; checklist updates as tasks are completed.

### Phase E: Deploy to AWS (no domain yet)

**Step 23: Production Docker**
Build:
- Multi-stage Dockerfiles for `web` (Next.js standalone) and `worker`. Non-root user, small images.
- `docker-compose.prod.yml`: caddy, web, worker, postgres, redis, mailpit (testing only, behind basic auth), backup. Healthchecks, `restart: unless-stopped`, log rotation (10 MB x 3), memory limits for a 2 GB server, Postgres tuned for low memory.
- One-off `migrate` service runs before web starts.
- `scripts/smoke-test.sh BASE_URL`: health, login page, sign up, create agency.
Tests:
- Prod compose runs locally; smoke test passes; data survives container restarts.

**Step 24: CI/CD**
Build:
- On push to main: all checks, build images, push to GitHub Container Registry tagged with git SHA and `latest`. Never build on the server.
- Manual "Deploy" workflow: SSH to server, pull by SHA, migrate, `docker compose up -d`, smoke test, roll back to previous SHA on failure.
- Secrets in GitHub Actions secrets. Server `.env` only on the server.
Tests:
- Pipeline green. A deliberately failing smoke test triggers rollback (test once, then remove).

**Step 25: AWS server setup [HUMAN + scripts]**
Human (AWS console):
- Create an AWS Budget with alerts (for example $5, $10, $20) before anything else.
- Region closest to target customers.
- EC2: Ubuntu 24.04 LTS, t3.small (2 GB RAM) recommended. t3.micro (1 GB) only with swap and it will be tight. 30 GB gp3 disk. Elastic IP.
- Security group: SSH (22) from your IP only; HTTP (80) and HTTPS (443) from anywhere.
- Public IPv4 has a small hourly charge, taken from credits.
Agent writes `scripts/server-setup.sh`:
- Deploy user, SSH key login only, root and password login disabled, ufw (22, 80, 443), fail2ban, unattended security upgrades, 2 GB swap, Docker and compose plugin, app folder.
HTTPS without a domain:
- Use `<elastic-ip-with-dashes>.sslip.io` as the `APP_URL` host and let Caddy get a certificate.
- If that fails, use plain HTTP on the IP for testing only (`COOKIE_SECURE=false`), demo data only, never real customer data.
Tests:
- Smoke test passes against the server. After a reboot, everything comes back on its own.

**Step 26: Backups, monitoring, operations**
Build:
- Nightly compressed `pg_dump` to an S3 bucket (lifecycle: delete after 14 days), keep last 3 locally.
- `scripts/restore.sh` and a restore test into a fresh database.
- Free external uptime monitor on `/api/health`.
- Optional Sentry (free tier) behind `SENTRY_DSN`.
- `docs/OPERATIONS.md`: deploy, rollback, restore, rotate secrets, logs, disk cleanup.
Tests:
- Restore the latest backup into a new database; row counts match.

### Phase F: More Modules (still mock data)
Every module adds: models with `agencyId`, mock provider methods, gateway usage and limits, UI, report section, alert rules, isolation cases, and unit, integration, and E2E tests.

**Step 27: Backlink monitor**
Summary (total backlinks, referring domains, domain rank), backlinks table (source, target, anchor, dofollow, first and last seen), new and lost since last snapshot, weekly snapshot job, "suspicious link" flag (spammy TLDs, very low rank, exact-match anchors), CSV export, alert on large loss, report section.

**Step 28: Competitor analysis**
Up to N competitors per project. Ranking comparison from stored top 10 results (no extra cost). Keyword gap: keywords competitors rank for that the project does not (ranked keywords, cached 7 days). "Add to rank tracker". Report section.

**Step 29: AI visibility tracker**
Prompts per project, engines (ChatGPT, Gemini, Perplexity, Claude; configurable), weekly checks. Store: mentioned or not, position in answer, cited URLs, competitors mentioned, short excerpt. Views: mention rate over time, share of voice vs competitors, cited pages. Alert when the brand stops being mentioned. Report section. Uses `aiChecksPerMonth`.

**Step 30: Local SEO and reviews**
Link a business (name, location) to a project. Average rating, total reviews, rating trend, latest reviews. Alerts for new reviews, especially 1 to 2 stars. Mock suggested replies via summary provider. Report section.

**Step 31: Google Search Console and GA4**
OAuth per project (tokens encrypted with `ENCRYPTION_KEY`), choose property, daily sync of clicks, impressions, CTR, average position (GSC) and sessions, conversions (GA4). Dashboard cards and report section. Build and test locally with Google test accounts and a `http://localhost` redirect; enable on the server after a real domain exists. Mock Google APIs with msw in tests.

**Step 32: Lead generation widget**
Embed code (script rendering an iframe form) for the agency's own website. Visitor enters website and email, gets an instant mini audit (top issues, few pages, rate limited by IP). Agency gets the lead by email and on a Leads page. Agency branding on the widget. Counts against `leadAuditsPerMonth`.

### Phase G: Go Live (later)

**Step 33: Real DataForSEO adapter [HUMAN: paid account]**
- Finish any adapter methods not done in Step 8c. Map responses to internal types only inside the adapter.
- Switch `DATAFORSEO_BASE_URL` to `https://api.dataforseo.com`. Start with small limits and a low `MONTHLY_PROVIDER_BUDGET_USD`.
- Set `DATAFORSEO_CALLBACK_MODE=pingback` once the server has a public HTTPS URL.
- Use the standard queue for scheduled rank checks; live only for "check now".
- Enable modules one by one with `SEO_PROVIDER_OVERRIDES` (rankings first), watching cost and data quality in the admin Data Provider page.
- Update `pricing.ts` with real prices. When all modules are verified, set `SEO_PROVIDER=dataforseo`.

**Step 34: Domain, HTTPS, email [HUMAN: buy domain]**
- DNS A record to the Elastic IP. Update `APP_URL`. Caddy gets certificates automatically.
- Amazon SES: verify domain, SPF, DKIM, DMARC, request production access. `EMAIL_PROVIDER=ses`.
- Custom domains: Caddy on-demand TLS using the `domain-allowed` endpoint, `CUSTOM_DOMAINS_ENABLED=true`.
- Enable Google OAuth on the server.

**Step 35: Real payments [HUMAN: account]**
Implement the billing provider for the chosen gateway (test mode, then live). Map its webhooks to the existing state machine. Add taxes and invoices required in your country.

**Step 36: Launch checklist**
All tests green; a backup restored at least once; budget alarms set; legal pages final; support email works; monitoring alerts reach you; `ALLOW_MOCK_IN_PROD=false`; demo accounts removed; 2FA on admin; a load test with 50 seeded agencies passes on the server.

## 12. Progress Log Template (`docs/PROGRESS.md`)
```md
## Step XX: <name>
Status: done | in progress | blocked
Date:
What was built:
Tests added:
Decisions (also copy to DECISIONS.md):
Known issues or follow-ups:
```