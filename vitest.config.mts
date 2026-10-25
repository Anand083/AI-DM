import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vitest/config";

const shared = {
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/server-only.ts"),
    },
  },
};

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        ...shared,
        test: {
          name: "unit",
          environment: "node",
          include: [
            "src/**/*.test.{ts,tsx}",
            "tests/helpers/**/*.test.ts",
            "tests/security/**/*.test.ts",
          ],
          setupFiles: ["tests/setup/env.ts"],
        },
      },
      {
        ...shared,
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/setup/global.ts"],
          setupFiles: ["tests/setup/env.ts"],
          // Integration tests share one database, so run test files one after another.
          fileParallelism: false,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
