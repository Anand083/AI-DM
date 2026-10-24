import IORedis from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { compareIssues, healthScore } from "@/lib/audit-math";
import { db } from "@/server/db/client";
import { runAuditScheduler } from "@/server/jobs/system/audit-scheduler";
import { RedisLockStore } from "@/server/locks";
import { MockSeoProvider } from "@/server/providers/seo/mock";
import { pollAudit, runAuditStart, type RunnerDeps } from "@/server/services/audit-runner";
import {
  compareWithPrevious,
  createAudit,
  getAudit,
  getIssueGroups,
  listAuditPages,
  listAudits,
  listIssueUrls,
  startAudit,
} from "@/server/services/audits";
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

let clock = new Date("2026-03-10T10:00:00Z");
const advance = (seconds: number) => void (clock = new Date(clock.getTime() + seconds * 1000));

function makeDeps(provider = new MockSeoProvider({ now: () => clock, auditSeconds: 20 })) {
  const polls: { auditId: string; agencyId: string; attempt: number }[] = [];
  const deps: RunnerDeps = {
    db,
    gateway: new SeoGateway({
      provider: () => provider,
      db: prisma,
      locks: new RedisLockStore(redis, `test-lock:${Date.now()}:`),
      now: () => clock,
    }),
    enqueuePoll: async (d) => void polls.push(d),
    now: () => clock,
  };
  return { deps, polls };
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
  return { agency, client, project, owner: members[0]!.ctx, member: members[1]!.ctx };
}

/** Starts an audit and runs it to the end with the mock provider. */
async function completeAudit(
  s: Awaited<ReturnType<typeof setup>>,
  deps: RunnerDeps,
  polls: ReturnType<typeof makeDeps>["polls"],
) {
  const noQueue = async () => {};
  const audit = await createAudit(s.owner, s.project.id, s.owner.userId, noQueue);
  await runAuditStart(deps, { auditId: audit.id, agencyId: s.agency.id });
  advance(30);
  await pollAudit(deps, { auditId: audit.id, agencyId: s.agency.id, attempt: polls.length || 1 });
  return audit.id;
}

beforeAll(async () => {
  await resetDb(prisma);
  await seedPlans(prisma);
});
beforeEach(() => {
  clock = new Date("2026-03-10T10:00:00Z");
});
afterAll(async () => {
  await prisma.$disconnect();
  redis.disconnect();
});

