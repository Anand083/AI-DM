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
