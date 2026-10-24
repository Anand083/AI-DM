import IORedis from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestClient, resetDb, testDatabaseUrl } from "../helpers/db";

type Sent = { to: string; subject: string; html: string; text: string };
const sent: Sent[] = [];

// Emails go through the queue in the real app. Here we catch them instead.
vi.mock("@/server/jobs/enqueue", () => ({
  enqueueEmail: async (m: Sent) => void sent.push(m),
}));

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const prisma = createTestClient();
const redis = new IORedis(redisUrl);

type AuthModule = typeof import("@/server/auth/better-auth");
let auth: ReturnType<AuthModule["getAuth"]>;

const PASSWORD = "correct-horse-battery";
let counter = 0;
const nextEmail = () => `user${Date.now()}${counter++}@example.test`;
const ipHeaders = (ip: string) => new Headers({ "x-forwarded-for": ip });

function lastLink(to: string, pattern: RegExp): string {
  const mail = [...sent].reverse().find((m) => m.to === to);
  if (!mail) throw new Error(`no email to ${to}`);
  const link = (mail.text.match(/https?:\/\/\S+/g) ?? []).find((l) => pattern.test(l));
  if (!link) throw new Error(`no link ${pattern} in ${mail.text}`);
  return link;
}

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", testDatabaseUrl);
  vi.stubEnv("REDIS_URL", redisUrl);
  vi.stubEnv("BETTER_AUTH_SECRET", "integration-test-secret-integration-test");
  vi.stubEnv("AUTH_RATE_LIMIT_MAX", "3");
  const mod = await import("@/server/auth/better-auth");
  auth = mod.getAuth();
});

beforeEach(async () => {
  sent.length = 0;
  const keys = await redis.keys("rl:auth:*");
  if (keys.length) await redis.del(...keys);
});

afterAll(async () => {
  await resetDb(prisma);
  await prisma.$disconnect();
  redis.disconnect();
});

async function signUp(email: string, ip = "10.0.0.1") {
  return auth.api.signUpEmail({
    body: { name: "Test User", email, password: PASSWORD },
    headers: ipHeaders(ip),
  });
}

describe("email verification", () => {
  it("sends a verification email and blocks sign-in until the email is verified", async () => {
    const email = nextEmail();
    await signUp(email);
    expect(sent.some((m) => m.to === email && /confirm/i.test(m.subject))).toBe(true);

    await expect(
      auth.api.signInEmail({ body: { email, password: PASSWORD }, headers: ipHeaders("10.0.0.2") }),
    ).rejects.toMatchObject({ statusCode: 403 });

    const link = lastLink(email, /verify-email/);
    const token = new URL(link).searchParams.get("token")!;
    await auth.api.verifyEmail({ query: { token } });

    const result = await auth.api.signInEmail({
      body: { email, password: PASSWORD },
      headers: ipHeaders("10.0.0.3"),
    });
    expect(result.user.email).toBe(email);
    expect(result.user.emailVerified).toBe(true);
    const row = await prisma.session.findFirst({ where: { userId: result.user.id } });
    expect(row).not.toBeNull(); // the session is stored in the database
  });

  it("rejects short passwords", async () => {
    await expect(
      auth.api.signUpEmail({
        body: { name: "A", email: nextEmail(), password: "short" },
        headers: ipHeaders("10.0.0.4"),
      }),
    ).rejects.toBeTruthy();
  });
});

describe("password reset", () => {
  it("lets a user choose a new password with the emailed link, once", async () => {
    const email = nextEmail();
    await signUp(email, "10.1.0.1");
    await prisma.user.update({ where: { email }, data: { emailVerified: true } });

    await auth.api.requestPasswordReset({
      body: { email, redirectTo: "/reset-password" },
      headers: ipHeaders("10.1.0.2"),
    });
    const link = lastLink(email, /reset-password/);
    const token = new URL(link).pathname.split("/").pop()!;

    await auth.api.resetPassword({ body: { newPassword: "a-brand-new-password", token } });
    await expect(
      auth.api.resetPassword({ body: { newPassword: "another-password-1", token } }),
    ).rejects.toBeTruthy();

    await expect(
      auth.api.signInEmail({ body: { email, password: PASSWORD }, headers: ipHeaders("10.1.0.3") }),
    ).rejects.toBeTruthy();
    const ok = await auth.api.signInEmail({
      body: { email, password: "a-brand-new-password" },
      headers: ipHeaders("10.1.0.4"),
    });
    expect(ok.user.email).toBe(email);
  });
});

describe("rate limiting", () => {
  it("blocks repeated sign-in attempts from one IP with 429", async () => {
    const ip = "10.2.0.1";
    const attempt = (i: number) =>
      auth.api.signInEmail({
        body: { email: `nobody${i}@example.test`, password: "whatever-pass" },
        headers: ipHeaders(ip),
      });
    for (let i = 0; i < 3; i++) await expect(attempt(i)).rejects.toMatchObject({ statusCode: 401 });
    await expect(attempt(9)).rejects.toMatchObject({ statusCode: 429 });
  });
});
