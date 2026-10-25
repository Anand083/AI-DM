import IORedis from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { runBacklinkScheduler } from "@/server/jobs/system/backlink-scheduler";
import { RedisLockStore } from "@/server/locks";
import { MockSeoProvider } from "@/server/providers/seo/mock";
import type { Backlink } from "@/server/providers/seo/types";
import { runBacklinkRefresh, type BacklinkGateway } from "@/server/services/backlink-runner";
import {
  backlinkWindow,
  getBacklinkOverview,
  listBacklinks,
  listBacklinksForExport,
  requestBacklinkCheck,
} from "@/server/services/backlinks";
import {
  ConflictError,
  ForbiddenError,
  LimitExceededError,
  NotFoundError,
} from "@/server/services/errors";
import { SeoGateway } from "@/server/services/seo-gateway";
import { createAgencyWithMembers, seedPlans } from "../factories";
import { createTestClient, resetDb } from "../helpers/db";

const prisma = createTestClient();
const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379");

beforeAll(async () => {
  await resetDb(prisma);
  await seedPlans(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
  redis.disconnect();
});

async function setup(plan = "GROWTH") {
  const { agency, members } = await createAgencyWithMembers(
    prisma,
    ["OWNER", "MEMBER"],
    undefined,
    plan,
  );
  const client = await prisma.client.create({ data: { agencyId: agency.id, name: "Client" } });
  const project = await prisma.project.create({
    data: {
      agencyId: agency.id,
      clientId: client.id,
      name: "Site",
      domain: "example.com",
      locationCode: 2840,
      languageCode: "en",
    },
  });
  return { agency, project, owner: members[0]!.ctx, member: members[1]!.ctx };
}

const link = (n: number, extra: Partial<Backlink> = {}): Backlink => ({
  sourceUrl: `https://site${n}.com/post`,
  sourceDomain: `site${n}.com`,
  targetUrl: "https://example.com/",
  anchor: "read more",
  dofollow: true,
  firstSeen: "2026-01-01",
  lastSeen: "2026-03-01",
  lostAt: null,
  sourceRating: 40,
  ...extra,
});

/** A gateway that returns the links you give it. */
function fakeGateway(getLinks: () => Backlink[]): BacklinkGateway & { limits: number[] } {
  const limits: number[] = [];
  return {
    limits,
    getBacklinkSummary: async (_caller: unknown, domain: string) => ({
      data: {
        domain,
        totalBacklinks: getLinks().length,
        referringDomains: getLinks().length,
        dofollowPercent: 80,
        newLast30Days: 0,
        lostLast30Days: 0,
        domainRating: 33,
      },
      provider: "mock",
      cached: false,
    }),
    getBacklinks: async (_caller: unknown, input: { limit: number }) => {
      limits.push(input.limit);
      return { data: getLinks().slice(0, input.limit), provider: "mock", cached: false };
    },
  } as never;
}

const run = (
  s: Awaited<ReturnType<typeof setup>>,
  gateway: BacklinkGateway,
  date: string,
  window = 200,
) =>
  runBacklinkRefresh(
    { db, gateway, windowFor: async () => window },
    { projectId: s.project.id, agencyId: s.agency.id, date },
  );

describe("backlink check", () => {
  it("saves links, flags suspicious ones and takes a first snapshot without alerts", async () => {
    const s = await setup();
    await prisma.keyword.create({
      data: { agencyId: s.agency.id, projectId: s.project.id, phrase: "best plumber" },
    });
    const links = [
      link(1),
      link(2, { sourceDomain: "spam.xyz", sourceUrl: "https://spam.xyz/a" }),
      link(3, { sourceRating: 2 }),
      link(4, { anchor: "Best Plumber" }),
    ];
    const gateway = fakeGateway(() => links);

    const result = await run(s, gateway, "2026-03-02", 3);
    expect(gateway.limits).toEqual([3]);
    expect(result).toMatchObject({ status: "done", stored: 3, newLinks: 0, lostLinks: 0 });

    const rows = await prisma.backlink.findMany({
      where: { projectId: s.project.id },
      orderBy: { sourceUrl: "asc" },
    });
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.sourceDomain === "spam.xyz")?.suspiciousReasons).toEqual([
      "spammy_tld",
    ]);
    expect(rows.find((r) => r.sourceRating === 2)?.suspicious).toBe(true);
    expect(rows[0]?.suspicious).toBe(false);

    const snaps = await prisma.backlinkSnapshot.findMany({ where: { projectId: s.project.id } });
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toMatchObject({ totalBacklinks: 4, domainRating: 33, newLinks: 0 });
    expect(await prisma.alert.count({ where: { agencyId: s.agency.id } })).toBe(0);
  });

  it("does nothing when run again for the same day", async () => {
    const s = await setup();
    const gateway = fakeGateway(() => [link(1)]);
    expect((await run(s, gateway, "2026-03-02")).status).toBe("done");
    expect((await run(s, gateway, "2026-03-02")).status).toBe("already-checked");
    expect(gateway.limits).toHaveLength(1);
    expect(await prisma.backlinkSnapshot.count({ where: { projectId: s.project.id } })).toBe(1);
  });

  it("finds new and lost links since the last check and alerts on a big loss", async () => {
    const s = await setup();
    const first = Array.from({ length: 20 }, (_, i) => link(i + 1));
    let current = first;
    const gateway = fakeGateway(() => current);
    await run(s, gateway, "2026-03-02");

    // A week later: 10 links are gone, 2 are new.
    current = [
      ...first.slice(0, 10),
      ...first.slice(10).map((l) => ({ ...l, lostAt: "2026-03-05", lastSeen: "2026-03-05" })),
      link(21, { firstSeen: "2026-03-06" }),
      link(22, { firstSeen: "2026-03-08" }),
    ];
    const result = await run(s, gateway, "2026-03-09");
    expect(result).toMatchObject({ status: "done", newLinks: 2, lostLinks: 10, alerted: true });

    const alert = await prisma.alert.findFirstOrThrow({ where: { agencyId: s.agency.id } });
    expect(alert).toMatchObject({
      type: "BACKLINKS_LOST",
      severity: "CRITICAL",
      projectId: s.project.id,
      dedupeKey: `backlinks_lost:${s.project.id}:2026-03-09`,
    });
    expect(await prisma.backlink.count({ where: { projectId: s.project.id, lostAt: null } })).toBe(
      12,
    );

    const overview = await getBacklinkOverview(s.owner, s.project.id);
    expect(overview.latest).toMatchObject({ takenOn: "2026-03-09", newLinks: 2, lostLinks: 10 });
    expect(overview.change).toEqual({ backlinks: 2, referringDomains: 2 });

    const lost = await listBacklinks(s.owner, s.project.id, "lost");
    expect(lost.total).toBe(10);
    const added = await listBacklinks(s.owner, s.project.id, "new");
    expect(added.rows.map((r) => r.sourceDomain).sort()).toEqual(["site21.com", "site22.com"]);
  });

  it("brings a link back when the provider sees it again", async () => {
    const s = await setup();
    let current = [link(1, { lostAt: "2026-03-01" })];
    const gateway = fakeGateway(() => current);
    await run(s, gateway, "2026-03-02");
    expect(
      (await prisma.backlink.findFirstOrThrow({ where: { projectId: s.project.id } })).lostAt,
    ).not.toBeNull();
    current = [link(1, { lastSeen: "2026-03-09" })];
    await run(s, gateway, "2026-03-09");
    expect(
      (await prisma.backlink.findFirstOrThrow({ where: { projectId: s.project.id } })).lostAt,
    ).toBeNull();
  });

  it("skips a project that was deleted", async () => {
    const s = await setup();
    await prisma.project.update({ where: { id: s.project.id }, data: { deletedAt: new Date() } });
    expect(
      (
        await run(
          s,
          fakeGateway(() => []),
          "2026-03-02",
        )
      ).status,
    ).toBe("inactive");
  });

  it("works with the mock provider through the gateway and counts the lookups", async () => {
    const s = await setup();
    const now = new Date("2026-03-02T10:00:00Z");
    const gateway = new SeoGateway({
      provider: () => new MockSeoProvider({ now: () => now }),
      db: prisma,
      locks: new RedisLockStore(redis, `test-lock:${Date.now()}:`),
      now: () => now,
    });
    const result = await run(s, gateway, "2026-03-02", 50);
    expect(result.status).toBe("done");
    const used = await prisma.usageRecord.aggregate({
      where: { agencyId: s.agency.id, metric: "BACKLINK_QUERY" },
      _sum: { quantity: true },
    });
    expect(used._sum.quantity).toBe(51);
    expect(await prisma.backlink.count({ where: { projectId: s.project.id } })).toBeGreaterThan(0);
  });
});

