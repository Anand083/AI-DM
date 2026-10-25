import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { runCompetitorAlerts } from "@/server/jobs/system/competitor-alerts";
import { MockSeoProvider } from "@/server/providers/seo/mock";
import { getAnchorDistribution } from "@/server/services/backlinks";
import {
  getCompetitorInsights,
  requestCompetitorLinks,
} from "@/server/services/competitor-insights";
import {
  runCompetitorLinks,
  type CompetitorLinksGateway,
} from "@/server/services/competitor-links-runner";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/services/errors";
import { generateReport } from "@/server/services/report-generator";
import { createReport, getReport } from "@/server/services/reports";
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
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const today = new Date().toISOString().slice(0, 10);

async function setup(name?: string) {
  const { agency, members } = await createAgencyWithMembers(
    prisma,
    ["OWNER", "MEMBER"],
    name,
    "GROWTH",
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

const competitor = (s: S, domain: string) =>
  prisma.competitor.create({
    data: { agencyId: s.agency.id, projectId: s.project.id, domain },
  });

/** Keywords with rank checks whose top 10 are given for the days listed. */
async function checks(s: S, phrases: string[], perDay: Record<number, (i: number) => string[]>) {
  for (const [i, phrase] of phrases.entries()) {
    const k = await prisma.keyword.create({
      data: { agencyId: s.agency.id, projectId: s.project.id, phrase, lastCheckedOn: day(today) },
    });
    for (const [ago, top] of Object.entries(perDay)) {
      await prisma.rankCheck.create({
        data: {
          agencyId: s.agency.id,
          keywordId: k.id,
          date: daysAgo(Number(ago)),
          position: 5,
          provider: "mock",
          topResults: top(i).map((domain, p) => ({
            position: p + 1,
            domain,
            url: `https://${domain}/`,
            title: "T",
          })),
        },
      });
    }
  }
}

function gatewayOf(): CompetitorLinksGateway {
  const mock = new MockSeoProvider();
  const wrap = <T>(data: T) => ({ data, provider: "mock", cached: false, costMicros: 0 });
  return {
    getBacklinkSummary: async (_c, d) => wrap((await mock.getBacklinkSummary(d)).data),
    getReferringDomains: async (_c, i) => wrap((await mock.getReferringDomains(i)).data),
  };
}

describe("competitor links", () => {
  it("saves link numbers and linking websites, and replaces them next time", async () => {
    const s = await setup();
    const a = await competitor(s, "rival-a.com");
    await competitor(s, "rival-b.com");
    const run = () =>
      runCompetitorLinks(
        { db, gateway: gatewayOf(), windowFor: async () => 1000 },
        { agencyId: s.agency.id, projectId: s.project.id },
      );
    expect(await run()).toMatchObject({ status: "done", competitors: 2 });
    const links = await prisma.competitorLink.count({ where: { competitorId: a.id } });
    expect(links).toBeGreaterThan(10);
    const row = await prisma.competitor.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.backlinks).toBeGreaterThan(0);
    expect(row.linksFetchedAt).not.toBeNull();
    await run();
    expect(await prisma.competitorLink.count({ where: { competitorId: a.id } })).toBe(links);
  });

  it("keeps what it has when the plan limit or budget stops it", async () => {
    const s = await setup();
    await competitor(s, "rival-a.com");
    await competitor(s, "rival-b.com");
    const gateway = gatewayOf();
    let calls = 0;
    const real = gateway.getReferringDomains;
    gateway.getReferringDomains = async (c, i) => {
      if (++calls > 1) throw new AppError("The monthly provider budget is used up.", "LIMIT");
      return real(c, i);
    };
    const result = await runCompetitorLinks(
      { db, gateway, windowFor: async () => 1000 },
      { agencyId: s.agency.id, projectId: s.project.id },
    );
    expect(result).toMatchObject({ status: "stopped", competitors: 1 });
    expect(result.status === "stopped" && result.reason).toContain("budget");
  });

  it("shares what the plan can still afford and stops when it is too little", async () => {
    const s = await setup();
    await competitor(s, "rival-a.com");
    await competitor(s, "rival-b.com");
    const asked: number[] = [];
    const gateway = gatewayOf();
    const real = gateway.getReferringDomains;
    gateway.getReferringDomains = async (c, i) => {
      asked.push(i.limit);
      return real(c, i);
    };
    const run = (window: number) =>
      runCompetitorLinks(
        { db, gateway, windowFor: async () => window },
        { agencyId: s.agency.id, projectId: s.project.id },
      );
    expect(await run(100)).toMatchObject({ status: "done" });
    expect(asked).toEqual([49, 49]);
    const tooLittle = await run(20);
    expect(tooLittle).toMatchObject({ status: "stopped", competitors: 0 });
    expect(tooLittle.status === "stopped" && tooLittle.reason).toContain("not enough");
  });

  it("does nothing without competitors or for another agency's project", async () => {
    const s = await setup();
    const other = await setup("Other Agency");
    const run = (agencyId: string) =>
      runCompetitorLinks(
        { db, gateway: gatewayOf(), windowFor: async () => 1000 },
        { agencyId, projectId: s.project.id },
      );
    expect((await run(s.agency.id)).status).toBe("no-competitors");
    expect((await run(other.agency.id)).status).toBe("inactive");
  });

  it("is requested only by people who may run tools, and only with competitors", async () => {
    const s = await setup();
    await expect(requestCompetitorLinks(s.owner, s.project.id)).rejects.toThrow(ValidationError);
    await competitor(s, "rival-a.com");
    expect((await requestCompetitorLinks(s.owner, s.project.id)).queued).toBeTypeOf("boolean");
    await expect(
      requestCompetitorLinks({ ...s.owner, role: "CLIENT" }, s.project.id),
    ).rejects.toThrow(ForbiddenError);
    const other = await setup("Other Agency");
    await expect(requestCompetitorLinks(other.owner, s.project.id)).rejects.toThrow(NotFoundError);
  });
});

describe("competitor insights", () => {
  it("suggests websites that keep showing up, but not yourself, tracked ones or big general sites", async () => {
    const s = await setup();
    await competitor(s, "known.com");
    const phrases = ["a", "b", "c", "d", "e"];
    await checks(s, phrases, {
      1: (i) => [
        "acmedental.com",
        "newrival.com",
        "wikipedia.org",
        "known.com",
        ...(i === 0 ? ["oneoff.com"] : []),
      ],
    });
    const insights = await getCompetitorInsights(s.owner, s.project.id);
    expect(insights.suggestions.map((x) => x.domain)).toEqual(["newrival.com"]);
    expect(insights.suggestions[0]).toMatchObject({ keywords: 5, share: 100, averagePosition: 2 });
  });

  it("counts top 10 places by week for you and each competitor", async () => {
    const s = await setup();
    await competitor(s, "rival.com");
    const phrases = ["a", "b", "c", "d", "e", "f"];
    // Last week the rival holds 2 places; this week 6.
    await checks(s, phrases, {
      9: (i) => (i < 2 ? ["rival.com", "acmedental.com"] : ["other.com"]),
      1: () => ["rival.com", "acmedental.com"],
    });
    const insights = await getCompetitorInsights(s.owner, s.project.id);
    const weeks = insights.history.weeks.filter((w) => w.keywords > 0);
    expect(weeks).toHaveLength(2);
    expect(weeks.at(-2)!.byDomain["rival.com"]!.top10).toBe(2);
    expect(weeks.at(-1)!.byDomain["rival.com"]!.top10).toBe(6);
    expect(weeks.at(-1)!.byDomain["acmedental.com"]!.top10).toBe(6);
  });

  it("shows links side by side and the sites that link to rivals but not to you", async () => {
    const s = await setup();
    const a = await competitor(s, "rival-a.com");
    const b = await competitor(s, "rival-b.com");
    await prisma.competitorLink.createMany({
      data: [
        {
          agencyId: s.agency.id,
          projectId: s.project.id,
          competitorId: a.id,
          sourceDomain: "shared.com",
          rating: 60,
        },
        {
          agencyId: s.agency.id,
          projectId: s.project.id,
          competitorId: b.id,
          sourceDomain: "shared.com",
          rating: 60,
        },
        {
          agencyId: s.agency.id,
          projectId: s.project.id,
          competitorId: a.id,
          sourceDomain: "mine-too.com",
          rating: 90,
        },
        {
          agencyId: s.agency.id,
          projectId: s.project.id,
          competitorId: b.id,
          sourceDomain: "solo.com",
          rating: 30,
        },
      ],
    });
    await prisma.competitor.update({
      where: { id: a.id },
      data: { backlinks: 500, referringDomains: 80, domainRating: 40, linksFetchedAt: new Date() },
    });
    await prisma.backlink.create({
      data: {
        agencyId: s.agency.id,
        projectId: s.project.id,
        sourceUrl: "https://mine-too.com/p",
        sourceDomain: "mine-too.com",
        targetUrl: "https://acmedental.com/",
        anchor: "Acme Dental",
        dofollow: true,
        sourceRating: 50,
        firstSeen: day("2026-01-01"),
        lastSeen: day("2026-03-01"),
      },
    });
    await prisma.backlinkSnapshot.create({
      data: {
        agencyId: s.agency.id,
        projectId: s.project.id,
        takenOn: day("2026-03-01"),
        totalBacklinks: 120,
        referringDomains: 30,
        dofollowPercent: 70,
        domainRating: 25,
        newLinks: 0,
        lostLinks: 0,
      },
    });
    const { links } = await getCompetitorInsights(s.owner, s.project.id);
    expect(links.rows[0]).toEqual({
      domain: "acmedental.com",
      isYou: true,
      backlinks: 120,
      referringDomains: 30,
      rating: 25,
    });
    expect(links.rows[1]).toMatchObject({ domain: "rival-a.com", backlinks: 500, rating: 40 });
    expect(links.rows[2]).toMatchObject({ domain: "rival-b.com", backlinks: null });
    expect(links.gap).toEqual([
      { sourceDomain: "shared.com", rating: 60, competitors: ["rival-a.com", "rival-b.com"] },
      { sourceDomain: "solo.com", rating: 30, competitors: ["rival-b.com"] },
    ]);
  });

  it("stays inside the agency and away from client users", async () => {
    const a = await setup();
    const b = await setup("Other Agency");
    await expect(getCompetitorInsights(b.owner, a.project.id)).rejects.toThrow(NotFoundError);
    await expect(
      getCompetitorInsights({ ...a.owner, role: "CLIENT" }, a.project.id),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("competitor move alerts", () => {
  it("alerts once when a competitor gains many top 10 places, and checks each competitor once a day", async () => {
    const s = await setup();
    const rival = await competitor(s, "rival.com");
    const phrases = Array.from({ length: 8 }, (_, i) => `keyword ${i}`);
    await checks(s, phrases, {
      9: () => ["other.com"],
      1: () => ["rival.com", "other.com"],
    });
    const first = await runCompetitorAlerts({ db: prisma, alertDb: db, now: new Date() });
    // The job works on every agency in the test database; look at this agency only.
    expect(first.alerts).toBeGreaterThanOrEqual(1);
    const alert = await prisma.alert.findFirstOrThrow({
      where: { agencyId: s.agency.id, type: "COMPETITOR_MOVE" },
    });
    expect(alert.title).toBe("rival.com moved up for Site");
    expect(alert.body).toContain("8 of your keywords, up from 0");
    expect(
      (await prisma.competitor.findUniqueOrThrow({ where: { id: rival.id } })).alertCheckedOn,
    ).not.toBeNull();
    const again = await runCompetitorAlerts({ db: prisma, alertDb: db, now: new Date() });
    expect(again.alerts).toBe(0);
    expect(
      await prisma.alert.count({ where: { agencyId: s.agency.id, type: "COMPETITOR_MOVE" } }),
    ).toBe(1);
  });

  it("stays quiet when nothing changed", async () => {
    const s = await setup();
    await competitor(s, "calm.com");
    await checks(
      s,
      Array.from({ length: 6 }, (_, i) => `k${i}`),
      {
        9: () => ["calm.com"],
        1: () => ["calm.com"],
      },
    );
    await runCompetitorAlerts({ db: prisma, alertDb: db, now: new Date() });
    expect(await prisma.alert.count({ where: { agencyId: s.agency.id } })).toBe(0);
  });
});

describe("anchors and the report", () => {
  it("shows what kind of text the live links use", async () => {
    const s = await setup();
    await prisma.keyword.create({
      data: { agencyId: s.agency.id, projectId: s.project.id, phrase: "dentist austin" },
    });
    const anchors = [
      ...Array(8).fill("dentist austin"),
      ...Array(10).fill("Acme Dental"),
      "click here",
      "https://acmedental.com",
    ];
    for (const [i, anchor] of anchors.entries()) {
      await prisma.backlink.create({
        data: {
          agencyId: s.agency.id,
          projectId: s.project.id,
          sourceUrl: `https://site${i}.example/p`,
          sourceDomain: `site${i}.example`,
          targetUrl: "https://acmedental.com/",
          anchor,
          dofollow: true,
          sourceRating: 30,
          firstSeen: day("2026-01-01"),
          lastSeen: day("2026-03-01"),
        },
      });
    }
    const result = await getAnchorDistribution(s.owner, s.project.id);
    expect(result.total).toBe(20);
    expect(result.rows[0]).toEqual({ kind: "branded", count: 10, percent: 50 });
    expect(result.rows.find((r) => r.kind === "exact")).toEqual({
      kind: "exact",
      count: 8,
      percent: 40,
    });
    expect(result.overOptimised).toBe(true);
    const other = await setup("Other Agency");
    await expect(getAnchorDistribution(other.owner, s.project.id)).rejects.toThrow(NotFoundError);
  });

  it("puts the side by side links into the competitor section of a report", async () => {
    const s = await setup();
    const rival = await competitor(s, "rival.com");
    await prisma.competitor.update({
      where: { id: rival.id },
      data: { backlinks: 900, referringDomains: 120, domainRating: 45, linksFetchedAt: new Date() },
    });
    await prisma.backlinkSnapshot.create({
      data: {
        agencyId: s.agency.id,
        projectId: s.project.id,
        takenOn: day("2026-03-01"),
        totalBacklinks: 300,
        referringDomains: 50,
        dofollowPercent: 70,
        domainRating: 30,
        newLinks: 0,
        lostLinks: 0,
      },
    });
    const { id } = await createReport(
      s.owner,
      {
        projectId: s.project.id,
        period: "custom",
        start: "2026-03-01",
        end: "2026-03-30",
        sections: ["summary", "competitors"],
      },
      { now: new Date("2026-03-31T12:00:00Z"), enqueue: async () => undefined },
    );
    expect(await generateReport(s.agency.id, id)).toEqual({ status: "READY" });
    const model = (await getReport(s.owner, id)).model!;
    expect(model.competitors?.links).toEqual([
      { domain: "acmedental.com", isYou: true, backlinks: 300, referringDomains: 50, rating: 30 },
      { domain: "rival.com", isYou: false, backlinks: 900, referringDomains: 120, rating: 45 },
    ]);
  });
});
