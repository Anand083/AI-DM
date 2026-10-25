import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { MockSeoProvider } from "@/server/providers/seo/mock";
import {
  AppError,
  ForbiddenError,
  LimitExceededError,
  NotFoundError,
  ValidationError,
} from "@/server/services/errors";
import {
  bulkEditKeywords,
  getKeywordInsights,
  getRankingExplanation,
  importKeywordsCsv,
  requestKeywordMetrics,
} from "@/server/services/keyword-insights";
import {
  runKeywordMetrics,
  type KeywordMetricsGateway,
} from "@/server/services/keyword-metrics-runner";
import { createAgencyWithMembers, seedPlans } from "../factories";
import { createTestClient, resetDb } from "../helpers/db";

const prisma = createTestClient();
beforeAll(async () => {
  await resetDb(prisma);
  await seedPlans(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
});

const day = (v: string) => new Date(`${v}T00:00:00Z`);

async function setup(name?: string, plan = "GROWTH") {
  const { agency, members } = await createAgencyWithMembers(
    prisma,
    ["OWNER", "MEMBER"],
    name,
    plan,
  );
  const client = await prisma.client.create({ data: { agencyId: agency.id, name: "Acme Dental" } });
  const project = await prisma.project.create({
    data: {
      agencyId: agency.id,
      clientId: client.id,
      name: "Site",
      domain: "acmedental.com",
      locationCode: 2840,
      languageCode: "en",
    },
  });
  return { agency, project, owner: members[0]!.ctx, member: members[1]!.ctx };
}
type S = Awaited<ReturnType<typeof setup>>;

const kw = (s: S, phrase: string, extra: Record<string, unknown> = {}) =>
  prisma.keyword.create({
    data: { agencyId: s.agency.id, projectId: s.project.id, phrase, ...extra },
  });

function gatewayOf(mock = new MockSeoProvider()): KeywordMetricsGateway & { calls: string[] } {
  const calls: string[] = [];
  const wrap = <T>(data: T) => ({ data, provider: "mock", cached: false, costMicros: 0 });
  return {
    calls,
    getKeywordMetrics: async (_c, i) => {
      calls.push(`metrics:${i.keywords.length}`);
      return wrap((await mock.getKeywordMetrics(i)).data);
    },
    getBingRankings: async (_c, i) => {
      calls.push(`bing:${i.keywords.length}`);
      return wrap((await mock.getBingRankings(i)).data);
    },
  };
}

describe("keyword metrics refresh", () => {
  it("saves volume, difficulty, trend and Bing position in batches of 100", async () => {
    const s = await setup();
    await prisma.keyword.createMany({
      data: Array.from({ length: 130 }, (_, i) => ({
        agencyId: s.agency.id,
        projectId: s.project.id,
        phrase: `keyword number ${String(i).padStart(3, "0")}`,
      })),
    });
    const gateway = gatewayOf();
    const result = await runKeywordMetrics(
      { db, gateway },
      { agencyId: s.agency.id, projectId: s.project.id, date: "2026-03-10" },
    );
    expect(result).toMatchObject({ status: "done", metrics: 130, bing: 130 });
    expect(gateway.calls).toEqual(["metrics:100", "metrics:30", "bing:100", "bing:30"]);
    const rows = await prisma.keyword.findMany({ where: { projectId: s.project.id }, take: 200 });
    expect(rows.every((r) => r.metricsOn?.toISOString().slice(0, 10) === "2026-03-10")).toBe(true);
    expect(rows.some((r) => r.volume !== null && r.trend.length === 12)).toBe(true);
    expect(rows.every((r) => r.bingCheckedOn !== null)).toBe(true);
  });

  it("keeps what it has when the plan limit or budget stops it", async () => {
    const s = await setup();
    await kw(s, "first keyword");
    const gateway = gatewayOf();
    gateway.getBingRankings = async () => {
      throw new AppError("The monthly provider budget is used up.", "LIMIT");
    };
    const result = await runKeywordMetrics(
      { db, gateway },
      { agencyId: s.agency.id, projectId: s.project.id, date: "2026-03-10" },
    );
    expect(result).toMatchObject({ status: "stopped", metrics: 1, bing: 0 });
    expect(result.status === "stopped" && result.reason).toContain("budget");
    expect(
      (await prisma.keyword.findFirstOrThrow({ where: { projectId: s.project.id } })).metricsOn,
    ).not.toBeNull();
  });

  it("does nothing for an empty or removed project, and respects the agency", async () => {
    const s = await setup();
    const run = (projectId: string, agencyId = s.agency.id) =>
      runKeywordMetrics({ db, gateway: gatewayOf() }, { agencyId, projectId, date: "2026-03-10" });
    expect((await run(s.project.id)).status).toBe("no-keywords");
    const other = await setup("Other Agency");
    expect((await run(s.project.id, other.agency.id)).status).toBe("inactive");
  });

  it("is requested only by people who may run tools, and only with keywords", async () => {
    const s = await setup();
    await expect(requestKeywordMetrics(s.owner, s.project.id)).rejects.toThrow(ValidationError);
    await kw(s, "some keyword");
    expect((await requestKeywordMetrics(s.owner, s.project.id)).queued).toBeTypeOf("boolean");
    await expect(
      requestKeywordMetrics({ ...s.owner, role: "CLIENT" }, s.project.id),
    ).rejects.toThrow(ForbiddenError);
    const other = await setup("Other Agency");
    await expect(requestKeywordMetrics(other.owner, s.project.id)).rejects.toThrow(NotFoundError);
  });
});

describe("keyword insights", () => {
  it("works out intents, clusters, chances, clashes and the page map", async () => {
    const s = await setup();
    const rows: [
      string,
      number | null,
      string | null,
      string | null,
      number | null,
      number | null,
    ][] = [
      [
        "running shoes",
        8,
        "https://acmedental.com/shoes",
        "https://acmedental.com/shoes",
        5000,
        30,
      ],
      ["best running shoes", 12, "https://acmedental.com/blog/best", null, 1500, 40],
      ["buy running shoes", 2, "https://acmedental.com/shoes", null, 900, 50],
      ["acme dental login", 1, "https://acmedental.com/login", null, 200, 10],
      ["dentist near me", 25, "https://acmedental.com/", null, null, null],
    ];
    for (const [phrase, position, currentUrl, targetUrl, volume, difficulty] of rows) {
      await kw(s, phrase, {
        currentPosition: position,
        currentUrl,
        targetUrl,
        volume,
        difficulty,
        lastCheckedOn: day("2026-03-10"),
        metricsOn: volume === null ? null : day("2026-03-10"),
      });
    }
    const insights = await getKeywordInsights(s.owner, s.project.id);
    expect(insights.total).toBe(5);
    expect(insights.withVolume).toBe(4);
    expect(insights.intents).toEqual({
      informational: 1,
      commercial: 1,
      transactional: 1,
      navigational: 1,
      local: 1,
    });
    expect(insights.clusters[0]!.phrases).toEqual([
      "best running shoes",
      "buy running shoes",
      "running shoes",
    ]);
    expect(insights.clusters[0]!.volume).toBe(7400);
    // Position 2 is already in the top 3, so only three phrases can grow; the biggest comes first.
    expect(insights.opportunities.map((o) => o.phrase)).toEqual([
      "running shoes",
      "best running shoes",
    ]);
    const clash = insights.cannibalization.find((f) => f.kind === "competing");
    expect(clash).toMatchObject({ kind: "competing", cluster: "running shoe" });
    expect(insights.pageMap.unmapped).toBe(4);
    expect(insights.pageMap.pages).toEqual([
      { url: "https://acmedental.com/shoes", keywords: 1, averagePosition: 8, mismatched: 0 },
    ]);
  });

  it("finds a phrase whose ranking page keeps changing", async () => {
    const s = await setup();
    const k = await kw(s, "seo tips", {
      currentPosition: 9,
      currentUrl: "https://acmedental.com/b",
      lastCheckedOn: day("2026-03-10"),
    });
    const urls = ["/a", "/b", "/a", "/b"];
    for (const [i, u] of urls.entries()) {
      await prisma.rankCheck.create({
        data: {
          agencyId: s.agency.id,
          keywordId: k.id,
          date: new Date(Date.now() - (urls.length - i) * 86_400_000),
          position: 9,
          rankingUrl: `https://acmedental.com${u}`,
          provider: "mock",
        },
      });
    }
    const insights = await getKeywordInsights(s.owner, s.project.id);
    expect(insights.cannibalization).toEqual([
      expect.objectContaining({ kind: "flip", phrase: "seo tips", changes: 3 }),
    ]);
  });

  it("stays inside the agency and away from client users", async () => {
    const a = await setup();
    const b = await setup("Other Agency");
    await expect(getKeywordInsights(b.owner, a.project.id)).rejects.toThrow(NotFoundError);
    await expect(getKeywordInsights({ ...a.owner, role: "CLIENT" }, a.project.id)).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe("bulk edit", () => {
  it("adds and removes tags and sets or clears the target page for chosen keywords only", async () => {
    const s = await setup();
    const a = await kw(s, "alpha", { tags: ["old", "keep"] });
    const b = await kw(s, "beta", { tags: ["old"], targetUrl: "https://acmedental.com/x" });
    const c = await kw(s, "gamma", { tags: ["old"] });
    const r1 = await bulkEditKeywords(s.member, s.project.id, {
      ids: [a.id, b.id],
      addTags: "New, brand",
      removeTags: "old",
      targetUrl: "https://acmedental.com/page",
    });
    expect(r1).toEqual({ changed: 2, notFound: 0 });
    const rows = await prisma.keyword.findMany({
      where: { projectId: s.project.id },
      orderBy: { phrase: "asc" },
    });
    expect(rows[0]).toMatchObject({
      tags: ["keep", "new", "brand"],
      targetUrl: "https://acmedental.com/page",
    });
    expect(rows[1]).toMatchObject({
      tags: ["new", "brand"],
      targetUrl: "https://acmedental.com/page",
    });
    expect(rows[2]).toMatchObject({ phrase: "gamma", tags: ["old"], targetUrl: null });
    await bulkEditKeywords(s.member, s.project.id, { ids: [a.id], targetUrl: null });
    expect((await prisma.keyword.findUniqueOrThrow({ where: { id: a.id } })).targetUrl).toBeNull();
    expect(c.id).toBeTruthy();
  });

  it("refuses empty changes, bad addresses and other people's keywords", async () => {
    const s = await setup();
    const other = await setup("Other Agency");
    const a = await kw(s, "alpha");
    await expect(bulkEditKeywords(s.owner, s.project.id, { ids: [a.id] })).rejects.toThrow(
      ValidationError,
    );
    await expect(
      bulkEditKeywords(s.owner, s.project.id, { ids: [a.id], targetUrl: "not a url" }),
    ).rejects.toThrow(ValidationError);
    await expect(
      bulkEditKeywords(s.owner, s.project.id, { ids: [], addTags: "x" }),
    ).rejects.toThrow(ValidationError);
    await expect(
      bulkEditKeywords({ ...s.owner, role: "CLIENT" }, s.project.id, { ids: [a.id], addTags: "x" }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      bulkEditKeywords(other.owner, s.project.id, { ids: [a.id], addTags: "x" }),
    ).rejects.toThrow(NotFoundError);
    const stolen = await bulkEditKeywords(other.owner, other.project.id, {
      ids: [a.id],
      addTags: "x",
    });
    expect(stolen).toEqual({ changed: 0, notFound: 1 });
    expect((await prisma.keyword.findUniqueOrThrow({ where: { id: a.id } })).tags).toEqual([]);
  });
});

describe("CSV import", () => {
  it("adds new keywords, updates tracked ones, and lists bad lines", async () => {
    const s = await setup();
    await kw(s, "running shoes", { tags: ["a"] });
    const result = await importKeywordsCsv(s.member, s.project.id, {
      csv: "keyword,tags,url\nrunning shoes,b,https://acmedental.com/s\ntrail shoes,x;y,\n,,\nbad one,,nope\n",
    });
    expect(result).toMatchObject({ added: 1, updated: 1, truncated: false });
    // The blank line is skipped quietly; only the bad address is reported.
    expect(result.problems.map((p) => p.line)).toEqual([5]);
    const rows = await prisma.keyword.findMany({
      where: { projectId: s.project.id },
      orderBy: { phrase: "asc" },
    });
    expect(rows.map((r) => r.phrase)).toEqual(["running shoes", "trail shoes"]);
    expect(rows[0]).toMatchObject({ tags: ["a", "b"], targetUrl: "https://acmedental.com/s" });
    expect(rows[1]).toMatchObject({ tags: ["x", "y"] });
  });

  it("refuses an empty file, respects the plan limit, and stays inside the agency", async () => {
    const s = await setup();
    await expect(importKeywordsCsv(s.owner, s.project.id, { csv: "" })).rejects.toThrow(
      ValidationError,
    );
    await expect(importKeywordsCsv(s.owner, s.project.id, { csv: "keyword\n" })).rejects.toThrow(
      ValidationError,
    );
    await expect(
      importKeywordsCsv({ ...s.owner, role: "CLIENT" }, s.project.id, { csv: "a" }),
    ).rejects.toThrow(ForbiddenError);
    const other = await setup("Other Agency");
    await expect(importKeywordsCsv(other.owner, s.project.id, { csv: "a" })).rejects.toThrow(
      NotFoundError,
    );

    const small = await setup("Small Agency", "STARTER");
    const limit = (await prisma.plan.findUniqueOrThrow({ where: { code: "STARTER" } })).limits as {
      maxKeywords: number;
    };
    const csv = Array.from({ length: limit.maxKeywords + 1 }, (_, i) => `limit keyword ${i}`).join(
      "\n",
    );
    await expect(importKeywordsCsv(small.owner, small.project.id, { csv })).rejects.toThrow(
      LimitExceededError,
    );
    expect(await prisma.keyword.count({ where: { projectId: small.project.id } })).toBe(0);
  });
});

describe("ranking explanation", () => {
  it("gives leads for a big move and nothing for a small one", async () => {
    const s = await setup();
    const k = await kw(s, "blue shoes", { currentUrl: "https://acmedental.com/new" });
    const check = (daysAgo: number, position: number, url: string) =>
      prisma.rankCheck.create({
        data: {
          agencyId: s.agency.id,
          keywordId: k.id,
          date: new Date(Date.now() - daysAgo * 86_400_000),
          position,
          rankingUrl: url,
          provider: "mock",
          serpFeatures: daysAgo === 0 ? ["ai_overview"] : [],
        },
      });
    await check(8, 4, "https://acmedental.com/old");
    await check(0, 15, "https://acmedental.com/new");
    await prisma.annotation.create({
      data: {
        agencyId: s.agency.id,
        projectId: null,
        on: new Date(Date.now() - 4 * 86_400_000),
        kind: "ALGORITHM",
        title: "Core update",
      },
    });
    const result = await getRankingExplanation(s.owner, s.project.id, k.id);
    expect(result).toMatchObject({ from: 4, to: 15 });
    const texts = result!.reasons.map((r) => r.text);
    expect(texts[0]).toBe("Google now shows a different page of your site");
    expect(texts).toContain("New elements appeared above the results");
    expect(texts).toContain("A Google update happened around then");

    const calm = await kw(s, "calm keyword");
    await prisma.rankCheck.create({
      data: {
        agencyId: s.agency.id,
        keywordId: calm.id,
        date: new Date(Date.now() - 8 * 86_400_000),
        position: 5,
        provider: "mock",
      },
    });
    await prisma.rankCheck.create({
      data: {
        agencyId: s.agency.id,
        keywordId: calm.id,
        date: new Date(),
        position: 6,
        provider: "mock",
      },
    });
    expect(await getRankingExplanation(s.owner, s.project.id, calm.id)).toBeNull();
    const none = await kw(s, "never checked");
    expect(await getRankingExplanation(s.owner, s.project.id, none.id)).toBeNull();
  });

  it("stays inside the agency", async () => {
    const a = await setup();
    const b = await setup("Other Agency");
    const k = await kw(a, "alpha");
    await expect(getRankingExplanation(b.owner, a.project.id, k.id)).rejects.toThrow(NotFoundError);
    await expect(getRankingExplanation(b.owner, b.project.id, k.id)).rejects.toThrow(NotFoundError);
  });
});
