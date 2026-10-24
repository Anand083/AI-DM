# CLAUDE.md

## Project
White-label SEO platform for marketing agencies. Agencies log in, manage clients and projects, run SEO tools, and send branded reports. Client users get a read-only branded portal.

Full plan: `docs/PLAN.md`. Progress log: `docs/PROGRESS.md`. Decisions: `docs/DECISIONS.md`.

## How to work
1. At the start of every session, read this file, `docs/PROGRESS.md`, and the current step in `docs/PLAN.md`.
2. Work on ONE step at a time, in order. Never start the next step until the current one meets every test in its list and all checks pass.
3. Before coding a step, write a short plan (files to create or change, tests to add) and show it to the human.
4. Write tests together with the code, not after.
5. When the step is done: run all checks, update `docs/PROGRESS.md`, and commit with message `step-XX: <short summary>`.
6. Stop and ask the human when: a decision is not covered by the plan, a paid service or real credentials are needed, a check still fails after 3 honest attempts, or you want a dependency not in the approved list.
7. Do not edit `docs/PLAN.md` without asking. Record every technical decision in `docs/DECISIONS.md`.

## Checks (all must pass before a step is done)
```bash
pnpm lint
pnpm typecheck
pnpm test          # unit + integration (Vitest)
pnpm test:e2e      # Playwright
```

## Hard rules
- Never call real external APIs. Use providers in `src/server/providers/*`. `SEO_PROVIDER=mock` and `BILLING_PROVIDER=mock` by default.
- Multi-tenancy: every tenant-owned row has `agencyId`. All tenant data access goes through services in `src/server/services` that take a `TenantContext`. Never trust an ID from the browser without checking it belongs to the current agency.
- Every server action and route handler: check auth, check permission with `can()`, validate input with Zod.
- Never weaken, skip, or delete a test to make checks pass. No `.skip` or `.only` in commits.
- TypeScript strict. No `any`. Server-only code lives in `src/server` and imports `server-only`.
- Secrets only through `src/env.ts` (Zod validated). Never commit `.env`. Keep `.env.example` updated.
- Business logic lives in services, not in components or route files, so it can be unit tested.
- Slow or paid work (provider calls, PDFs, emails) runs in the worker, never inside a web request.
- Every list is paginated. No database query without a limit. Add indexes for every new query pattern.
- Every page works on mobile, tablet, and desktop.
- Store times in UTC. Show them in the agency timezone.
- Money in integer cents. Provider costs in integer micro-dollars.
- UI text in simple, clear English.
- The platform name comes from `APP_NAME`. It must never appear in the client portal, reports, or any email sent to client users.

## Approved dependencies
next, react, typescript, tailwindcss, shadcn/ui (radix-ui), lucide-react, zod, react-hook-form, @tanstack/react-table, recharts, prisma, @prisma/client, better-auth, bullmq, ioredis, nodemailer, @react-email/components, @react-pdf/renderer, @aws-sdk/client-s3, sharp, archiver, pino, date-fns, date-fns-tz, @paralleldrive/cuid2, vitest, @testing-library/react, @playwright/test, @axe-core/playwright, tsx, msw.
Ask before adding anything else.