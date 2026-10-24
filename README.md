# AI-DM

White-label SEO platform for marketing agencies. Agencies manage clients and projects, run SEO tools, and send branded reports. Client users get a read-only branded portal.

- Build plan: `docs/PLAN.md`
- Progress: `docs/PROGRESS.md`
- Decisions: `docs/DECISIONS.md`
- Working rules: `CLAUDE.md`

## Run locally

Requirements: Node 22 and pnpm 10.

```bash
pnpm install
cp .env.example .env
pnpm dev            # http://localhost:3000
```

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm test           # unit + integration
pnpm test:e2e       # Playwright (run `pnpm exec playwright install chromium` once)
```
