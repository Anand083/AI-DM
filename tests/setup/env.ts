// Runs before each integration test file, so server code sees the test database.
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? "postgresql://app:app@localhost:5433/app_test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.BETTER_AUTH_SECRET ??= "integration-test-secret-integration-test";
process.env.EMAIL_PROVIDER = "console";
process.env.LOG_LEVEL = "silent";
process.env.DATAFORSEO_CALLBACK_SECRET = "test-callback-secret";
// Each test file gets its own queue prefix, so jobs added by tests never reach a real worker.
process.env.QUEUE_PREFIX = `test-${process.pid}`;
process.env.MOCK_LATENCY_MS = "0";
// Files (logos) go to a folder that is deleted by the OS, never into the project.
process.env.STORAGE_LOCAL_DIR = `${process.env.TMPDIR ?? "/tmp"}/ai-dm-test-storage-${process.pid}`;