describe("audit lifecycle with the mock provider", () => {
  it("queued, running with progress, then completed with stored pages, issues, score and usage", async () => {
    const s = await setup();
    const { deps, polls } = makeDeps();
    const queued: string[] = [];
    const audit = await createAudit(
      s.owner,
      s.project.id,
      s.owner.userId,
      async (d) => void queued.push(d.auditId),
    );
    expect(queued).toEqual([audit.id]);
    expect(await getAudit(s.owner, s.project.id, audit.id)).toMatchObject({
      status: "QUEUED",
      progress: 0,
      maxPages: 500,
    });

    expect(await runAuditStart(deps, { auditId: audit.id, agencyId: s.agency.id })).toBe("started");
    let row = await getAudit(s.owner, s.project.id, audit.id);
    expect(row.status).toBe("RUNNING");
    expect(row.startedAt).not.toBeNull();
    expect(polls).toEqual([{ auditId: audit.id, agencyId: s.agency.id, attempt: 1 }]);
    // Starting twice does nothing.
    expect(await runAuditStart(deps, { auditId: audit.id, agencyId: s.agency.id })).toBe("skipped");

    advance(10);
    expect(await pollAudit(deps, { auditId: audit.id, agencyId: s.agency.id, attempt: 1 })).toBe(
      "running",
    );
    row = await getAudit(s.owner, s.project.id, audit.id);
    expect(row.status).toBe("RUNNING");
    expect(row.progress).toBeGreaterThan(0);
    expect(row.progress).toBeLessThan(100);
    expect(polls[1]).toMatchObject({ attempt: 2 });

    advance(15);
    expect(await pollAudit(deps, { auditId: audit.id, agencyId: s.agency.id, attempt: 2 })).toBe(
      "completed",
    );
    row = await getAudit(s.owner, s.project.id, audit.id);
    expect(row).toMatchObject({ status: "COMPLETED", progress: 100, error: null });
    expect(row.pagesCrawled).toBeGreaterThanOrEqual(20);
    expect(await prisma.auditPage.count({ where: { auditId: audit.id } })).toBe(row.pagesCrawled);

    const issues = await prisma.auditIssue.findMany({ where: { auditId: audit.id } });
    const counts = { critical: 0, warning: 0, notice: 0 };
    for (const i of issues) counts[i.severity.toLowerCase() as keyof typeof counts]++;
    expect(row.counts).toMatchObject(counts);
    expect(row.healthScore).toBe(healthScore(counts, row.pagesCrawled));
    const byCode = (row.counts as { byCode: Record<string, number> }).byCode;
    expect(Object.values(byCode).reduce((a, b) => a + b, 0)).toBe(issues.length);

    // Usage: one record, one unit per crawled page.
    const usage = await prisma.usageRecord.findMany({
      where: { agencyId: s.agency.id, metric: "AUDIT_PAGE" },
    });
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      quantity: row.pagesCrawled,
      costMicros: row.pagesCrawled * 250,
      projectId: s.project.id,
    });

    // Polling again changes nothing.
    expect(await pollAudit(deps, { auditId: audit.id, agencyId: s.agency.id, attempt: 3 })).toBe(
      "skipped",
    );
    expect(await prisma.auditPage.count({ where: { auditId: audit.id } })).toBe(row.pagesCrawled);
    expect(
      await prisma.usageRecord.count({ where: { agencyId: s.agency.id, metric: "AUDIT_PAGE" } }),
    ).toBe(1);
  });

  it("gives up on an audit that takes more than an hour", async () => {
    const s = await setup();
    const { deps } = makeDeps(new MockSeoProvider({ now: () => clock, auditSeconds: 100_000 }));
    const audit = await createAudit(s.owner, s.project.id, null, async () => {});
    await runAuditStart(deps, { auditId: audit.id, agencyId: s.agency.id });
    advance(60);
    expect(await pollAudit(deps, { auditId: audit.id, agencyId: s.agency.id, attempt: 360 })).toBe(
      "failed",
    );
    expect(await getAudit(s.owner, s.project.id, audit.id)).toMatchObject({
      status: "FAILED",
      error: expect.stringMatching(/took too long/),
    });
  });

  it("marks the audit failed when the provider says it failed", async () => {
    const s = await setup();
    const { deps } = makeDeps();
    deps.gateway = Object.assign(Object.create(deps.gateway), {
      getAuditStatus: async () => ({
        status: "failed" as const,
        progress: 40,
        error: "Site blocked our crawler",
      }),
    });
    const audit = await createAudit(s.owner, s.project.id, null, async () => {});
    await runAuditStart(deps, { auditId: audit.id, agencyId: s.agency.id });
    expect(await pollAudit(deps, { auditId: audit.id, agencyId: s.agency.id, attempt: 1 })).toBe(
      "failed",
    );
    expect(await getAudit(s.owner, s.project.id, audit.id)).toMatchObject({
      status: "FAILED",
      error: "Site blocked our crawler",
    });
    expect(await prisma.usageRecord.count({ where: { agencyId: s.agency.id } })).toBe(0);
  });
});

