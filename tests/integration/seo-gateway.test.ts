import IORedis from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RedisLockStore } from "@/server/locks";
import { MockSeoProvider } from "@/server/providers/seo/mock";
import { ProviderError } from "@/server/providers/seo/errors";
import type { ProviderResult, RankResult, SeoDataProvider } from "@/server/providers/seo/types";
import { SeoGateway, type GatewayGuard } from "@/server/services/seo-gateway";
import { createAgencyWithMembers } from "../factories";
import { createTestClient, resetDb } from "../helpers/db";

const prisma = createTestClient();
const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379");

/** Wraps the mock and counts how many times each method really runs. */
class CountingProvider extends MockSeoProvider {
  calls: Record<string, number> = {};
  costOverride?: number;
  failNext = false;
  private count(name: string) {
    this.calls[name] = (this.calls[name] ?? 0) + 1;
  }
  override async getRankings(
    i: Parameters<MockSeoProvider["getRankings"]>[0],
  ): Promise<ProviderResult<RankResult[]>> {
    this.count("getRankings");
    if (this.failNext) {
      this.failNext = false;
      throw new ProviderError("boom", true);
    }
    const result = await super.getRankings(i);
    return this.costOverride === undefined ? result : { ...result, costMicros: this.costOverride };
  }
  override getKeywordIdeas(i: Parameters<MockSeoProvider["getKeywordIdeas"]>[0]) {
    this.count("getKeywordIdeas");
    return super.getKeywordIdeas(i);
  }
  override getAuditResult(taskId: string) {
    this.count("getAuditResult");
    return super.getAuditResult(taskId);
  }
}

let agencyId: string;
let now = new Date("2026-03-10T10:00:00Z");

function makeGateway(provider: SeoDataProvider, guard?: GatewayGuard) {
  return new SeoGateway({
    provider: () => provider,
    db: prisma,
    locks: new RedisLockStore(redis, `test-lock:${Date.now()}:`),
    now: () => now,
    guard,
    pollMs: 20,
    lockWaitMs: 5000,
  });
}

const rankingInput = {
  domain: "example.com",
  keywords: ["seo tools", "dentist near me", "seo tools"],
  locationCode: 2840,
  languageCode: "en",
  device: "desktop" as const,
};

beforeAll(async () => {
  await resetDb(prisma);
  const { agency } = await createAgencyWithMembers(prisma, ["OWNER"]);
  agencyId = agency.id;
});
beforeEach(async () => {
  now = new Date("2026-03-10T10:00:00Z");
  await prisma.usageRecord.deleteMany({});
  await prisma.providerCache.deleteMany({});
});
afterAll(async () => {
  await prisma.$disconnect();
  redis.disconnect();
});

describe("cache", () => {
  it("answers an identical second call from the cache: the provider runs once", async () => {
    const provider = new CountingProvider({ now: () => now });
    const gateway = makeGateway(provider);
    const first = await gateway.getRankings({ agencyId }, rankingInput);
    const second = await gateway.getRankings(
      { agencyId },
      { ...rankingInput, keywords: ["Dentist near me ", "seo tools"] },
    );
    expect(provider.calls.getRankings).toBe(1);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.costMicros).toBe(0);
    expect(second.data).toEqual(first.data);
    expect(first.data.map((r) => r.keyword)).toEqual(["dentist near me", "seo tools"]);
    expect(await prisma.usageRecord.count()).toBe(1);
  });

  it("asks again after the UTC day changes, because rankings change daily", async () => {
    const provider = new CountingProvider({ now: () => now });
    const gateway = makeGateway(provider);
    await gateway.getRankings({ agencyId }, rankingInput);
    now = new Date("2026-03-10T23:59:00Z");
    expect((await gateway.getRankings({ agencyId }, rankingInput)).cached).toBe(true);
    now = new Date("2026-03-11T00:01:00Z");
    expect((await gateway.getRankings({ agencyId }, rankingInput)).cached).toBe(false);
    expect(provider.calls.getRankings).toBe(2);
  });

  it("keeps keyword ideas for 30 days", async () => {
    const provider = new CountingProvider({ now: () => now });
    const gateway = makeGateway(provider);
    const input = { seed: "Dental Implants", locationCode: 2840, languageCode: "en", limit: 10 };
    await gateway.getKeywordIdeas({ agencyId }, input);
    now = new Date("2026-04-05T10:00:00Z");
    expect(
      (await gateway.getKeywordIdeas({ agencyId }, { ...input, seed: "  dental   implants" }))
        .cached,
    ).toBe(true);
    now = new Date("2026-04-10T10:00:01Z");
    expect((await gateway.getKeywordIdeas({ agencyId }, input)).cached).toBe(false);
    expect(provider.calls.getKeywordIdeas).toBe(2);
  });

  it("does not mix answers of different providers", async () => {
    const mock = new CountingProvider({ now: () => now });
    const other = new CountingProvider({ now: () => now });
    Object.defineProperty(other, "name", { value: "dataforseo" });
    await makeGateway(mock).getRankings({ agencyId }, rankingInput);
    const result = await makeGateway(other).getRankings({ agencyId }, rankingInput);
    expect(result.cached).toBe(false);
  });
});

