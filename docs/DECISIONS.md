# Decisions

## Step 0

- Versions (latest stable at Step 0): Node 22, pnpm 10.28, Next.js 16.4, React 19.3, TypeScript 5.9, Tailwind 4, Vitest 5, Playwright 1.64.
- `plan.md` moved to `docs/PLAN.md` (no content change) so it matches `CLAUDE.md`.
- Extra dev packages needed by approved tools (not separate features): `class-variance-authority`, `clsx`, `tailwind-merge` (shadcn/ui helpers), `@vitejs/plugin-react` and `jsdom` (Vitest with React), `@types/node`. `prettier` is added because the plan lists Prettier.
- `PW_CHROMIUM_PATH` env var lets Playwright use an already installed Chromium (cloud sandbox). CI installs its own.
- `LayoutProps` helper is not used; the root layout types `children` directly so `tsc` works without generated types.
- `db:migrate`, `db:seed`, `worker:dev` are placeholders until Steps 1, 2 and 8.

## Step 1

- Prisma 6.19 (not 7). Prisma 7 needs a driver adapter package (`@prisma/adapter-pg` and `pg`) that is not on the approved list. Move to 7 once those are approved.
- `server-only` is added because the hard rules require it; Vitest aliases it to an empty stub.
- No Docker in the cloud sandbox, so the sandbox used its own Postgres 16 and Redis. `docker-compose.yml` is untested here but uses plain images. Mailpit is only in compose.
- `src/env.ts` exposes `parseEnv()` (pure, unit tested) and `getEnv()` (cached). Production-only rules: no mock SEO provider without `ALLOW_MOCK_IN_PROD`, no placeholder secrets. These are skipped during `next build` because secrets are only present at runtime.
- `/api/health` returns only ok/not ok per dependency (no error details). The provider status part of the health check comes with the provider layer in Step 8c.
- With `cacheComponents` on in Next 16, `export const dynamic` is not allowed in route files. Route handlers that touch the DB are dynamic already.

## Step 2

- IDs use Prisma `cuid(2)` (cuid2), so no extra code is needed for ID generation. `@paralleldrive/cuid2` is installed for places that need an ID in code.
- Tenant models (have `agencyId`): AgencyMember, Invitation, Client, ClientUser, Project, Subscription, ActivityLog. `Agency` itself is the tenant root and is not guarded. Later steps must add new tenant models to `TENANT_MODELS` (a unit test lists them, so forgetting fails the test).
- The guard accepts `agencyId` at the top of `where` or inside `AND`, never inside `OR`. It is off in production by design (plan 7.1).
- `adminDb` lives in `src/server/db/admin-client.ts`; ESLint blocks importing it outside `src/server/admin`.
- Seed: plans always; demo users, agencies, clients, projects only outside production. Demo password for all demo users: `Demo-pass-123` (printed only in dev). Demo users use fixed ids starting with `seed_` so the seed can be re-run.
- Plan prices are placeholders (Starter $49, Growth $149, Agency $399 per month, yearly = 10 months). Editable later in admin.
- Better Auth tables (Session, Account, Verification) are in the schema now; Step 3 may add the 2FA table.
- Integration tests run `prisma migrate deploy` on the test DB once (vitest global setup) and run files one at a time.

## Step 3

- Better Auth 1.7 with the Prisma adapter, DB sessions, `requireEmailVerification: true` (unverified users cannot sign in), min password length 10, reset link valid 1 hour, sessions revoked after a password reset. Ids come from cuid2.
- Rate limiting is our own Redis fixed-window limiter (`src/server/rate-limit.ts`) run from a Better Auth `before` hook, per IP and per email. Defaults 5 per 15 minutes (`AUTH_RATE_LIMIT_MAX`, `AUTH_RATE_LIMIT_WINDOW_SECONDS`; the E2E server raises the max). If Redis is down the check is skipped and logged, so people are not locked out. IP comes from `x-forwarded-for`, so Caddy must set it (Step 33).
- The forgot-password page always says "if an account exists", so it does not reveal which emails are registered.
- Emails are sent inside the request for now. The plan says emails go through the worker; this moves to a BullMQ job in Step 8.
- `@types/nodemailer` added as a dev dependency (types only). `react-hook-form` is used with a small own Zod resolver (`src/lib/form.ts`) instead of the extra resolvers package.
- `src/proxy.ts` (Next 16 name for middleware) only checks that a session cookie exists for `/app/*`. The real check is `requireUser()` in pages and actions.
- Turned off `cacheComponents` and `partialPrefetching` (enabled by the Next 16 starter). The plan does not use them and they force Suspense around all dynamic data.
- 2FA plugin is in the plan's stack, but no step lists a 2FA screen, so it is not built yet. Ask the founder when it is wanted.
- `scripts/mail-sink.ts` is a small Mailpit-compatible mail catcher for machines without Docker. Mailpit stays the tool in docker-compose and CI. The cloud sandbox blocked downloading the Mailpit binary, so this was used for local E2E runs.

## Step 4

