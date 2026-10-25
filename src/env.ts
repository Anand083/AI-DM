import { z } from "zod";
import { parseOverrides, providersInUse } from "@/server/providers/seo/overrides";

const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

const optionalString = z
  .string()
  .default("")
  .transform((v) => v.trim());

const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_NAME: z.string().min(1).default("SEO Platform"),
  APP_URL: z.url().default("http://localhost:3000"),
  /** The host agencies point their CNAME at. Defaults to the host in APP_URL. */
  CUSTOM_DOMAIN_CNAME_TARGET: optionalString,
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  DATABASE_URL: z.string().min(1).default("postgresql://app:app@localhost:5432/app"),
  DATABASE_URL_TEST: z.string().min(1).default("postgresql://app:app@localhost:5433/app_test"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),

  BETTER_AUTH_SECRET: z.string().min(32, "must be at least 32 characters"),
  BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
  COOKIE_SECURE: bool,
  /** How many changes (server actions) one signed-in person may make per minute. */
  MUTATION_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(120),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(5),
  AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).default(900),

  SEO_PROVIDER: z.enum(["mock", "dataforseo"]).default("mock"),
  SEO_PROVIDER_OVERRIDES: optionalString.superRefine((value, ctx) => {
    for (const problem of parseOverrides(value).problems)
      ctx.addIssue({ code: "custom", message: problem });
  }),
  ALLOW_MOCK_IN_PROD: bool,
  MOCK_LATENCY_MS: z.coerce.number().int().min(0).default(200),
  MOCK_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0),
  AUDIT_POLL_SECONDS: z.coerce.number().int().min(1).default(10),
  MOCK_AUDIT_SECONDS: z.coerce.number().int().min(0).default(20),
  MONTHLY_PROVIDER_BUDGET_USD: z.coerce.number().min(0).default(50),

  DATAFORSEO_LOGIN: optionalString,
  DATAFORSEO_PASSWORD: optionalString,
  DATAFORSEO_BASE_URL: z.url().default("https://sandbox.dataforseo.com"),
  DATAFORSEO_CALLBACK_MODE: z.enum(["poll", "pingback", "postback"]).default("poll"),
  DATAFORSEO_CALLBACK_SECRET: z.string().default("change-me"),

  BILLING_PROVIDER: z.enum(["mock", "stripe", "razorpay"]).default("mock"),
  MOCK_BILLING_WEBHOOK_SECRET: z.string().default("change-me"),

  EMAIL_PROVIDER: z.enum(["console", "smtp", "ses"]).default("smtp"),
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
  EMAIL_FROM: z.string().min(1).default("SEO Platform <no-reply@localhost>"),

  STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./storage"),
  /** Folder with the nightly database dumps. When set (and S3 is set up) the worker uploads them. */
  BACKUP_DIR: optionalString,
  S3_BUCKET: optionalString,
  AWS_REGION: optionalString,

  SUMMARY_PROVIDER: z.enum(["mock", "openrouter"]).default("mock"),
  ASSISTANT_PROVIDER: z.enum(["mock", "openrouter"]).default("mock"),
  OPENROUTER_API_KEY: optionalString,
  OPENROUTER_MODEL: z.string().min(1).default("anthropic/claude-haiku-5.5"),
  OPENROUTER_BASE_URL: z.url().default("https://openrouter.ai/api/v1"),
  CUSTOM_DOMAINS_ENABLED: bool,
  QUEUE_PREFIX: z.string().min(1).default("bull"),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(2),
  GOOGLE_PROVIDER: z.enum(["mock", "google"]).default("mock"),
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  SENTRY_DSN: optionalString,
  ENCRYPTION_KEY: z.string().default("change-me-32-bytes"),
});

export type Env = z.infer<typeof baseSchema>;

const strongSecret = (value: string) => value.length >= 16 && !value.startsWith("change-me");

