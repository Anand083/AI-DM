import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import type { AuditResult, RankResult } from "@/server/providers/seo/types";
import { pollAudit, runAuditStart, type AuditGateway } from "@/server/services/audit-runner";
import { createAudit } from "@/server/services/audits";
import { runDigestScheduler, sendDigest } from "@/server/services/alert-digest";
import {
  getBellData,
  listAlerts,
  markAlertRead,
  markAllAlertsRead,
} from "@/server/services/alerts";
import { getDashboard } from "@/server/services/dashboard";
import { ForbiddenError, NotFoundError } from "@/server/services/errors";
import { runProjectRankCheck, type RankGateway } from "@/server/services/rank-checks";
import { refreshKeywordSnapshots } from "@/server/services/rank-snapshots";
import { createAgencyWithMembers, seedPlans } from "../factories";
import { createTestClient, resetDb } from "../helpers/db";

const prisma = createTestClient();

/** A gateway that returns exactly the positions we choose. */
function fakeRanks(positions: Record<string, number | null>): RankGateway {
  return {
    async getRankings(_caller, input) {
      const data: RankResult[] = input.keywords.map((keyword) => ({
        keyword,
        position: positions[keyword] ?? null,
        rankingUrl: positions[keyword] ? `https://${input.domain}/${keyword}` : null,
        serpFeatures: [],
        topResults: [],
      }));
      return { data, cached: false, costMicros: 0, provider: "mock" };
    },
  };
}

async function setup(options: { plan?: string; settings?: object } = {}) {
  const { agency, members } = await createAgencyWithMembers(
    prisma,
    ["OWNER", "ADMIN", "MEMBER"],
    undefined,
    options.plan ?? "GROWTH",
  );
  if (options.settings)
    await prisma.agency.update({ where: { id: agency.id }, data: options.settings });
  const client = await prisma.client.create({ data: { agencyId: agency.id, name: "Client" } });
  const project = await prisma.project.create({
    data: {
      agencyId: agency.id,
      clientId: client.id,
      name: "Main site",
      domain: "example.com",
      locationCode: 2840,
      languageCode: "en",
    },
  });
  return {
    agency,
    client,
    project,
    owner: members[0]!.ctx,
    admin: members[1]!.ctx,
    member: members[2]!.ctx,
    users: members.map((m) => m.user),
  };
}

async function addKeywords(s: Awaited<ReturnType<typeof setup>>, phrases: string[]) {
  await prisma.keyword.createMany({
    data: phrases.map((phrase) => ({
      agencyId: s.agency.id,
      projectId: s.project.id,
      phrase,
      tags: [],
    })),
  });
}

/** Saves a check for an earlier day, so the next real run has something to compare with. */
async function previousDay(
  s: Awaited<ReturnType<typeof setup>>,
  date: string,
  positions: Record<string, number | null>,
) {
  const keywords = await prisma.keyword.findMany({ where: { projectId: s.project.id } });
  await prisma.rankCheck.createMany({
    data: keywords.map((k) => ({
      agencyId: s.agency.id,
      keywordId: k.id,
      date: new Date(`${date}T00:00:00Z`),
      position: positions[k.phrase] ?? null,
      provider: "mock",
    })),
  });
  await refreshKeywordSnapshots(
    db,
    s.agency.id,
    keywords.map((k) => k.id),
  );
}

const run = (
  s: Awaited<ReturnType<typeof setup>>,
  date: string,
  positions: Record<string, number | null>,
  priority: "standard" | "live" = "standard",
) =>
  runProjectRankCheck(
    { db, gateway: fakeRanks(positions) },
    { projectId: s.project.id, agencyId: s.agency.id, date, priority },
  );

const alertsOf = (s: Awaited<ReturnType<typeof setup>>, type?: string) =>
  prisma.alert.findMany({
    where: { agencyId: s.agency.id, ...(type ? { type: type as never } : {}) },
    orderBy: { createdAt: "asc" },
  });

