// Scripts and the worker are not started by Next.js, so nothing reads `.env` for them.
// Import this first. Variables that are already set in the environment win over the file.
try {
  process.loadEnvFile();
} catch {
  // No .env file (for example in production, where variables come from the host). That is fine.
}
