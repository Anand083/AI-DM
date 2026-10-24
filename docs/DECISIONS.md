# Decisions

## Step 0

- Versions (latest stable at Step 0): Node 22, pnpm 10.28, Next.js 16.4, React 19.3, TypeScript 5.9, Tailwind 4, Vitest 5, Playwright 1.64.
- `plan.md` moved to `docs/PLAN.md` (no content change) so it matches `CLAUDE.md`.
- Extra dev packages needed by approved tools (not separate features): `class-variance-authority`, `clsx`, `tailwind-merge` (shadcn/ui helpers), `@vitejs/plugin-react` and `jsdom` (Vitest with React), `@types/node`. `prettier` is added because the plan lists Prettier.
- `PW_CHROMIUM_PATH` env var lets Playwright use an already installed Chromium (cloud sandbox). CI installs its own.
- `LayoutProps` helper is not used; the root layout types `children` directly so `tsc` works without generated types.
- `db:migrate`, `db:seed`, `worker:dev` are placeholders until Steps 1, 2 and 8.
