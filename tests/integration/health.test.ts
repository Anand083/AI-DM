import { PrismaClient } from "@prisma/client";
import IORedis from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import { checkHealth } from "@/server/services/health";

const databaseUrl = process.env.DATABASE_URL_TEST ?? "postgresql://app:app@localhost:5433/app_test";
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const redis = new IORedis(redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 2000 });
// Port 1 is never open, so this behaves like a Redis server that is down.
const deadRedis = new IORedis("redis://127.0.0.1:1", {
  maxRetriesPerRequest: 0,
  connectTimeout: 500,
  retryStrategy: () => null,
  lazyConnect: true,
});
deadRedis.on("error", () => {});

afterAll(async () => {
  await prisma.$disconnect();
  redis.disconnect();
  deadRedis.disconnect();
});

describe("health check with real services", () => {
  it("returns ok when Postgres and Redis are up", async () => {
    const report = await checkHealth({
      database: () => prisma.$queryRaw`SELECT 1`,
      redis: () => redis.ping(),
    });
    expect(report.checks.database.ok).toBe(true);
    expect(report.checks.redis.ok).toBe(true);
    expect(report.ok).toBe(true);
  });

  it("reports failure when Redis is unreachable", async () => {
    const report = await checkHealth({
      database: () => prisma.$queryRaw`SELECT 1`,
      redis: async () => {
        await deadRedis.connect();
        return deadRedis.ping();
      },
    });
    expect(report.ok).toBe(false);
    expect(report.checks.database.ok).toBe(true);
    expect(report.checks.redis.ok).toBe(false);
  });
});

describe("GET /api/health", () => {
  it("returns ok and the provider status, without error details", async () => {
    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      checks: { database: { ok: true }, redis: { ok: true } },
      providers: { mock: { ok: true } },
    });
  });
});
