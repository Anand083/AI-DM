/**
 * Fixed-window rate limiter. The store is swappable: Redis in the app, memory in unit tests.
 * This file has no server-only imports on purpose, so it can be unit tested.
 */

export interface RateLimitStore {
  /** Adds one hit to `key`. The window starts at the first hit and lasts `windowSec` seconds. */
  hit(key: string, windowSec: number): Promise<{ count: number; ttlSec: number }>;
}

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSec: number };

export async function consume(
  store: RateLimitStore,
  options: { key: string; limit: number; windowSec: number },
): Promise<RateLimitResult> {
  const { count, ttlSec } = await store.hit(options.key, options.windowSec);
  const allowed = count <= options.limit;
  return {
    allowed,
    remaining: Math.max(0, options.limit - count),
    retryAfterSec: allowed ? 0 : Math.max(1, ttlSec),
  };
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async hit(key: string, windowSec: number) {
    const now = this.now();
    let entry = this.entries.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowSec * 1000 };
      this.entries.set(key, entry);
    }
    entry.count += 1;
    return { count: entry.count, ttlSec: Math.ceil((entry.resetAt - now) / 1000) };
  }
}

type RedisLike = {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
};

const HIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return {count, ttl}
`;

export class RedisRateLimitStore implements RateLimitStore {
  constructor(
    private readonly redis: RedisLike,
    private readonly prefix = "rl:",
  ) {}

  async hit(key: string, windowSec: number) {
    const result = (await this.redis.eval(HIT_SCRIPT, 1, this.prefix + key, windowSec)) as [
      number,
      number,
    ];
    return { count: Number(result[0]), ttlSec: Number(result[1]) };
  }
}
