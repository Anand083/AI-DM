// Runs before each integration test file, so server code sees the test database.
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? "postgresql://app:app@localhost:5433/app_test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.BETTER_AUTH_SECRET ??= "integration-test-secret-integration-test";
process.env.EMAIL_PROVIDER = "console";
process.env.LOG_LEVEL = "silent";
