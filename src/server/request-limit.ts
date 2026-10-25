import "server-only";
import { headers } from "next/headers";
import { clientIp } from "@/server/auth/auth-rate-limit";
import { logger } from "@/server/logger";
import { consume, RedisRateLimitStore, type RateLimitStore } from "@/server/rate-limit";
import { getRedis } from "@/server/redis";

let store: RateLimitStore | undefined;
const getStore = () => (store ??= new RedisRateLimitStore(getRedis()));

/** Replace the store (tests use an in-memory one). */
export function setRequestLimitStore(next: RateLimitStore | undefined): void {
  store = next;
}

/**
 * Counts one hit and says if the caller is still allowed. If Redis is down this lets the request
 * through, because shutting everyone out is worse than a short gap in limiting.
 */
export async function allow(
  key: string,
  limit: number,
  windowSec: number,
): Promise<{ allowed: boolean; retryAfterSec: number }> {
  try {
    const result = await consume(getStore(), { key, limit, windowSec });
    return { allowed: result.allowed, retryAfterSec: result.retryAfterSec };
  } catch (error) {
    logger.warn({ err: error, key }, "rate limit check failed");
    return { allowed: true, retryAfterSec: 0 };
  }
}

/**
 * For route handlers: limit by client IP. Returns a 429 response to send back, or null to go on.
 * `name` groups the counter (for example "share"), so different routes have separate budgets.
 */
export async function limitRequest(
  request: Request,
  name: string,
  limit: number,
  windowSec = 60,
): Promise<Response | null> {
  const ip = clientIp(request.headers);
  const result = await allow(`req:${name}:${ip}`, limit, windowSec);
  if (result.allowed) return null;
  logger.warn({ name, ip }, "request rate limited");
  return new Response("Too many requests. Please wait a moment and try again.", {
    status: 429,
    headers: { "Retry-After": String(result.retryAfterSec), "Cache-Control": "no-store" },
  });
}

/** For pages (which cannot send a 429): true when this visitor is over the limit. */
export async function pageLimited(name: string, limit: number, windowSec = 60): Promise<boolean> {
  const ip = clientIp(await headers());
  return !(await allow(`req:${name}:${ip}`, limit, windowSec)).allowed;
}

/** Limit for actions that change data: per signed-in person. */
export async function mutationAllowed(userId: string, perMinute: number): Promise<boolean> {
  return (await allow(`mutation:${userId}`, perMinute, 60)).allowed;
}