- Roles: Owner, Admin, Member, Client (plan section 8). `scopeOf()` returns all/own/none; "own" for clients must be enforced by the caller with `ctx.clientIds` (Step 17). `canManageMember()` holds the "admins cannot touch owners" rule.
- Team invites can only give ADMIN or MEMBER. Owners are never invited. Nobody can change their own role or remove themselves. An owner can remove another owner, and the last owner cannot be removed.
- Invitation links hold a 32 byte random token. Only its SHA-256 hash is stored. Resend replaces the token, so the old link stops working. Accepting needs a verified user whose email matches the invited email, works once (race safe) and expires after 7 days.
- Two reads use the plain client on purpose, because they cannot name one agency up front: `listUserAgencies(userId)` and the invitation lookup by secret token. Everything after the lookup uses the guarded client with `agencyId`.
- The tenant guard now accepts compound unique keys that contain `agencyId` (for example `agencyId_userId`).
- After email confirmation, users return to the page they came from (`next`), which is how invited people land back on their invitation.
- `withTenantAction(config, handler)` order: signed in and verified, tenant context (else "Not found."), `can()`, Zod input, handler. Known errors become messages, unknown errors are logged and hidden.
- Trial: STARTER, 14 days, mock provider. Plan limit checks (team size etc.) arrive in Step 9.
- Vitest is split into `unit` and `integration` projects, so unit tests do not need a database. `vitest.config.mts` avoids a Vite warning.
- The basic agency frame (header, switcher, sign out) is temporary; Step 5 builds the real shell.

## Step 5

- `radix-ui` (approved, used by shadcn) powers Dialog and DropdownMenu. Toasts are our own small component (shadcn uses `sonner`, which is not approved).
- `@tanstack/react-table` is pinned to v8 (v9 has a different API). `DataTable` is client-side (sort, search, page over rows it is given). A server-paged version will be added with the first long list (rankings, Step 10).
- Menu items are filtered by permission (`nav-items.ts`). Branding and Usage need `branding.edit` (owner, admin); Billing needs `billing.manage` (owner). Each page repeats the check with `requirePermission()` (404 if not allowed), because a layout alone is not a security boundary.
- Clients, Projects, Reports, Branding, Billing, Usage pages are "Coming soon" placeholders until their steps.
- The "Demo data" badge shows when `SEO_PROVIDER=mock`.
- Settings (name, time zone) can be edited by owner and admin (`branding.edit`); members see it read-only. The agency address (slug) is fixed.
- Pages and the layout share one cached `getPageContext(slug)` per request.

## Step 6

- Lists are server-paged with plain links and a GET search form (works without JavaScript, shareable URLs). Page size 20, service cap 100.
- Plan count limits: clients count only ACTIVE, not-deleted clients (archiving frees a slot; restoring is checked again). Projects count not-deleted projects of ACTIVE clients. Error text: "Your <Plan> plan allows up to N clients. Upgrade your plan to add more." (`LimitExceededError`, code LIMIT). An archived client with projects can be restored even if it takes the agency over the project limit; Step 9 may tighten this.
- `listClients` with no `status` returns all statuses; the Clients page passes ACTIVE by default.
- Same domain twice for one client is blocked; the same domain for two different clients is allowed (agencies may track a site for two clients or migrations).
- Domains are normalized to a bare host (no protocol, `www.`, path or port) and converted to punycode. IP addresses and single-label hosts like `localhost` are rejected. Client website is stored as `https://<domain>`.
- Locations/languages are fixed lists in `src/data` (41 countries, 21 languages). Codes are the Google Ads geo IDs DataForSEO uses; verify in Step 8c.
- `rankCheckHourUtc` defaults to 3 and is not shown in the UI. The scheduler (Step 8) will spread projects across the hour.
- Client users cannot call the agency client/project services (they get the portal in Step 17).

## Step 7

- Provider methods return `{ data, costMicros? }` instead of bare data (the plan shows bare data). This lets a real provider report the actual cost, which the gateway then saves. The mock leaves `costMicros` empty so the gateway uses the estimate.
- Dates inside provider results are ISO strings, so results can be cached as JSON.
- Mock rankings: each (domain, keyword, country, language, device) has a fixed base position (15/25/25/20/15% split). A day's position = base + the sum of the last 14 daily steps (mostly 0, sometimes 1 or 2) + any drop events of the last 7 days (2% of keywords per day drop 10 to 25 positions and recover a week later). Non-ranking keywords appear at 70 to 100 on about 5% of days. Everything is seeded, so results are repeatable and the web app and worker agree.
- Mock audit keeps no state: the task id holds the start time, page limit and domain, so any process can answer status and result calls. Pages are 20 to 300, capped by `maxPages`. Issue codes live in `src/server/audit/issue-codes.ts`; Step 11 adds the titles and fix text.
- Cache (`ProviderCache`) is shared across agencies because SEO data is public. Hash = sha256(provider, operation, normalized input, and the UTC date for rankings, AI and reviews). TTLs: rankings, AI and reviews until the end of the UTC day; keyword ideas 30 days; backlinks and ranked keywords 7 days; audit results 30 days. Expired rows are removed by the maintenance job (Step 8).
- Duplicate suppression: a Redis lock per request hash. A second identical request waits (up to 30 s) and returns the first one's answer. Only the request that really calls the provider writes a `UsageRecord`; cached answers write none and are not counted against limits.
- `GatewayGuard.beforeCall` is the hook for plan limits and the budget (Step 9). Audit results are not guarded there because the page count is only known after the call; Step 9 will check audit limits when an audit starts.
- `UsageRecord` is a tenant model (guarded). The gateway uses the plain client for the shared cache table. A new unit test checks that every Prisma model with an `agencyId` column is in `TENANT_MODELS`.
- `SEO_PROVIDER_OVERRIDES` (one provider per module) is parsed in Step 8b. Until then every module uses `SEO_PROVIDER`.
- Cost table in `pricing.ts` has placeholder numbers; verify against DataForSEO pricing before go-live.
- ESLint: unused variables that start with `_` are allowed.