/** Extra rules that only apply in production. Returns one message per problem. */
function productionProblems(env: Env): [string, string][] {
  const problems: [string, string][] = [];
  const used = providersInUse(
    env.SEO_PROVIDER,
    parseOverrides(env.SEO_PROVIDER_OVERRIDES).overrides,
  );
  if (used.has("mock") && !env.ALLOW_MOCK_IN_PROD) {
    problems.push([
      "SEO_PROVIDER",
      "the mock provider is not allowed in production unless ALLOW_MOCK_IN_PROD=true",
    ]);
  }
  if (
    (env.SUMMARY_PROVIDER === "openrouter" || env.ASSISTANT_PROVIDER === "openrouter") &&
    !env.OPENROUTER_API_KEY
  ) {
    problems.push([
      "OPENROUTER_API_KEY",
      "OPENROUTER_API_KEY is required when SUMMARY_PROVIDER or ASSISTANT_PROVIDER is openrouter",
    ]);
  }
  if (used.has("dataforseo") && (!env.DATAFORSEO_LOGIN || !env.DATAFORSEO_PASSWORD)) {
    problems.push(["DATAFORSEO_LOGIN", "DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD are required"]);
  }
  if (env.BETTER_AUTH_SECRET.startsWith("change-me")) {
    problems.push(["BETTER_AUTH_SECRET", "must not be the placeholder value"]);
  }
  if (env.ENCRYPTION_KEY.startsWith("change-me")) {
    problems.push(["ENCRYPTION_KEY", "must not be the placeholder value"]);
  }
  // Anyone who knows these can pretend to be the payment or data provider, so they must be set.
  if (env.BILLING_PROVIDER === "mock" && !strongSecret(env.MOCK_BILLING_WEBHOOK_SECRET)) {
    problems.push([
      "MOCK_BILLING_WEBHOOK_SECRET",
      "must be a real secret of at least 16 characters",
    ]);
  }
  if (used.has("dataforseo") && !strongSecret(env.DATAFORSEO_CALLBACK_SECRET)) {
    problems.push([
      "DATAFORSEO_CALLBACK_SECRET",
      "must be a real secret of at least 16 characters",
    ]);
  }
  if (env.ENCRYPTION_KEY.length < 32) {
    problems.push([
      "ENCRYPTION_KEY",
      "must be at least 32 characters (used to encrypt Google tokens)",
    ]);
  }
  if (env.GOOGLE_PROVIDER === "mock" && !env.ALLOW_MOCK_IN_PROD) {
    problems.push([
      "GOOGLE_PROVIDER",
      "the mock Google provider is not allowed in production unless ALLOW_MOCK_IN_PROD=true",
    ]);
  }
  if (env.GOOGLE_PROVIDER === "google" && (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET)) {
    problems.push([
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required when GOOGLE_PROVIDER=google",
    ]);
  }
  if (env.STORAGE_PROVIDER === "s3" && (!env.S3_BUCKET || !env.AWS_REGION)) {
    problems.push(["S3_BUCKET", "S3_BUCKET and AWS_REGION are required when STORAGE_PROVIDER=s3"]);
  }
  return problems;
}

/**
 * Validates a set of variables. Throws one error that lists every problem.
 * `skipProductionChecks` is for `next build`, where runtime secrets are not available yet.
 */
export function parseEnv(
  source: Record<string, string | undefined>,
  options: { skipProductionChecks?: boolean } = {},
): Env {
  const input = options.skipProductionChecks
    ? { BETTER_AUTH_SECRET: "build-time-placeholder-secret-not-used", ...source }
    : source;
  const result = baseSchema.safeParse(input);
  const lines: string[] = [];
  if (!result.success) {
    for (const i of result.error.issues)
      lines.push(`  - ${i.path.join(".") || "env"}: ${i.message}`);
  } else if (result.data.NODE_ENV === "production" && !options.skipProductionChecks) {
    for (const [name, message] of productionProblems(result.data)) {
      lines.push(`  - ${name}: ${message}`);
    }
  }
  if (lines.length > 0 || !result.success) {
    throw new Error(`Invalid environment variables:\n${lines.join("\n")}\nSee .env.example.`);
  }
  return result.data;
}

let cached: Env | undefined;

/** Validated environment, read once on first use. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env, {
    skipProductionChecks: process.env.NEXT_PHASE === "phase-production-build",
  });
  return cached;
}
