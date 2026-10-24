import { db } from "@/server/db/client";
import { logger } from "@/server/logger";
import { getRedis } from "@/server/redis";
import { checkHealth } from "@/server/services/health";

export async function GET(): Promise<Response> {
  const report = await checkHealth({
    database: () => db.$queryRaw`SELECT 1`,
    redis: async () => {
      const redis = getRedis();
      if (redis.status === "wait") await redis.connect();
      return redis.ping();
    },
  });
  if (!report.ok) logger.warn({ checks: report.checks }, "health check failed");
  // Do not leak error details to callers.
  const body = {
    ok: report.ok,
    checks: {
      database: { ok: report.checks.database.ok },
      redis: { ok: report.checks.redis.ok },
    },
  };
  return Response.json(body, { status: report.ok ? 200 : 503 });
}
