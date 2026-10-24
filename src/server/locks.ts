import { randomUUID } from "node:crypto";

export interface LockStore {
  /** Returns a token if the lock was taken, or null if someone else holds it. */
  acquire(key: string, ttlMs: number): Promise<string | null>;
  /** Releases the lock only if `token` is still the owner. */
  release(key: string, token: string): Promise<void>;
}

type RedisLike = {
  set(key: string, value: string, mode: "PX", ms: number, flag: "NX"): Promise<"OK" | null>;
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
};

const RELEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end
`;

/** A simple Redis lock (SET NX PX). The lock expires by itself, so a crash cannot block forever. */
export class RedisLockStore implements LockStore {
  constructor(
    private readonly redis: RedisLike,
    private readonly prefix = "lock:",
  ) {}

  async acquire(key: string, ttlMs: number): Promise<string | null> {
    const token = randomUUID();
    const result = await this.redis.set(this.prefix + key, token, "PX", ttlMs, "NX");
    return result === "OK" ? token : null;
  }

  async release(key: string, token: string): Promise<void> {
    await this.redis.eval(RELEASE_SCRIPT, 1, this.prefix + key, token);
  }
}