describe("duplicate suppression", () => {
  it("makes one provider call when identical requests arrive at the same time", async () => {
    const provider = new CountingProvider({ now: () => now, latencyMs: 250 });
    const gateway = makeGateway(provider);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => gateway.getRankings({ agencyId }, rankingInput)),
    );
    expect(provider.calls.getRankings).toBe(1);
    expect(results.filter((r) => !r.cached)).toHaveLength(1);
    expect(results.filter((r) => r.cached)).toHaveLength(5);
    for (const r of results) expect(r.data).toEqual(results[0]!.data);
    expect(await prisma.usageRecord.count()).toBe(1);
  });

  it("runs different requests in parallel", async () => {
    const provider = new CountingProvider({ now: () => now, latencyMs: 100 });
    const gateway = makeGateway(provider);
    await Promise.all([
      gateway.getRankings({ agencyId }, { ...rankingInput, keywords: ["a"] }),
      gateway.getRankings({ agencyId }, { ...rankingInput, keywords: ["b"] }),
    ]);
    expect(provider.calls.getRankings).toBe(2);
  });

  it("releases the lock and stores nothing when the provider fails, so a retry works", async () => {
    const provider = new CountingProvider({ now: () => now });
    const gateway = makeGateway(provider);
    provider.failNext = true;
    await expect(gateway.getRankings({ agencyId }, rankingInput)).rejects.toBeInstanceOf(
      ProviderError,
    );
    expect(await prisma.usageRecord.count()).toBe(0);
    expect(await prisma.providerCache.count()).toBe(0);
    const retry = await gateway.getRankings({ agencyId }, rankingInput);
    expect(retry.cached).toBe(false);
    expect(await prisma.usageRecord.count()).toBe(1);
  });
});

describe("usage records", () => {
  it("records quantity, estimated cost, provider and project", async () => {
    const provider = new CountingProvider({ now: () => now });
    const gateway = makeGateway(provider);
    const result = await gateway.getRankings({ agencyId, projectId: "proj_1" }, rankingInput);
    expect(result.costMicros).toBe(1200); // 2 unique keywords x 600
    const record = await prisma.usageRecord.findFirstOrThrow();
    expect(record).toMatchObject({
      agencyId,
      projectId: "proj_1",
      metric: "RANK_CHECK",
      quantity: 2,
      costMicros: 1200,
      provider: "mock",
      operation: "rankings",
    });
    expect(record.requestHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("uses live pricing and the LIVE_CHECK metric for live priority", async () => {
    const provider = new CountingProvider({ now: () => now });
    await makeGateway(provider).getRankings({ agencyId }, { ...rankingInput, priority: "live" });
    const record = await prisma.usageRecord.findFirstOrThrow();
    expect(record).toMatchObject({
      metric: "LIVE_CHECK",
      quantity: 2,
      costMicros: 4000,
      operation: "rankings_live",
    });
  });

  it("saves the real cost when the provider reports one", async () => {
    const provider = new CountingProvider({ now: () => now });
    provider.costOverride = 777;
    const result = await makeGateway(provider).getRankings({ agencyId }, rankingInput);
    expect(result.costMicros).toBe(777);
    expect((await prisma.usageRecord.findFirstOrThrow()).costMicros).toBe(777);
  });

  it("writes audit page usage once, from the number of crawled pages", async () => {
    const provider = new CountingProvider({ now: () => now, auditSeconds: 0 });
    const gateway = makeGateway(provider);
    const { taskId } = await gateway.startAudit(
      { agencyId },
      { domain: "example.com", maxPages: 80 },
    );
    expect(await gateway.getAuditStatus(taskId)).toMatchObject({ status: "completed" });
    const first = await gateway.getAuditResult({ agencyId }, taskId);
    const second = await gateway.getAuditResult({ agencyId }, taskId);
    expect(second.cached).toBe(true);
    expect(provider.calls.getAuditResult).toBe(1);
    const records = await prisma.usageRecord.findMany();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      metric: "AUDIT_PAGE",
      quantity: first.data.pagesCrawled,
      costMicros: first.data.pagesCrawled * 250,
    });
  });

  it("lets the guard block a call before the provider runs", async () => {
    const provider = new CountingProvider({ now: () => now });
    const guard: GatewayGuard = {
      beforeCall: async () => {
        throw new Error("Limit reached");
      },
    };
    await expect(
      makeGateway(provider, guard).getRankings({ agencyId }, rankingInput),
    ).rejects.toThrow("Limit reached");
    expect(provider.calls.getRankings).toBeUndefined();
    expect(await prisma.usageRecord.count()).toBe(0);
  });

  it("does not call the guard for cached answers", async () => {
    const provider = new CountingProvider({ now: () => now });
    let guardCalls = 0;
    const guard: GatewayGuard = { beforeCall: async () => void guardCalls++ };
    const gateway = makeGateway(provider, guard);
    await gateway.getRankings({ agencyId }, rankingInput);
    await gateway.getRankings({ agencyId }, rankingInput);
    expect(guardCalls).toBe(1);
  });
});