## Step 8

- BullMQ 6 with plain connection options parsed from `REDIS_URL` (`maxRetriesPerRequest: null`, required by workers). Jobs: 3 attempts, exponential backoff starting at 5 s, completed jobs kept 24 h (max 5000), failed jobs kept 7 days. `QUEUE_PREFIX` (default `bull`) separates copies on one Redis; tests use their own prefix.
- Worker (`src/worker/index.ts`) runs with `tsx --conditions=react-server`, which makes the `server-only` package a no-op outside Next.js. It loads `.env` itself (`src/server/load-env.ts`). SIGTERM/SIGINT: stop taking jobs, wait for running jobs, close queues.
- All emails now go through the `emails` queue (`enqueueEmail`), so no web request waits for SMTP. The E2E setup therefore starts the worker too (second Playwright web server).
- Scheduler: a repeating job on the `maintenance` queue every 15 minutes. A project is due once today's `rankCheckHourUtc` plus its own minute offset (hash of project id, 0 to 59) has passed; weekly projects are due on one weekday (hash of project id). The job id `rank_<projectId>_<yyyy-mm-dd>` means one job per project per day, and a missed tick is caught up on the next one. The scheduler reads all agencies' projects in batches of 500 with the plain DB client (system work).
- Daily clean-up at 02:00 UTC removes expired cache rows, sessions and verification tokens, and clients, projects and agencies deleted more than 30 days ago (database cascades remove their data).
- Processors for rank-checks, audits, reports, alerts and provider-tasks are placeholders that log and finish; they are replaced in Steps 10, 11, 15, 13 and 8b.
- The budget pause (Step 9) and the "jobs paused" banner will plug into the scheduler and processors.

## Step 8b

- BullMQ rejects custom job ids that contain ":" (unless there are exactly 3 parts) and ids that are only digits. Job ids now use "_" (`rank_<project>_<date>`, `email_<key>`, `ptask_<taskId>`), with other characters replaced.
- `DataForSeoClient`: Basic auth, 30 s timeout, up to 3 retries (waits 1 s, 2 s, 4 s) on HTTP 429, 5xx, network errors, timeouts, and on body codes 40202 (rate limit) and 5xxxx. Not retried: HTTP 401/403 and body codes 40101 (login), 40200/40201/40210 (no funds), 404xx (not found), other 4xxxx (bad request). Code 20000 and 20100 ("task created") are OK. Cost = `cost` in USD x 1,000,000, rounded. Logs path, method, duration, cost, task ids; never credentials.
- `testConnection()` is the only working adapter method (`GET /v3/appendix/user_data`). It returns `{ ok: false, message }` instead of throwing. `listReadyTaskIds()` exists for rankings and reviews. Audit tasks have no `tasks_ready` endpoint and will be checked with the on-page summary call in Step 8c.
- `PendingProviderTask` has `agencyId`, so it is a tenant model; the inbound routes and the poll job are system code and use the plain client by provider task id.
- Callback routes: rate limited to 300 requests/minute per IP, secret compared in constant time (`DATAFORSEO_CALLBACK_SECRET`, 401 if wrong or empty), 10 MB body limit, gzip detected by magic bytes. Pingback only marks a task READY; the result is fetched from the API later. Postback stores the result, but only for tasks that are PENDING, so a second delivery or a forged result for a finished task changes nothing.
- Poll job (queue `provider-tasks`, job `poll`): every 5 minutes in `poll` mode; every 30 minutes in callback modes (safety net: only tasks pending over 30 minutes). It also re-queues READY tasks whose processing job was lost, and gives up (FAILED) on tasks pending over 24 hours.
- Processing job (`process-task`): gets the stored or fetched result, runs the handler for the operation, marks PROCESSED. Three attempts, then FAILED. No handlers exist yet; they arrive with Steps 8c, 10 and 11.
- `/api/health` also reports provider status (cached 5 minutes, `testConnection()` only). A provider outage does not make the app unhealthy.
- `SEO_PROVIDER_OVERRIDES` is validated at start-up and used by `getSeoProvider(module)`. In production the mock needs `ALLOW_MOCK_IN_PROD` and DataForSEO needs credentials if ANY module uses them.
