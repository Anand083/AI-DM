import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { distribution, visibilityScore } from "@/lib/rank-math";
import { redisConnectionOptions } from "@/server/jobs/config";
import { processors } from "@/server/jobs/processors";
import { getQueue, getQueues } from "@/server/jobs/queues";
import { createWorkerRuntime } from "@/server/jobs/runtime";
import { MockSeoProvider } from "@/server/providers/seo/mock";
import { db } from "@/server/db/client";
import { ForbiddenError, LimitExceededError, NotFoundError } from "@/server/services/errors";
import { requestCheckNow, getCheckNowStatus } from "@/server/services/check-now";
import {
  addKeywords,
  deleteKeywords,
  getKeywordDetail,
  getProjectSummary,
  listProjectTags,
  listRankings,
  listRankingsForExport,
} from "@/server/services/keywords";
import { backfillProject } from "@/server/services/mock-backfill";
import { runProjectRankCheck, RANK_BATCH_SIZE } from "@/server/services/rank-checks";
import { SeoGateway } from "@/server/services/seo-gateway";
import { RedisLockStore } from "@/server/locks";
import IORedis from "ioredis";
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

function makeGateway(provider: MockSeoProvider) {
  return new SeoGateway({
    provider: () => provider,
    db: prisma,
    locks: new RedisLockStore(redis, `test-lock:${Date.now()}:`),
  });
}

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

