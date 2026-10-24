import { db } from "@/server/db/client";
import { logger } from "@/server/logger";
import { getRedis } from "@/server/redis";
import { getEnv } from "@/env";
import { getProviderByName } from "@/server/providers/seo";
import { parseOverrides, providersInUse } from "@/server/providers/seo/overrides";
import { checkHealth } from "@/server/services/health";
import { createProviderHealth } from "@/server/services/provider-health";

const providerHealth = createProviderHealth({
  probes: {
    mock: () => getProviderByName("mock").testConnection(),
    dataforseo: () => getProviderByName("dataforseo").testConnection(),
  },
});

export async function GET(): Promise<Response> {
  const env = getEnv();
  const used = [
    ...providersInUse(env.SEO_PROVIDER, parseOverrides(env.SEO_PROVIDER_OVERRIDES).overrides),
  ];
  const report = await checkHealth({
    providers: () => providerHealth(used),
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
    providers: Object.fromEntries(
      Object.entries(report.providers ?? {}).map(([name, p]) => [name, { ok: p.ok }]),
    ),
  };
  return Response.json(body, { status: report.ok ? 200 : 503 });
}
