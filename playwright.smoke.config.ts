import { defineConfig, devices } from "@playwright/test";

/**
 * A short check that a running copy of the app works: used after a deploy.
 *   SMOKE_BASE_URL=https://app.example.com MAILPIT_URL=... pnpm exec playwright test -c playwright.smoke.config.ts
 * It does not start any servers.
 */
const baseURL = process.env.SMOKE_BASE_URL;
if (!baseURL) throw new Error("Set SMOKE_BASE_URL to the address to check.");

export default defineConfig({
  testDir: "./tests/smoke",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 1,
  reporter: "list",
  use: {
    baseURL,
    ...devices["Desktop Chrome"],
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
  },
});
