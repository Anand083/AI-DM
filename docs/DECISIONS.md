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
