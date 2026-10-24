import { defineConfig, devices } from "@playwright/test";

const port = 3000;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  // The dev server compiles pages on first visit, so allow extra time.
  expect: { timeout: 15_000 },
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${port}`, trace: "on-first-retry" },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Optional: use an already installed Chromium (for example in a cloud sandbox).
        launchOptions: process.env.PW_CHROMIUM_PATH
          ? { executablePath: process.env.PW_CHROMIUM_PATH }
          : {},
      },
    },
  ],
  webServer: {
    command: process.env.CI ? "pnpm build && pnpm start" : "pnpm dev",
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    // Many sign-ups come from one IP in tests, so raise the auth rate limit.
    env: { AUTH_RATE_LIMIT_MAX: "1000" },
    timeout: 180_000,
  },
});