beforeAll(async () => {
  await resetDb(prisma);
  await seedPlans(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("rank alerts", () => {
  it("a forced rank drop creates exactly one alert, even when the job runs twice", async () => {
    const s = await setup();
    await addKeywords(s, ["steady", "dropper", "far away"]);
    await previousDay(s, "2026-03-09", { steady: 4, dropper: 6, "far away": 40 });
    await run(s, "2026-03-10", { steady: 4, dropper: 19, "far away": 70 });
    await run(s, "2026-03-10", { steady: 4, dropper: 19, "far away": 70 });
    const alerts = await alertsOf(s);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      type: "RANK_DROP",
      severity: "CRITICAL",
      projectId: s.project.id,
      title: "1 keyword dropped for Main site",
      body: "dropper: 6 to 19.",
      dedupeKey: `rank_drop:${s.project.id}:2026-03-10`,
      readAt: null,
    });
    expect(alerts[0]!.data).toMatchObject({
      total: 1,
      keywords: [expect.objectContaining({ phrase: "dropper", from: 6, to: 19 })],
    });
  });

  it("makes one summary alert for many drops, and a separate one for keywords that reached the top 10", async () => {
    const s = await setup();
    const names = Array.from({ length: 8 }, (_, i) => `drop ${i}`);
    await addKeywords(s, [...names, "riser"]);
    await previousDay(s, "2026-03-09", {
      ...Object.fromEntries(names.map((n) => [n, 8])),
      riser: 35,
    });
    await run(s, "2026-03-10", { ...Object.fromEntries(names.map((n) => [n, 20])), riser: 7 });
    const alerts = await alertsOf(s);
    expect(alerts.map((a) => a.type)).toEqual(expect.arrayContaining(["RANK_DROP", "RANK_GAIN"]));
    expect(alerts).toHaveLength(2);
    const drop = alerts.find((a) => a.type === "RANK_DROP")!;
    expect(drop.title).toBe("8 keywords dropped for Main site");
    expect(drop.body.endsWith("and 3 more.")).toBe(true);
    const gain = alerts.find((a) => a.type === "RANK_GAIN")!;
    expect(gain).toMatchObject({
      severity: "INFO",
      title: "1 keyword reached the top 10 for Main site",
      body: "riser: 35 to 7.",
    });
  });

  it("does not alert for first checks, small moves, keywords outside the top 20, or same-day re-checks", async () => {
    const s = await setup();
    await addKeywords(s, ["new", "small", "deep", "twice"]);
    await run(s, "2026-03-10", { new: 3, small: 5, deep: 30, twice: 5 });
    expect(await alertsOf(s)).toHaveLength(0); // first ever check
    await run(s, "2026-03-11", { new: 3, small: 8, deep: 90, twice: 5 });
    expect(await alertsOf(s)).toHaveLength(0); // 3 places is small; 30 was not in the top 20
    await run(s, "2026-03-11", { new: 3, small: 8, deep: 90, twice: 30 }, "live");
    expect(await alertsOf(s)).toHaveLength(0); // a live re-check of the same day is not compared again
  });

  it("uses the agency's own thresholds", async () => {
    const s = await setup({
      settings: { alertDropPositions: 2, alertDropWithin: 10, alertTopPosition: 3 },
    });
    await addKeywords(s, ["a", "b", "c", "d"]);
    await previousDay(s, "2026-03-09", { a: 5, b: 15, c: 4, d: 9 });
    await run(s, "2026-03-10", { a: 7, b: 30, c: 2, d: 5 });
    const alerts = await alertsOf(s);
    const drop = alerts.find((a) => a.type === "RANK_DROP")!;
    expect(drop.title).toBe("1 keyword dropped for Main site"); // a: 5 to 7 counts; b was outside the top 10
    expect(drop.severity).toBe("WARNING");
    const gain = alerts.find((a) => a.type === "RANK_GAIN")!;
    expect(gain.body).toBe("c: 4 to 2."); // d moved to 5, which is not in the top 3
  });

  it("falling out of the top 100 is a drop", async () => {
    const s = await setup();
    await addKeywords(s, ["lost"]);
    await previousDay(s, "2026-03-09", { lost: 12 });
    await run(s, "2026-03-10", { lost: null });
    expect((await alertsOf(s, "RANK_DROP"))[0]!.body).toBe("lost: 12 to 100+.");
  });
});

describe("audit alerts", () => {
  const issues = (n: number, prefix = "page") =>
    Array.from({ length: n }, (_, i) => ({
      code: "broken_link_4xx",
      severity: "CRITICAL" as const,
      url: `https://example.com/${prefix}${i}`,
    }));

  function auditGateway(result: AuditResult): AuditGateway {
    return {
      startAudit: async () => ({ taskId: "t" }),
      getAuditStatus: async () => ({ status: "completed", progress: 100 }),
      getAuditResult: async () => ({
        data: result,
        cached: false,
        costMicros: 0,
        provider: "mock",
      }),
    };
  }

  async function finish(s: Awaited<ReturnType<typeof setup>>, result: AuditResult) {
    const audit = await createAudit(s.owner, s.project.id, null, async () => {});
    const deps = { db, gateway: auditGateway(result), enqueuePoll: async () => {} };
    await runAuditStart(deps, { auditId: audit.id, agencyId: s.agency.id });
    await pollAudit(deps, { auditId: audit.id, agencyId: s.agency.id, attempt: 1 });
    return audit.id;
  }
  const result = (list: AuditResult["issues"]): AuditResult => ({
    pagesCrawled: 20,
    pages: Array.from({ length: 20 }, (_, i) => ({
      url: `https://example.com/p${i}`,
      statusCode: 200,
      title: "t",
      loadTimeMs: 100,
      wordCount: 300,
      issueCount: 0,
    })),
    issues: list,
  });

  it("alerts for critical issues in the first audit, then only for new ones", async () => {
    const s = await setup();
    const first = await finish(s, result(issues(3)));
    let alerts = await alertsOf(s, "AUDIT_CRITICAL");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      severity: "CRITICAL",
      title: "3 critical issues found on Main site",
      dedupeKey: `audit_critical:${first}`,
    });
    expect(alerts[0]!.body).toMatch(/first site audit/);
    expect(alerts[0]!.data).toMatchObject({ auditId: first, newCritical: 3 });

    await finish(s, result(issues(3))); // nothing new
    expect(await alertsOf(s, "AUDIT_CRITICAL")).toHaveLength(1);

    const third = await finish(s, result([...issues(3), ...issues(1, "extra")]));
    alerts = await alertsOf(s, "AUDIT_CRITICAL");
    expect(alerts).toHaveLength(2);
    expect(alerts[1]).toMatchObject({
      title: "1 critical issue found on Main site",
      dedupeKey: `audit_critical:${third}`,
    });
  });

  it("does not alert for warnings, or when the setting is off", async () => {
    const s = await setup();
    await finish(
      s,
      result([{ code: "slow_page", severity: "WARNING", url: "https://example.com/" }]),
    );
    expect(await alertsOf(s)).toHaveLength(0);
    const off = await setup({ settings: { alertOnCriticalAudit: false } });
    await finish(off, result(issues(5)));
    expect(await alertsOf(off)).toHaveLength(0);
  });
});