describe("plan window and permissions", () => {
  it("shrinks the window as lookups are used and stops when too few are left", async () => {
    const s = await setup("STARTER");
    expect(await backlinkWindow(s.owner)).toBe(49);
    await prisma.usageRecord.create({
      data: {
        agencyId: s.agency.id,
        metric: "BACKLINK_QUERY",
        quantity: 30,
        costMicros: 0,
        provider: "mock",
        operation: "test",
      },
    });
    expect(await backlinkWindow(s.owner)).toBe(19);
    await prisma.usageRecord.create({
      data: {
        agencyId: s.agency.id,
        metric: "BACKLINK_QUERY",
        quantity: 17,
        costMicros: 0,
        provider: "mock",
        operation: "test",
      },
    });
    await expect(backlinkWindow(s.owner)).rejects.toBeInstanceOf(LimitExceededError);
  });

  it("refuses a check that was already done today, and people who may not run tools", async () => {
    const s = await setup();
    const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    await prisma.backlinkSnapshot.create({
      data: {
        agencyId: s.agency.id,
        projectId: s.project.id,
        takenOn: today,
        totalBacklinks: 1,
        referringDomains: 1,
        dofollowPercent: 100,
        domainRating: 10,
        newLinks: 0,
        lostLinks: 0,
      },
    });
    await expect(requestBacklinkCheck(s.owner, s.project.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(
      requestBacklinkCheck({ ...s.owner, role: "CLIENT" }, s.project.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      getBacklinkOverview({ ...s.owner, role: "CLIENT" }, s.project.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("weekly scheduler", () => {
  it("queues only projects that were checked before and are 7 or more days old", async () => {
    const s = await setup();
    const make = async (name: string, takenOn?: string) => {
      const p = await prisma.project.create({
        data: {
          agencyId: s.agency.id,
          clientId: (await prisma.client.findFirstOrThrow({ where: { agencyId: s.agency.id } })).id,
          name,
          domain: `${name}.com`,
          locationCode: 2840,
          languageCode: "en",
        },
      });
      if (takenOn)
        await prisma.backlinkSnapshot.create({
          data: {
            agencyId: s.agency.id,
            projectId: p.id,
            takenOn: new Date(`${takenOn}T00:00:00Z`),
            totalBacklinks: 1,
            referringDomains: 1,
            dofollowPercent: 100,
            domainRating: 10,
            newLinks: 0,
            lostLinks: 0,
          },
        });
      return p;
    };
    const old = await make("old", "2026-03-01");
    const fresh = await make("fresh", "2026-03-08");
    const never = await make("never");
    const queued: string[] = [];
    const result = await runBacklinkScheduler({
      db: prisma,
      now: new Date("2026-03-09T00:05:00Z"),
      enqueue: async (j) => (queued.push(j.projectId), true),
    });
    // Other tests in this file left old snapshots too, so look at these three projects only.
    expect(queued).toContain(old.id);
    expect(queued).not.toContain(fresh.id);
    expect(queued).not.toContain(never.id);
    expect(result.queued).toBe(queued.length);

    const paused = await runBacklinkScheduler({
      db: prisma,
      now: new Date("2026-03-09T00:05:00Z"),
      enqueue: async () => true,
      paused: async () => true,
    });
    expect(paused).toMatchObject({ queued: 0, paused: true });
  });
});

describe("tenant isolation: backlinks", () => {
  let a: Awaited<ReturnType<typeof setup>>;
  let b: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    a = await setup();
    b = await setup();
    await run(
      b,
      fakeGateway(() => [link(1), link(2)]),
      "2026-03-02",
    );
  });

  it("another agency's project is not found for every read", async () => {
    await expect(getBacklinkOverview(a.owner, b.project.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listBacklinks(a.owner, b.project.id, "active")).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(listBacklinksForExport(a.owner, b.project.id, "active")).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(requestBacklinkCheck(a.owner, b.project.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("the owner still sees the data, and the other agency's list stays empty", async () => {
    expect((await listBacklinks(b.owner, b.project.id, "active")).total).toBe(2);
    expect((await listBacklinks(a.owner, a.project.id, "active")).total).toBe(0);
  });
});
