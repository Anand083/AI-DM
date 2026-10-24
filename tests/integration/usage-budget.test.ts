import IORedis from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RedisLockStore } from "@/server/locks";
import { runRankCheckScheduler } from "@/server/jobs/system/scheduler";
import { MockSeoProvider } from "@/server/providers/seo/mock";
import { createBudgetService, type BudgetStatus } from "@/server/services/budget";
import { ForbiddenError, LimitExceededError } from "@/server/services/errors";
import { SeoGateway } from "@/server/services/seo-gateway";
import { createSeoGuard } from "@/server/services/seo-guard";
import { assertWithinLimit, getUsageSummary } from "@/server/services/usage";
import { createAgencyWithMembers, seedPlans } from "../factories";
import { createTestClient, resetDb } from "../helpers/db";

const prisma = createTestClient();
const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379");

class CountingProvider extends MockSeoProvider {
  calls = 0;
  override getRankings(...args: Parameters<MockSeoProvider["getRankings"]>) {
    this.calls++;
    return super.getRankings(...args);
  }
}

async function agency(plan: string) {
  const { agency, members } = await createAgencyWithMembers(
    prisma,
    ["OWNER", "MEMBER"],
    undefined,
    plan,
  );
  return { agency, owner: members[0]!.ctx, member: members[1]!.ctx };
}

async function addUsage(
  agencyId: string,
  metric: "LIVE_CHECK" | "RANK_CHECK" | "KEYWORD_RESEARCH",
  quantity: number,
  costMicros = 0,
) {
  await prisma.usageRecord.create({
    data: { agencyId, metric, quantity, costMicros, provider: "mock", operation: "test" },
  });
}