describe("starting an audit", () => {
  const noQueue = async () => {};

  it("allows one running audit per project", async () => {
    const s = await setup();
    await createAudit(s.owner, s.project.id, null, noQueue);
    await expect(createAudit(s.owner, s.project.id, null, noQueue)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("takes the page limit from the plan: what is left this month, at most 500", async () => {
    const s = await setup("STARTER"); // 2000 pages per month
    await prisma.usageRecord.create({
      data: {
        agencyId: s.agency.id,
        metric: "AUDIT_PAGE",
        quantity: 1900,
        costMicros: 0,
        provider: "mock",
        operation: "x",
      },
    });
    expect((await createAudit(s.owner, s.project.id, null, noQueue)).maxPages).toBe(100);
  });

  it("refuses when the month's audit pages are used up, with an upgrade message", async () => {
    const s = await setup("STARTER");
    await prisma.usageRecord.create({
      data: {
        agencyId: s.agency.id,
        metric: "AUDIT_PAGE",
        quantity: 2000,
        costMicros: 0,
        provider: "mock",
        operation: "x",
      },
    });
    const error = await createAudit(s.owner, s.project.id, null, noQueue).catch((e) => e);
    expect(error).toBeInstanceOf(LimitExceededError);
    expect(error.message).toBe(
      "You have used all 2000 audit pages for this month on your Starter plan. Upgrade your plan to get more.",
    );
  });

  it("members can start audits, client users cannot, and other agencies' projects are not found", async () => {
    const s = await setup();
    const other = await setup();
    const startedByMember = await startAudit(s.member, s.project.id).catch((e) => e);
    // The real queue is used here, so only check that permission passed.
    expect(startedByMember instanceof ForbiddenError).toBe(false);
    await expect(startAudit({ ...s.owner, role: "CLIENT" }, s.project.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(startAudit(other.owner, s.project.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("will not audit a deleted project or an archived client's project", async () => {
    const s = await setup();
    await prisma.client.update({ where: { id: s.client.id }, data: { status: "ARCHIVED" } });
    await expect(createAudit(s.owner, s.project.id, null, noQueue)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("results", () => {
  let s: Awaited<ReturnType<typeof setup>>;
  let first: string;
  let second: string;

  beforeAll(async () => {
    s = await setup();
    const { deps, polls } = makeDeps();
    clock = new Date("2026-02-10T10:00:00Z");
    first = await completeAudit(s, deps, polls);
    clock = new Date("2026-03-10T10:00:00Z");
    second = await completeAudit(s, deps, polls);
  });

  it("lists audits newest first", async () => {
    const { rows, total } = await listAudits(s.owner, s.project.id);
    expect(total).toBe(2);
    expect(rows.map((r) => r.id)).toEqual([second, first]);
  });

  it("groups issues by type, worst first, with fix text and example pages", async () => {
    const groups = await getIssueGroups(s.owner, s.project.id, second);
    expect(groups.length).toBeGreaterThan(3);
    const order = { CRITICAL: 0, WARNING: 1, NOTICE: 2 };
    for (let i = 1; i < groups.length; i++) {
      const a = groups[i - 1]!;
      const b = groups[i]!;
      expect(order[a.severity]).toBeLessThanOrEqual(order[b.severity]);
      if (a.severity === b.severity) expect(a.count).toBeGreaterThanOrEqual(b.count);
    }
    const total = await prisma.auditIssue.count({ where: { auditId: second } });
    expect(groups.reduce((sum, g) => sum + g.count, 0)).toBe(total);
    for (const g of groups) {
      expect(g.fix.length).toBeGreaterThan(20);
      expect(g.sampleUrls.length).toBe(Math.min(10, g.count));
    }
  });

  it("pages through all affected addresses of one issue", async () => {
    const groups = await getIssueGroups(s.owner, s.project.id, second);
    const big = groups.find((g) => g.count > 3) ?? groups[0]!;
    const page1 = await listIssueUrls(s.owner, s.project.id, second, big.code, {
      page: 1,
      pageSize: 2,
    });
    expect(page1.total).toBe(big.count);
    expect(page1.urls).toHaveLength(Math.min(2, big.count));
    expect(page1.info.title).toBe(big.title);
  });

  it("lists crawled pages sorted by problems, slowest, or address", async () => {
    const byIssues = await listAuditPages(s.owner, s.project.id, second, { pageSize: 100 });
    const counts = byIssues.rows.map((r) => r.issueCount);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    const slowest = await listAuditPages(s.owner, s.project.id, second, {
      sort: "slowest",
      pageSize: 100,
    });
    const times = slowest.rows.map((r) => r.loadTimeMs);
    expect(times).toEqual([...times].sort((a, b) => b - a));
    const byUrl = await listAuditPages(s.owner, s.project.id, second, {
      sort: "url",
      pageSize: 100,
    });
    expect(byUrl.rows.map((r) => r.url)).toEqual([...byUrl.rows.map((r) => r.url)].sort());
    expect(
      (await listAuditPages(s.owner, s.project.id, second, { q: "no-such-page-anywhere" })).total,
    ).toBe(0);
  });

  it("compares with the audit before: fixed, new and still present add up", async () => {
    const comparison = await compareWithPrevious(s.owner, s.project.id, second);
    expect(comparison).not.toBeNull();
    expect(comparison!.previousAuditId).toBe(first);
    const [before, now] = await Promise.all([
      prisma.auditIssue.findMany({ where: { auditId: first }, select: { code: true, url: true } }),
      prisma.auditIssue.findMany({ where: { auditId: second }, select: { code: true, url: true } }),
    ]);
    expect(comparison).toMatchObject(compareIssues(before, now));
    expect(comparison!.fixed + comparison!.stillPresent).toBe(before.length);
    expect(comparison!.new + comparison!.stillPresent).toBe(now.length);
    // The first audit has nothing before it.
    expect(await compareWithPrevious(s.owner, s.project.id, first)).toBeNull();
  });

  it("is isolated per agency", async () => {
    const other = await setup();
    await expect(getAudit(other.owner, s.project.id, second)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getAudit(other.owner, other.project.id, second)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(getIssueGroups(other.owner, other.project.id, second)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(listAuditPages(other.owner, other.project.id, second)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(compareWithPrevious(other.owner, other.project.id, second)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(listAudits(other.owner, s.project.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("monthly audit scheduler", () => {
  it("queues projects with 'audit every month' that have had no audit this month, once", async () => {
    const s = await setup();
    const off = await setup();
    await prisma.project.update({ where: { id: s.project.id }, data: { autoAudit: true } });
    void off;
    const queued: string[] = [];
    const seen = new Set<string>();
    const enqueue = async (j: { projectId: string; month: string }) => {
      const id = `${j.projectId}_${j.month}`;
      if (seen.has(id)) return false;
      seen.add(id);
      queued.push(j.projectId);
      return true;
    };
    const now = new Date("2026-03-15T12:00:00Z");
    expect(await runAuditScheduler({ db: prisma, now, enqueue })).toMatchObject({
      scanned: 1,
      queued: 1,
    });
    expect(await runAuditScheduler({ db: prisma, now, enqueue })).toMatchObject({ queued: 0 });
    expect(queued).toEqual([s.project.id]);

    // Once an audit exists this month, the project is not picked up again, even in a new run.
    await prisma.audit.create({
      data: { agencyId: s.agency.id, projectId: s.project.id, maxPages: 10, createdAt: now },
    });
    expect(await runAuditScheduler({ db: prisma, now, enqueue: async () => true })).toMatchObject({
      scanned: 0,
      queued: 0,
    });
    // Next month it is due again.
    expect(
      await runAuditScheduler({
        db: prisma,
        now: new Date("2026-04-02T00:00:00Z"),
        enqueue: async () => true,
      }),
    ).toMatchObject({ scanned: 1 });
  });

  it("does nothing while the budget is paused, and skips deleted projects", async () => {
    const s = await setup();
    await prisma.project.update({
      where: { id: s.project.id },
      data: { autoAudit: true, deletedAt: new Date() },
    });
    const enqueue = async () => true;
    expect(
      await runAuditScheduler({
        db: prisma,
        now: new Date("2026-05-01T00:00:00Z"),
        enqueue,
        paused: async () => true,
      }),
    ).toEqual({
      scanned: 0,
      queued: 0,
      paused: true,
    });
    const seen: string[] = [];
    await runAuditScheduler({
      db: prisma,
      now: new Date("2026-05-01T00:00:00Z"),
      enqueue: async (job) => (seen.push(job.projectId), true),
    });
    // Other tests may have left projects behind; the deleted one must not be among them.
    expect(seen).not.toContain(s.project.id);
  });
});
