import "server-only";
import IORedis from "ioredis";
import { getEnv } from "@/env";

const globalForRedis = globalThis as unknown as { redis?: IORedis };

/** Shared Redis connection for rate limits, locks and the health check. */
export function getRedis(): IORedis {
  globalForRedis.redis ??= new IORedis(getEnv().REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    lazyConnect: true,
  });
  return globalForRedis.redis;
}