beforeAll(async () => {
  await resetDb(prisma);
  await seedPlans(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
  redis.disconnect();
});

describe("assertWithinLimit", () => {
  it("allows use up to the limit and blocks the next unit with a clear message", async () => {
    const { agency: a } = await agency("STARTER"); // 50 live checks
    await addUsage(a.id, "LIVE_CHECK", 49);
    await expect(assertWithinLimit({ agencyId: a.id }, "LIVE_CHECK", 1)).resolves.toBeUndefined();
    await addUsage(a.id, "LIVE_CHECK", 1);
    const error = await assertWithinLimit({ agencyId: a.id }, "LIVE_CHECK", 1).catch((e) => e);
    expect(error).toBeInstanceOf(LimitExceededError);
    expect(error.message).toMatch(
      /^You have used all 50 live rank checks for this month on your Starter plan\. It resets on [A-Z][a-z]+ \d+, \d{4}\. Upgrade your plan to get more\.$/,
    );
  });

  it("says how many are left when a request is too big", async () => {
    const { agency: a } = await agency("STARTER");
    await addUsage(a.id, "LIVE_CHECK", 45);
    await expect(assertWithinLimit({ agencyId: a.id }, "LIVE_CHECK", 10)).rejects.toThrow(
      "This needs 10 live rank checks, but you only have 5 left this month on your Starter plan.",
    );
    await expect(assertWithinLimit({ agencyId: a.id }, "LIVE_CHECK", 5)).resolves.toBeUndefined();
  });

  it("counts only the current period and only this agency", async () => {
    const { agency: a } = await agency("STARTER");
    const { agency: other } = await agency("STARTER");
    await addUsage(other.id, "LIVE_CHECK", 50);
    await prisma.usageRecord.create({
      data: {
        agencyId: a.id,
        metric: "LIVE_CHECK",
        quantity: 50,
        costMicros: 0,
        provider: "mock",
        operation: "old",
        createdAt: new Date(Date.now() - 40 * 86_400_000),
      },
    });
    // The agency was "created" just now, so a record 40 days old is before the period start.
    await expect(assertWithinLimit({ agencyId: a.id }, "LIVE_CHECK", 50)).resolves.toBeUndefined();
  });

  it("does not limit metrics without a plan limit", async () => {
    const { agency: a } = await agency("STARTER");
    await addUsage(a.id, "RANK_CHECK", 1_000_000);
    await expect(
      assertWithinLimit({ agencyId: a.id }, "RANK_CHECK", 1000),
    ).resolves.toBeUndefined();
  });

  it("treats -1 as unlimited", async () => {
    const plan = await prisma.plan.create({
      data: {
        code: "UNLIMITED_TEST",
        name: "Unlimited",
        priceMonthlyCents: 0,
        priceYearlyCents: 0,
        limits: { liveChecksPerMonth: -1, keywordResearchPerMonth: -1 },
      },
    });
    const { agency: a } = await createAgencyWithMembers(prisma, ["OWNER"]);
    await prisma.subscription.create({
      data: { agencyId: a.id, planId: plan.id, status: "ACTIVE" },
    });
    await addUsage(a.id, "LIVE_CHECK", 1_000_000);
    await expect(
      assertWithinLimit({ agencyId: a.id }, "LIVE_CHECK", 5000),
    ).resolves.toBeUndefined();
  });

  it("blocks an ended subscription", async () => {
    const { agency: a } = await agency("STARTER");
    await prisma.subscription.update({ where: { agencyId: a.id }, data: { status: "EXPIRED" } });
    await expect(assertWithinLimit({ agencyId: a.id }, "KEYWORD_RESEARCH", 1)).rejects.toThrow(
      "Your subscription has ended",
    );
  });
});

describe("gateway with the guard: at the limit the provider is never called", () => {
  function makeGateway(provider: CountingProvider, paused = async () => false) {
    return new SeoGateway({
      provider: () => provider,
      db: prisma,
      locks: new RedisLockStore(redis, `test-lock:${Date.now()}:`),
      guard: createSeoGuard({ isPaused: paused, assertWithinLimit }),
    });
  }
  const input = {
    domain: "example.com",
    keywords: ["a", "b", "c"],
    locationCode: 2840,
    languageCode: "en",
    device: "desktop" as const,
  };

  it("blocks a live check over the limit, but still allows standard checks", async () => {
    const { agency: a } = await agency("STARTER");
    await addUsage(a.id, "LIVE_CHECK", 48);
    const provider = new CountingProvider();
    const gateway = makeGateway(provider);
    await expect(
      gateway.getRankings({ agencyId: a.id }, { ...input, priority: "live" }),
    ).rejects.toBeInstanceOf(LimitExceededError);
    expect(provider.calls).toBe(0);
    await expect(
      gateway.getRankings({ agencyId: a.id }, { ...input, keywords: ["a", "b"], priority: "live" }),
    ).resolves.toBeTruthy();
    expect(provider.calls).toBe(1);
    await expect(
      gateway.getRankings({ agencyId: a.id }, { ...input, keywords: ["x"] }),
    ).resolves.toBeTruthy();
    expect(provider.calls).toBe(2);
  });

  it("blocks everything while the budget is paused, with no money amounts in the message", async () => {
    const { agency: a } = await agency("STARTER");
    const provider = new CountingProvider();
    const error = await makeGateway(provider, async () => true)
      .getRankings({ agencyId: a.id }, input)
      .catch((e) => e);
    expect(error).toBeInstanceOf(LimitExceededError);
    expect(error.message).toBe("New data requests are paused for now. Please try again later.");
    expect(provider.calls).toBe(0);
  });
});

describe("platform budget", () => {
  let now = new Date("2026-03-15T12:00:00Z");
  const alerts: { level: string; month: string; percent: number }[] = [];

  function service(defaultBudgetUsd: number) {
    return createBudgetService({
      db: prisma,
      defaultBudgetUsd,
      now: () => now,
      cacheMs: 0,
      sendAlert: async (status: BudgetStatus, level) =>
        void alerts.push({ level, month: status.month, percent: status.percent }),
    });
  }
  async function spend(micros: number, at = now) {
    const { agency: a } = await createAgencyWithMembers(prisma, ["OWNER"]);
    await prisma.usageRecord.create({
      data: {
        agencyId: a.id,
        metric: "RANK_CHECK",
        quantity: 1,
        costMicros: micros,
        provider: "mock",
        operation: "t",
        createdAt: at,
      },
    });
  }

  beforeEach(async () => {
    now = new Date("2026-03-15T12:00:00Z");
    alerts.length = 0;
    await prisma.usageRecord.deleteMany({});
    await prisma.platformSetting.deleteMany({});
  });

  it("sums this calendar month's costs and goes ok, warn, paused at 80% and 100%", async () => {
    const budget = service(10); // $10
    await spend(7_900_000);
    expect(await budget.status()).toMatchObject({
      state: "ok",
      percent: 79,
      spentUsd: 7.9,
      budgetUsd: 10,
      month: "2026-03",
    });
    await spend(100_000);
    expect(await budget.status()).toMatchObject({ state: "warn", percent: 80 });
    await spend(2_000_000);
    expect(await budget.status()).toMatchObject({ state: "paused", percent: 100 });
    expect(await budget.isPaused()).toBe(true);
  });

  it("ignores spending from other months", async () => {
    await spend(50_000_000, new Date("2026-02-28T23:59:00Z"));
    expect(await service(10).status()).toMatchObject({ state: "ok", spentUsd: 0 });
  });

  it("sends each alert once per month, and again in the next month", async () => {
    const budget = service(10);
    await spend(8_500_000);
    await budget.checkAndAlert();
    await budget.checkAndAlert();
    expect(alerts).toEqual([{ level: "warn", month: "2026-03", percent: 85 }]);
    await spend(2_000_000);
    await budget.checkAndAlert();
    await budget.checkAndAlert();
    expect(alerts.map((a) => a.level)).toEqual(["warn", "paused"]);
    now = new Date("2026-04-02T00:00:00Z");
    await spend(9_000_000, now);
    await budget.checkAndAlert();
    expect(alerts.map((a) => `${a.month}:${a.level}`)).toEqual([
      "2026-03:warn",
      "2026-03:paused",
      "2026-04:warn",
    ]);
  });

  it("jumps straight to paused: both alerts are sent", async () => {
    await spend(12_000_000);
    await service(10).checkAndAlert();
    expect(alerts.map((a) => a.level)).toEqual(["warn", "paused"]);
  });

  it("a budget saved in platform settings wins over the default, and 0 turns the guard off", async () => {
    await spend(12_000_000);
    expect((await service(10).status()).state).toBe("paused");
    await prisma.platformSetting.create({ data: { key: "providerBudgetUsd", value: 100 } });
    expect(await service(10).status()).toMatchObject({ state: "ok", budgetUsd: 100 });
    await prisma.platformSetting.update({
      where: { key: "providerBudgetUsd" },
      data: { value: 0 },
    });
    expect((await service(10).status()).state).toBe("ok");
  });

  it("at 100% the rank check scheduler queues nothing", async () => {
    await spend(10_000_000);
    const budget = service(10);
    const { agency: a } = await createAgencyWithMembers(prisma, ["OWNER"]);
    const client = await prisma.client.create({ data: { agencyId: a.id, name: "C" } });
    await prisma.project.create({
      data: {
        agencyId: a.id,
        clientId: client.id,
        name: "P",
        domain: "p.com",
        locationCode: 2840,
        languageCode: "en",
        rankCheckHourUtc: 0,
      },
    });
    const queued: string[] = [];
    const run = (paused: boolean) =>
      runRankCheckScheduler({
        db: prisma,
        now: new Date("2026-03-15T23:59:00Z"),
        enqueue: async (j) => (queued.push(j.projectId), true),
        paused: async () => paused,
      });
    expect(await run(await budget.isPaused())).toMatchObject({ paused: true, queued: 0 });
    expect(queued).toHaveLength(0);
    expect(await run(false)).toMatchObject({ queued: 1 });
  });
});

describe("getUsageSummary", () => {
  it("shows percent used per metric and plan totals, to owners only", async () => {
    const { agency: a, owner, member } = await agency("STARTER");
    await addUsage(a.id, "LIVE_CHECK", 25);
    await addUsage(a.id, "KEYWORD_RESEARCH", 100);
    await prisma.client.createMany({
      data: [
        { agencyId: a.id, name: "C1" },
        { agencyId: a.id, name: "C2" },
      ],
    });
    const summary = await getUsageSummary(owner);
    expect(summary.planName).toBe("Starter");
    const live = summary.monthly.find((l) => l.key === "LIVE_CHECK")!;
    expect(live).toMatchObject({ used: 25, limit: 50, percent: 50, label: "Live rank checks" });
    expect(summary.monthly.find((l) => l.key === "KEYWORD_RESEARCH")).toMatchObject({
      percent: 100,
    });
    expect(summary.monthly.find((l) => l.key === "AUDIT_PAGE")).toMatchObject({
      used: 0,
      percent: 0,
    });
    expect(summary.totals.find((l) => l.key === "maxClients")).toMatchObject({
      used: 2,
      limit: 5,
      percent: 40,
    });
    expect(summary.totals.find((l) => l.key === "maxTeamMembers")).toMatchObject({
      used: 2,
      limit: 2,
      percent: 100,
    });
    expect(summary.period.end.getTime()).toBeGreaterThan(Date.now());
    await expect(getUsageSummary(member)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("only counts this agency", async () => {
    const { owner } = await agency("GROWTH");
    const { agency: other } = await agency("GROWTH");
    await addUsage(other.id, "LIVE_CHECK", 100);
    expect((await getUsageSummary(owner)).monthly.find((l) => l.key === "LIVE_CHECK")!.used).toBe(
      0,
    );
  });
});