const words = (n: number, prefix = "keyword") =>
  Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`).join("\n");
const DAY = "2026-03-10";

beforeAll(async () => {
  await resetDb(prisma);
  await seedPlans(prisma);
});
afterEach(async () => {
  await getQueue("rank-checks").obliterate({ force: true });
});
afterAll(async () => {
  await Promise.all(Object.values(getQueues()).map((q) => q.close()));
  await prisma.$disconnect();
  redis.disconnect();
});

describe("adding keywords", () => {
  it("adds a pasted list, lowercases, removes duplicates, and stores tags and target URL", async () => {
    const { owner, project } = await setup();
    const result = await addKeywords(owner, project.id, {
      text: "SEO Tools\nseo  tools\n\nDentist Near Me\nbuy shoes\n",
      tags: "Brand, Local SEO, brand",
      targetUrl: "https://example.com/tools",
    });
    expect(result).toEqual({ added: 3, alreadyTracked: 0, duplicatesInPaste: 1, tooLong: 0 });
    const rows = await prisma.keyword.findMany({
      where: { projectId: project.id },
      orderBy: { phrase: "asc" },
    });
    expect(rows.map((r) => r.phrase)).toEqual(["buy shoes", "dentist near me", "seo tools"]);
    expect(rows[0]).toMatchObject({
      tags: ["brand", "local seo"],
      targetUrl: "https://example.com/tools",
      agencyId: owner.agencyId,
    });
    expect(await listProjectTags(owner, project.id)).toEqual(["brand", "local seo"]);
  });

  it("skips keywords that are already tracked", async () => {
    const { owner, project } = await setup();
    await addKeywords(owner, project.id, { text: "a\nb" });
    const again = await addKeywords(owner, project.id, { text: "B\nc" });
    expect(again).toMatchObject({ added: 1, alreadyTracked: 1 });
    expect(await prisma.keyword.count({ where: { projectId: project.id } })).toBe(3);
  });

  it("validates the input", async () => {
    const { owner, project } = await setup();
    await expect(addKeywords(owner, project.id, { text: "  \n " })).rejects.toMatchObject({
      fieldErrors: { text: expect.any(String) },
    });
    await expect(
      addKeywords(owner, project.id, { text: "a", targetUrl: "not a url" }),
    ).rejects.toMatchObject({
      fieldErrors: { targetUrl: expect.any(String) },
    });
  });

  it("enforces the plan's keyword limit (STARTER: 250)", async () => {
    const { owner, project } = await setup("STARTER");
    await addKeywords(owner, project.id, { text: words(250) });
    const error = await addKeywords(owner, project.id, { text: "one more" }).catch((e) => e);
    expect(error).toBeInstanceOf(LimitExceededError);
    expect(error.message).toBe(
      "Your Starter plan allows up to 250 keywords. Upgrade your plan to add more.",
    );
    expect(await prisma.keyword.count({ where: { agencyId: owner.agencyId } })).toBe(250);
    // Already tracked keywords do not count as new.
    await expect(addKeywords(owner, project.id, { text: "keyword 1" })).resolves.toMatchObject({
      added: 0,
      alreadyTracked: 1,
    });
  });

  it("members can add, client users cannot, and another agency's project is not found", async () => {
    const { owner, member, project } = await setup();
    await expect(addKeywords(member, project.id, { text: "x" })).resolves.toMatchObject({
      added: 1,
    });
    await expect(
      addKeywords({ ...owner, role: "CLIENT" }, project.id, { text: "y" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const other = await setup();
    await expect(addKeywords(other.owner, project.id, { text: "z" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(listRankings(other.owner, project.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("deletes keywords and their checks, only in the own project", async () => {
    const { owner, project } = await setup();
    await addKeywords(owner, project.id, { text: "a\nb\nc" });
    const kws = await prisma.keyword.findMany({ where: { projectId: project.id } });
    await runProjectRankCheck(
      { db, gateway: makeGateway(new MockSeoProvider()) },
      { projectId: project.id, agencyId: owner.agencyId, date: DAY, priority: "standard" },
    );
    expect(await prisma.rankCheck.count({ where: { agencyId: owner.agencyId } })).toBe(3);
    const other = await setup();
    expect(
      await deleteKeywords(
        other.owner,
        other.project.id,
        kws.map((k) => k.id),
      ),
    ).toBe(0);
    expect(await deleteKeywords(owner, project.id, [kws[0]!.id, kws[1]!.id])).toBe(2);
    expect(await prisma.keyword.count({ where: { projectId: project.id } })).toBe(1);
    expect(await prisma.rankCheck.count({ where: { agencyId: owner.agencyId } })).toBe(1);
  });
});

describe("rank checks", () => {
  it("saves one check per keyword per day, records usage and cost, and updates the snapshot", async () => {
    const { owner, project, agency } = await setup();
    await addKeywords(owner, project.id, { text: words(10) });
    const provider = new CountingProvider();
    const deps = { db, gateway: makeGateway(provider) };
    const run = {
      projectId: project.id,
      agencyId: agency.id,
      date: DAY,
      priority: "standard" as const,
    };

    expect(await runProjectRankCheck(deps, run)).toMatchObject({
      checked: 10,
      skipped: 0,
      total: 10,
    });
    expect(await prisma.rankCheck.count({ where: { agencyId: agency.id } })).toBe(10);
    const usage = await prisma.usageRecord.findMany({ where: { agencyId: agency.id } });
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      metric: "RANK_CHECK",
      quantity: 10,
      costMicros: 6000,
      projectId: project.id,
      provider: "mock",
    });

    const kw = await prisma.keyword.findFirstOrThrow({
      where: { projectId: project.id },
      orderBy: { phrase: "asc" },
    });
    const check = await prisma.rankCheck.findFirstOrThrow({ where: { keywordId: kw.id } });
    expect(kw.lastCheckedOn?.toISOString().slice(0, 10)).toBe(DAY);
    expect(kw.currentPosition).toBe(check.position);
    expect(kw.currentUrl).toBe(check.rankingUrl);
    expect(kw.changeDay).toBeNull();
    expect(check.provider).toBe("mock");
    expect(check.topResults).toHaveLength(10);
  });

  it("does nothing the second time: no duplicates, no second provider call, no second charge", async () => {
    const { owner, project, agency } = await setup();
    await addKeywords(owner, project.id, { text: words(5) });
    const provider = new CountingProvider();
    const deps = { db, gateway: makeGateway(provider) };
    const run = {
      projectId: project.id,
      agencyId: agency.id,
      date: DAY,
      priority: "standard" as const,
    };
    await runProjectRankCheck(deps, run);
    const second = await runProjectRankCheck(deps, run);
    expect(second).toMatchObject({ checked: 0, skipped: 5 });
    expect(provider.calls).toBe(1);
    expect(await prisma.rankCheck.count({ where: { agencyId: agency.id } })).toBe(5);
    expect(await prisma.usageRecord.count({ where: { agencyId: agency.id } })).toBe(1);
  });

  it("checks new keywords added later the same day, without redoing the old ones", async () => {
    const { owner, project, agency } = await setup();
    await addKeywords(owner, project.id, { text: "first\nsecond" });
    const deps = { db, gateway: makeGateway(new MockSeoProvider()) };
    const run = {
      projectId: project.id,
      agencyId: agency.id,
      date: DAY,
      priority: "standard" as const,
    };
    await runProjectRankCheck(deps, run);
    await addKeywords(owner, project.id, { text: "third" });
    expect(await runProjectRankCheck(deps, run)).toMatchObject({ checked: 1, skipped: 2 });
    expect(await prisma.rankCheck.count({ where: { agencyId: agency.id } })).toBe(3);
  });

  it("sends keywords in batches of 100", async () => {
    const { owner, project, agency } = await setup();
    await addKeywords(owner, project.id, { text: words(250) });
    const provider = new CountingProvider();
    const progress: number[] = [];
    await runProjectRankCheck(
      { db, gateway: makeGateway(provider) },
      {
        projectId: project.id,
        agencyId: agency.id,
        date: DAY,
        priority: "standard",
        onProgress: (done) => void progress.push(done),
      },
    );
    expect(RANK_BATCH_SIZE).toBe(100);
    expect(provider.calls).toBe(3);
    expect(progress).toEqual([100, 200, 250]);
  });

  it("computes changes from earlier days", async () => {
    const { owner, project, agency } = await setup();
    await addKeywords(owner, project.id, { text: words(30) });
    const deps = { db, gateway: makeGateway(new MockSeoProvider()) };
    for (const date of ["2026-03-01", "2026-03-09", "2026-03-10"]) {
      // Different days give (slightly) different positions from the mock provider.
      const provider = new MockSeoProvider({ now: () => new Date(`${date}T12:00:00Z`) });
      await runProjectRankCheck(
        { db, gateway: makeGateway(provider) },
        { projectId: project.id, agencyId: agency.id, date, priority: "standard" },
      );
    }
    void deps;
    const kws = await prisma.keyword.findMany({ where: { projectId: project.id } });
    for (const kw of kws) {
      const checks = await prisma.rankCheck.findMany({
        where: { keywordId: kw.id },
        orderBy: { date: "asc" },
      });
      const v = (p: number | null) => p ?? 101;
      expect(kw.changeDay).toBe(v(checks[1]!.position) - v(checks[2]!.position));
      expect(kw.changeWeek).toBe(v(checks[0]!.position) - v(checks[2]!.position)); // 03-01 is 9 days back: nearest on or before 03-03
      expect(kw.changeMonth).toBeNull();
    }
  });

  it("a live check replaces the day's result and counts as a live check", async () => {
    const { owner, project, agency } = await setup();
    await addKeywords(owner, project.id, { text: words(4) });
    const gateway = makeGateway(new MockSeoProvider());
    await runProjectRankCheck(
      { db, gateway },
      { projectId: project.id, agencyId: agency.id, date: DAY, priority: "standard" },
    );
    const live = await runProjectRankCheck(
      { db, gateway },
      { projectId: project.id, agencyId: agency.id, date: DAY, priority: "live" },
    );
    expect(live.checked).toBe(4);
    expect(await prisma.rankCheck.count({ where: { agencyId: agency.id } })).toBe(4);
    const liveUsage = await prisma.usageRecord.findFirstOrThrow({
      where: { agencyId: agency.id, metric: "LIVE_CHECK" },
    });
    expect(liveUsage).toMatchObject({ quantity: 4, costMicros: 8000 });
  });

  it("skips projects that are deleted or whose client is archived", async () => {
    const { owner, project, agency } = await setup();
    await addKeywords(owner, project.id, { text: "a" });
    const deps = { db, gateway: makeGateway(new CountingProvider()) };
    const run = {
      projectId: project.id,
      agencyId: agency.id,
      date: DAY,
      priority: "standard" as const,
    };
    await prisma.client.updateMany({
      where: { agencyId: agency.id },
      data: { status: "ARCHIVED" },
    });
    expect(await runProjectRankCheck(deps, run)).toMatchObject({
      projectActive: false,
      checked: 0,
    });
    await prisma.client.updateMany({ where: { agencyId: agency.id }, data: { status: "ACTIVE" } });
    await prisma.project.update({ where: { id: project.id }, data: { deletedAt: new Date() } });
    expect(await runProjectRankCheck(deps, run)).toMatchObject({ projectActive: false });
    expect(await prisma.rankCheck.count({ where: { agencyId: agency.id } })).toBe(0);
  });

  it("does not check another agency's project with this agency's id", async () => {
    const a = await setup();
    const b = await setup();
    await addKeywords(b.owner, b.project.id, { text: "secret keyword" });
    const result = await runProjectRankCheck(
      { db, gateway: makeGateway(new MockSeoProvider()) },
      { projectId: b.project.id, agencyId: a.agency.id, date: DAY, priority: "standard" },
    );
    expect(result.projectActive).toBe(false);
    expect(await prisma.rankCheck.count({ where: { agencyId: b.agency.id } })).toBe(0);
  });
});

describe("rankings table and project summary", () => {
  let ctx: Awaited<ReturnType<typeof setup>>;

  beforeAll(async () => {
    ctx = await setup();
    await addKeywords(ctx.owner, ctx.project.id, { text: words(60, "term"), tags: "group-a" });
    await addKeywords(ctx.owner, ctx.project.id, { text: "brand name\nbrand shop", tags: "brand" });
    await backfillProject(
      db,
      { ...ctx.project, device: "DESKTOP" },
      30,
      new Date("2026-03-10T10:00:00Z"),
    );
    // Added after the history was created, so it has never been checked.
    await addKeywords(ctx.owner, ctx.project.id, { text: "never checked yet" });
  });

  it("pages, searches, filters by tag and bucket, and sorts", async () => {
    const all = await listRankings(ctx.owner, ctx.project.id, { pageSize: 25 });
    expect(all.total).toBe(63);
    expect(all.rows).toHaveLength(25);
    expect(
      (await listRankings(ctx.owner, ctx.project.id, { q: "brand" })).rows.map((r) => r.phrase),
    ).toEqual(["brand name", "brand shop"]);
    expect((await listRankings(ctx.owner, ctx.project.id, { tag: "brand" })).total).toBe(2);
    expect(
      (await listRankings(ctx.owner, ctx.project.id, { bucket: "unchecked" })).rows.map(
        (r) => r.phrase,
      ),
    ).toEqual(["never checked yet"]);

    const byPosition = await listRankings(ctx.owner, ctx.project.id, {
      sort: "position",
      dir: "asc",
      pageSize: 100,
    });
    const positions = byPosition.rows.map((r) => r.currentPosition);
    const ranked = positions.filter((p): p is number => p !== null);
    expect(ranked).toEqual([...ranked].sort((a, b) => a - b));
    // Not ranking and never checked come last.
    expect(positions.slice(0, ranked.length).every((p) => p !== null)).toBe(true);

    const top10 = await listRankings(ctx.owner, ctx.project.id, { bucket: "top10", pageSize: 100 });
    for (const r of top10.rows) expect(r.currentPosition).toBeGreaterThanOrEqual(4);
    for (const r of top10.rows) expect(r.currentPosition).toBeLessThanOrEqual(10);
    const none = await listRankings(ctx.owner, ctx.project.id, { bucket: "none", pageSize: 100 });
    for (const r of none.rows) expect(r.currentPosition).toBeNull();
    for (const r of none.rows) expect(r.lastCheckedOn).not.toBeNull();

    const byChange = await listRankings(ctx.owner, ctx.project.id, {
      sort: "change",
      pageSize: 100,
    });
    const changes = byChange.rows.map((r) => r.changeWeek).filter((c): c is number => c !== null);
    expect(changes).toEqual([...changes].sort((a, b) => b - a));
  });

  it("builds the project summary from the formulas", async () => {
    const summary = await getProjectSummary(ctx.owner, ctx.project.id);
    const kws = await prisma.keyword.findMany({
      where: { projectId: ctx.project.id, lastCheckedOn: { not: null } },
    });
    const positions = kws.map((k) => k.currentPosition);
    expect(summary.totalKeywords).toBe(63);
    expect(summary.checkedKeywords).toBe(62);
    expect(summary.distribution).toEqual(distribution(positions));
    expect(summary.visibility).toBe(visibilityScore(positions));
    expect(summary.rankingKeywords).toBe(positions.filter((p) => p !== null).length);
    expect(summary.lastCheckedOn).toBe("2026-03-10");
    for (const g of summary.topGainers) expect(g.changeWeek).toBeGreaterThan(0);
    for (const l of summary.topLosers) expect(l.changeWeek).toBeLessThan(0);
  });

  it("returns a keyword's history and the latest top 10", async () => {
    const kw = await prisma.keyword.findFirstOrThrow({
      where: { projectId: ctx.project.id, phrase: "term 1" },
    });
    const detail = await getKeywordDetail(ctx.owner, ctx.project.id, kw.id, 365);
    expect(detail.history).toHaveLength(31);
    expect(detail.history[0]!.date < detail.history[30]!.date).toBe(true);
    expect(detail.topResults).toHaveLength(10);
    await expect(getKeywordDetail(ctx.owner, ctx.project.id, "nope")).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const other = await setup();
    await expect(getKeywordDetail(other.owner, ctx.project.id, kw.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("exports with a row limit", async () => {
    const rows = await listRankingsForExport(ctx.owner, ctx.project.id, { tag: "brand" });
    expect(rows).toHaveLength(2);
  });
});

describe("check now", () => {
  beforeEach(async () => {
    await prisma.usageRecord.deleteMany({});
  });

  it("is blocked up front when the live-check limit would be exceeded", async () => {
    const { owner, project, agency } = await setup("STARTER"); // 50 live checks
    await addKeywords(owner, project.id, { text: words(10) });
    await prisma.usageRecord.create({
      data: {
        agencyId: agency.id,
        metric: "LIVE_CHECK",
        quantity: 45,
        costMicros: 0,
        provider: "mock",
        operation: "x",
      },
    });
    await expect(requestCheckNow(owner, project.id)).rejects.toBeInstanceOf(LimitExceededError);
    expect(await getQueue("rank-checks").getJobCounts("waiting")).toMatchObject({ waiting: 0 });
  });

  it("needs keywords, and member or owner role", async () => {
    const { owner, project } = await setup();
    await expect(requestCheckNow(owner, project.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(requestCheckNow({ ...owner, role: "CLIENT" }, project.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("runs in the worker, reports progress, and saves live results", async () => {
    const { owner, project, agency } = await setup();
    await addKeywords(owner, project.id, { text: words(12) });
    const runtime = createWorkerRuntime({
      connection: redisConnectionOptions(process.env.REDIS_URL ?? "redis://localhost:6379"),
      prefix: process.env.QUEUE_PREFIX!,
      concurrency: 1,
      queues: ["rank-checks"],
      processors,
    });
    runtime.start();
    try {
      const { jobId, keywords } = await requestCheckNow(owner, project.id);
      expect(keywords).toBe(12);
      let status = await getCheckNowStatus(owner, jobId);
      for (let i = 0; i < 100 && status.state !== "done" && status.state !== "failed"; i++) {
        await new Promise((r) => setTimeout(r, 100));
        status = await getCheckNowStatus(owner, jobId);
      }
      expect(status).toEqual({ state: "done", progress: 100 });
      expect(await prisma.rankCheck.count({ where: { agencyId: agency.id } })).toBe(12);
      expect(
        await prisma.usageRecord.findFirstOrThrow({
          where: { agencyId: agency.id, metric: "LIVE_CHECK" },
        }),
      ).toMatchObject({ quantity: 12 });
      // Nobody else can look at this job.
      const other = await setup();
      await expect(getCheckNowStatus(other.owner, jobId)).rejects.toBeInstanceOf(NotFoundError);
    } finally {
      await runtime.shutdown();
    }
  });

  it("tells the page about a plan or budget problem found while running", async () => {
    const { owner, project, agency } = await setup("STARTER");
    await addKeywords(owner, project.id, { text: words(10) });
    const runtime = createWorkerRuntime({
      connection: redisConnectionOptions(process.env.REDIS_URL ?? "redis://localhost:6379"),
      prefix: process.env.QUEUE_PREFIX!,
      concurrency: 1,
      queues: ["rank-checks"],
      processors,
    });
    runtime.start();
    try {
      const { jobId } = await requestCheckNow(owner, project.id);
      // The limit is used up by someone else between the request and the run.
      await prisma.usageRecord.create({
        data: {
          agencyId: agency.id,
          metric: "LIVE_CHECK",
          quantity: 50,
          costMicros: 0,
          provider: "mock",
          operation: "x",
        },
      });
      let status = await getCheckNowStatus(owner, jobId);
      for (let i = 0; i < 100 && status.state !== "failed" && status.state !== "done"; i++) {
        await new Promise((r) => setTimeout(r, 100));
        status = await getCheckNowStatus(owner, jobId);
      }
      expect(status.state).toBe("failed");
      expect(status.error).toMatch(/live rank checks/);
      expect(await prisma.rankCheck.count({ where: { agencyId: agency.id } })).toBe(0);
    } finally {
      await runtime.shutdown();
    }
  });
});