describe("alerts service", () => {
  it("lists newest first, filters unread, counts for the bell and marks read", async () => {
    const s = await setup();
    await prisma.alert.createMany({
      data: [1, 2, 3].map((n) => ({
        agencyId: s.agency.id,
        projectId: s.project.id,
        type: "RANK_DROP" as const,
        severity: "WARNING" as const,
        title: `Alert ${n}`,
        body: "body",
        dedupeKey: `k${n}`,
        createdAt: new Date(Date.UTC(2026, 2, n)),
      })),
    });
    expect((await listAlerts(s.member)).rows.map((a) => a.title)).toEqual([
      "Alert 3",
      "Alert 2",
      "Alert 1",
    ]);
    expect(await getBellData(s.member)).toMatchObject({ unread: 3 });
    const first = (await listAlerts(s.member)).rows[0]!;
    await markAlertRead(s.member, first.id);
    await markAlertRead(s.member, first.id); // reading twice is fine
    expect((await getBellData(s.member)).unread).toBe(2);
    expect((await listAlerts(s.member, { unreadOnly: true })).rows.map((a) => a.title)).toEqual([
      "Alert 2",
      "Alert 1",
    ]);
    expect((await listAlerts(s.member, { page: 2, pageSize: 2 })).rows).toHaveLength(1);
    expect(await markAllAlertsRead(s.member)).toBe(2);
    expect((await getBellData(s.member)).unread).toBe(0);
  });

  it("is isolated per agency and closed to client users", async () => {
    const a = await setup();
    const b = await setup();
    const alert = await prisma.alert.create({
      data: {
        agencyId: a.agency.id,
        type: "RANK_GAIN",
        severity: "INFO",
        title: "Secret",
        body: "x",
        dedupeKey: "secret",
      },
    });
    await expect(markAlertRead(b.owner, alert.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listAlerts(b.owner)).total).toBe(0);
    expect(await markAllAlertsRead(b.owner)).toBe(0);
    expect((await prisma.alert.findUniqueOrThrow({ where: { id: alert.id } })).readAt).toBeNull();
    await expect(listAlerts({ ...a.owner, role: "CLIENT" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getBellData({ ...a.owner, role: "CLIENT" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("daily digest", () => {
  const at = (iso: string) => new Date(iso);

  it("is due from 8 o'clock agency time, once a day, and only when switched on", async () => {
    const on = await setup({ settings: { dailyDigest: true, timezone: "Asia/Kolkata" } });
    const off = await setup();
    void off;
    const queued: string[] = [];
    const enqueue = async (j: { agencyId: string; date: string }) => (
      queued.push(`${j.agencyId}:${j.date}`),
      true
    );
    // 02:00 UTC = 07:30 in Kolkata: too early.
    await runDigestScheduler({ db: prisma, now: at("2026-03-10T02:00:00Z"), enqueue });
    expect(queued.filter((q) => q.startsWith(on.agency.id))).toEqual([]);
    // 03:00 UTC = 08:30 in Kolkata.
    await runDigestScheduler({ db: prisma, now: at("2026-03-10T03:00:00Z"), enqueue });
    expect(queued.filter((q) => q.includes(on.agency.id))).toEqual([`${on.agency.id}:2026-03-10`]);
    expect(queued.some((q) => q.startsWith(off.agency.id))).toBe(false);

    await prisma.agency.update({
      where: { id: on.agency.id },
      data: { lastDigestOn: new Date("2026-03-10T00:00:00Z") },
    });
    queued.length = 0;
    await runDigestScheduler({ db: prisma, now: at("2026-03-10T09:00:00Z"), enqueue });
    expect(queued.filter((q) => q.includes(on.agency.id))).toEqual([]);
    await runDigestScheduler({ db: prisma, now: at("2026-03-11T03:00:00Z"), enqueue });
    expect(queued.filter((q) => q.includes(on.agency.id))).toEqual([`${on.agency.id}:2026-03-11`]);
  });

  it("emails new alerts to owners and admins only, marks them emailed, and does not repeat", async () => {
    const s = await setup({ settings: { dailyDigest: true } });
    const now = at("2026-03-10T09:00:00Z");
    await prisma.alert.createMany({
      data: [
        {
          agencyId: s.agency.id,
          type: "RANK_DROP",
          severity: "WARNING",
          title: "Drop <b>one</b>",
          body: "a & b",
          dedupeKey: "d1",
          createdAt: at("2026-03-10T05:00:00Z"),
        },
        {
          agencyId: s.agency.id,
          type: "RANK_GAIN",
          severity: "INFO",
          title: "Gain",
          body: "c",
          dedupeKey: "d2",
          createdAt: at("2026-03-10T06:00:00Z"),
        },
        {
          agencyId: s.agency.id,
          type: "RANK_GAIN",
          severity: "INFO",
          title: "Old",
          body: "d",
          dedupeKey: "d3",
          createdAt: at("2026-03-08T06:00:00Z"),
        },
        {
          agencyId: s.agency.id,
          type: "RANK_GAIN",
          severity: "INFO",
          title: "Already sent",
          body: "e",
          dedupeKey: "d4",
          createdAt: at("2026-03-10T04:00:00Z"),
          emailedAt: at("2026-03-10T05:00:00Z"),
        },
      ],
    });
    const sent: { to: string; subject: string; text: string; html: string }[] = [];
    const deps = {
      db: prisma,
      agencyId: s.agency.id,
      date: "2026-03-10",
      now,
      appUrl: "https://app.test",
      send: async (e: (typeof sent)[number]) => void sent.push(e),
    };
    const result = await sendDigest(deps);
    expect(result).toEqual({ sent: 2, alerts: 2 });
    expect(sent.map((e) => e.to).sort()).toEqual([s.users[0]!.email, s.users[1]!.email].sort()); // owner and admin, not the member
    expect(sent[0]!.subject).toBe(
      `${(await prisma.agency.findUniqueOrThrow({ where: { id: s.agency.id } })).name}: 2 new alerts`,
    );
    expect(sent[0]!.text).toContain("Drop <b>one</b>");
    expect(sent[0]!.html).toContain("Drop &lt;b&gt;one&lt;/b&gt;"); // HTML is escaped
    expect(sent[0]!.html).toContain("https://app.test/app/");
    expect(
      (await prisma.agency.findUniqueOrThrow({ where: { id: s.agency.id } })).lastDigestOn
        ?.toISOString()
        .slice(0, 10),
    ).toBe("2026-03-10");
    expect(await prisma.alert.count({ where: { agencyId: s.agency.id, emailedAt: null } })).toBe(1); // the old one is never sent

    sent.length = 0;
    expect(await sendDigest(deps)).toEqual({ sent: 0, alerts: 0 });
    expect(sent).toHaveLength(0);
  });

  it("sends nothing when there are no new alerts, but still counts the day as done", async () => {
    const s = await setup({ settings: { dailyDigest: true } });
    const sent: unknown[] = [];
    const result = await sendDigest({
      db: prisma,
      agencyId: s.agency.id,
      date: "2026-03-12",
      now: at("2026-03-12T09:00:00Z"),
      appUrl: "https://app.test",
      send: async (e) => void sent.push(e),
    });
    expect(result).toEqual({ sent: 0, alerts: 0 });
    expect(
      (await prisma.agency.findUniqueOrThrow({ where: { id: s.agency.id } })).lastDigestOn,
    ).not.toBeNull();
  });

  it("does nothing if the digest was switched off in the meantime", async () => {
    const s = await setup();
    const result = await sendDigest({
      db: prisma,
      agencyId: s.agency.id,
      date: "2026-03-12",
      now: new Date(),
      appUrl: "https://app.test",
      send: async () => {},
    });
    expect(result).toEqual({ sent: 0, alerts: 0 });
  });
});

describe("dashboard", () => {
  it("shows each client's average position, weekly change, audit score and unread alerts", async () => {
    const s = await setup();
    const second = await prisma.project.create({
      data: {
        agencyId: s.agency.id,
        clientId: s.client.id,
        name: "Second",
        domain: "second.com",
        locationCode: 2840,
        languageCode: "en",
      },
    });
    const otherClient = await prisma.client.create({
      data: { agencyId: s.agency.id, name: "Zed Co" },
    });
    await addKeywords(s, ["k1", "k2", "k3"]);
    await prisma.keyword.createMany({
      data: [{ agencyId: s.agency.id, projectId: second.id, phrase: "s1", tags: [] }],
    });
    await previousDay(s, "2026-03-03", { k1: 10, k2: 20, k3: null });
    await run(s, "2026-03-10", { k1: 4, k2: 22 });
    await prisma.audit.createMany({
      data: [
        {
          agencyId: s.agency.id,
          projectId: s.project.id,
          maxPages: 10,
          status: "COMPLETED",
          healthScore: 90,
          createdAt: new Date("2026-01-01"),
        },
        {
          agencyId: s.agency.id,
          projectId: s.project.id,
          maxPages: 10,
          status: "COMPLETED",
          healthScore: 70,
          createdAt: new Date("2026-02-01"),
        },
        {
          agencyId: s.agency.id,
          projectId: second.id,
          maxPages: 10,
          status: "COMPLETED",
          healthScore: 50,
          createdAt: new Date("2026-02-01"),
        },
      ],
    });
    await prisma.alert.create({
      data: {
        agencyId: s.agency.id,
        projectId: s.project.id,
        type: "RANK_DROP",
        severity: "WARNING",
        title: "t",
        body: "b",
        dedupeKey: "x1",
      },
    });

    const dash = await getDashboard(s.owner);
    expect(dash).toMatchObject({
      clientTotal: 2,
      projectTotal: 2,
      keywordTotal: 4,
      unreadTotal: 1,
    });
    const row = dash.rows.find((r) => r.id === s.client.id)!;
    expect(row).toMatchObject({ projects: 2, keywords: 4, unreadAlerts: 1 });
    expect(row.averagePosition).toBe(13); // (4 + 22) / 2 ranking keywords
    expect(row.weeklyChange).toBe(1.3); // (k1 +6, k2 -2, k3 0) over 3 checked keywords
    expect(row.auditScore).toBe(60); // latest audits 70 and 50
    expect(dash.rows.find((r) => r.id === otherClient.id)).toMatchObject({
      projects: 0,
      keywords: 0,
      averagePosition: null,
      weeklyChange: null,
      auditScore: null,
      unreadAlerts: 0,
    });
    expect(dash.rows.map((r) => r.name)).toEqual(["Client", "Zed Co"]);
  });

  it("shows usage to owners and admins only, and is isolated and paged", async () => {
    const a = await setup();
    const b = await setup();
    await prisma.usageRecord.create({
      data: {
        agencyId: a.agency.id,
        metric: "KEYWORD_RESEARCH",
        quantity: 90,
        costMicros: 0,
        provider: "mock",
        operation: "x",
      },
    });
    const owner = await getDashboard(a.owner);
    expect(owner.usage?.lines.find((l) => l.key === "KEYWORD_RESEARCH")).toMatchObject({
      used: 90,
      percent: 18,
    });
    expect((await getDashboard(a.admin)).usage).not.toBeNull();
    expect((await getDashboard(a.member)).usage).toBeNull();
    expect(
      (await getDashboard(b.owner)).usage?.lines.find((l) => l.key === "KEYWORD_RESEARCH"),
    ).toBeUndefined();

    for (let i = 0; i < 3; i++)
      await prisma.client.create({ data: { agencyId: a.agency.id, name: `Extra ${i}` } });
    const page2 = await getDashboard(a.owner, { page: 2, pageSize: 2 });
    expect(page2.rows).toHaveLength(2);
    expect(page2.clientTotal).toBe(4);
    await expect(getDashboard({ ...a.owner, role: "CLIENT" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
