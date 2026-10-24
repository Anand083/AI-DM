import { execSync } from "node:child_process";

/** Applies all migrations to the test database once before integration tests. */
export default function setup(): void {
  const url = process.env.DATABASE_URL_TEST ?? "postgresql://app:app@localhost:5433/app_test";
  execSync("pnpm exec prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}
