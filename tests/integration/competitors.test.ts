import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import type { RankedKeyword } from "@/server/providers/seo/types";
import { runCompetitorGap, type CompetitorGateway } from "@/server/services/competitor-runner";
import {
  addCompetitor,
  getComparison,
  listCompetitors,
  listGap,
  removeCompetitor,
  requestGapRefresh,
} from "@/server/services/competitors";
import {
  ConflictError,
  ForbiddenError,
  LimitExceededError,
  NotFoundError,
  ValidationError,
} from "@/server/services/errors";
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

async function setup() {
  const { agency, members } = await createAgencyWithMembers(
    prisma,
    ["OWNER", "MEMBER"],
    undefined,
    "GROWTH",
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
type S = Awaited<ReturnType<typeof setup>>;

/** A tracked keyword whose last check saved this top 10. */
async function checked(s: S, phrase: string, position: number | null, top: [number, string][]) {
  const date = new Date("2026-03-10T00:00:00Z");
  const keyword = await prisma.keyword.create({
    data: {
      agencyId: s.agency.id,
      projectId: s.project.id,
      phrase,
      currentPosition: position,
      lastCheckedOn: date,
    },
  });
  await prisma.rankCheck.create({
    data: {
      agencyId: s.agency.id,
      keywordId: keyword.id,
      date,
      checkedAt: date,
      position,
      topResults: top.map(([p, domain]) => ({
        position: p,
        domain,
        url: `https://${domain}/`,
        title: "t",
      })),
      provider: "mock",
    },
  });
}

describe("managing competitors", () => {
  it("cleans the domain, refuses duplicates, the project's own site and a sixth competitor", async () => {
    const s = await setup();
    const added = await addCompetitor(s.owner, s.project.id, {
      domain: "https://WWW.Rival-One.com/pricing",
    });
    expect(added.domain).toBe("rival-one.com");
    await expect(
      addCompetitor(s.owner, s.project.id, { domain: "rival-one.com" }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      addCompetitor(s.owner, s.project.id, { domain: "www.example.com" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      addCompetitor(s.owner, s.project.id, { domain: "not a site" }),
    ).rejects.toBeInstanceOf(ValidationError);
    for (const n of [2, 3, 4, 5])
      await addCompetitor(s.owner, s.project.id, { domain: `rival${n}.com` });
    await expect(
      addCompetitor(s.owner, s.project.id, { domain: "rival6.com" }),
    ).rejects.toBeInstanceOf(LimitExceededError);
    expect((await listCompetitors(s.owner, s.project.id)).map((c) => c.domain)).toHaveLength(5);

    await removeCompetitor(s.member, s.project.id, added.id);
    expect(await listCompetitors(s.owner, s.project.id)).toHaveLength(4);
    await expect(removeCompetitor(s.owner, s.project.id, added.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("only people who may edit can add or remove", async () => {
    const s = await setup();
    const client = { ...s.owner, role: "CLIENT" as const };
    await expect(
      addCompetitor(client, s.project.id, { domain: "rival.com" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listCompetitors(client, s.project.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(requestGapRefresh(client, s.project.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("asking for a gap refresh without competitors says what to do", async () => {
    const s = await setup();
    await expect(requestGapRefresh(s.owner, s.project.id)).rejects.toThrow(
      "Add at least one competitor first.",
    );
  });
});

describe("ranking comparison", () => {
  it("compares from the saved top 10 and puts keywords where a rival is ahead first", async () => {
    const s = await setup();
    await addCompetitor(s.owner, s.project.id, { domain: "rival.com" });
    await addCompetitor(s.owner, s.project.id, { domain: "other.com" });
    await checked(s, "alpha", 5, [
      [2, "rival.com"],
      [5, "example.com"],
      [9, "other.com"],
    ]);
    await checked(s, "beta", 1, [
      [1, "example.com"],
      [4, "www.rival.com"],
    ]);
    await checked(s, "gamma", null, [[3, "other.com"]]);
    // Never checked: left out.
    await prisma.keyword.create({
      data: { agencyId: s.agency.id, projectId: s.project.id, phrase: "delta" },
    });

    const result = await getComparison(s.owner, s.project.id);
    expect(result.compared).toBe(3);
    expect(result.rows.map((r) => r.phrase)).toEqual(["alpha", "gamma", "beta"]);
    expect(result.rows[0]).toMatchObject({
      you: 5,
      competitors: { "rival.com": 2, "other.com": 9 },
    });
    expect(result.summary).toEqual([
      { domain: "other.com", inTop10: 2, theyAreAhead: 1, youAreAhead: 2, averagePosition: 6 },
      { domain: "rival.com", inTop10: 2, theyAreAhead: 1, youAreAhead: 2, averagePosition: 3 },
    ]);

    const page2 = await getComparison(s.owner, s.project.id, { page: 2, pageSize: 2 });
    expect(page2.rows.map((r) => r.phrase)).toEqual(["beta"]);
    expect(page2.total).toBe(3);
  });

  it("is empty without competitors", async () => {
    const s = await setup();
    await checked(s, "alpha", 5, [[2, "rival.com"]]);
    const result = await getComparison(s.owner, s.project.id);
    expect(result.summary).toEqual([]);
    expect(result.rows).toEqual([]);
  });
});

function fakeGateway(
  byDomain: Record<string, RankedKeyword[]>,
): CompetitorGateway & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    getRankedKeywords: async (_caller: unknown, input: { domain: string }) => {
      calls.push(input.domain);
      return { data: byDomain[input.domain] ?? [], provider: "mock", cached: false };
    },
  } as never;
}
const kw = (keyword: string, volume: number, position = 3): RankedKeyword => ({
  keyword,
  volume,
  position,
  url: `https://x.test/${keyword.replace(/ /g, "-")}`,
});

describe("keyword gap", () => {
  it("keeps what competitors rank for and we do not, and replaces the list on every run", async () => {
    const s = await setup();
    const rival = await addCompetitor(s.owner, s.project.id, { domain: "rival.com" });
    await prisma.keyword.create({
      data: { agencyId: s.agency.id, projectId: s.project.id, phrase: "tracked already" },
    });
    const gateway = fakeGateway({
      "example.com": [kw("we rank for this", 900)],
      "rival.com": [
        kw("we rank for this", 5000),
        kw("Tracked Already", 4000),
        kw("big opportunity", 3000, 2),
        kw("small one", 20, 8),
      ],
    });
    const run = { projectId: s.project.id, agencyId: s.agency.id };

    expect(await runCompetitorGap({ db, gateway }, run)).toEqual({
      status: "done",
      competitors: 1,
      stored: 2,
    });
    expect(gateway.calls).toEqual(["example.com", "rival.com"]);
    const gap = await listGap(s.owner, s.project.id);
    expect(gap.rows.map((r) => [r.keyword, r.volume, r.competitor.domain])).toEqual([
      ["big opportunity", 3000, "rival.com"],
      ["small one", 20, "rival.com"],
    ]);
    const fetched = (await listCompetitors(s.owner, s.project.id))[0]!.gapFetchedAt;
    expect(fetched).not.toBeNull();

    // Next time the rival has different keywords: the old list is replaced, not added to.
    const second = fakeGateway({ "rival.com": [kw("new topic", 100)] });
    await runCompetitorGap({ db, gateway: second }, run);
    expect((await listGap(s.owner, s.project.id)).rows.map((r) => r.keyword)).toEqual([
      "new topic",
    ]);
    expect(await prisma.competitorKeyword.count({ where: { competitorId: rival.id } })).toBe(1);
  });

  it("pages the list and can be filtered by competitor", async () => {
    const s = await setup();
    const a = await addCompetitor(s.owner, s.project.id, { domain: "a-rival.com" });
    await addCompetitor(s.owner, s.project.id, { domain: "b-rival.com" });
    const gateway = fakeGateway({
      "a-rival.com": [kw("one", 10), kw("two", 20), kw("three", 30)],
      "b-rival.com": [kw("four", 40)],
    });
    await runCompetitorGap({ db, gateway }, { projectId: s.project.id, agencyId: s.agency.id });
    const first = await listGap(s.owner, s.project.id, { page: 1, pageSize: 3 });
    expect(first.total).toBe(4);
    expect(first.rows.map((r) => r.keyword)).toEqual(["four", "three", "two"]);
    const only = await listGap(s.owner, s.project.id, { competitorId: a.id });
    expect(only.total).toBe(3);
  });

  it("skips deleted projects and projects without competitors", async () => {
    const s = await setup();
    const run = { projectId: s.project.id, agencyId: s.agency.id };
    expect((await runCompetitorGap({ db, gateway: fakeGateway({}) }, run)).status).toBe(
      "no-competitors",
    );
    await prisma.project.update({ where: { id: s.project.id }, data: { deletedAt: new Date() } });
    expect((await runCompetitorGap({ db, gateway: fakeGateway({}) }, run)).status).toBe("inactive");
  });
});

describe("tenant isolation: competitors", () => {
  it("another agency's project is not found for every call", async () => {
    const a = await setup();
    const b = await setup();
    const rival = await addCompetitor(b.owner, b.project.id, { domain: "rival.com" });
    await expect(listCompetitors(a.owner, b.project.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getComparison(a.owner, b.project.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listGap(a.owner, b.project.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(addCompetitor(a.owner, b.project.id, { domain: "x.com" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(removeCompetitor(a.owner, b.project.id, rival.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    // Even with its own project id, another agency's competitor id does nothing.
    await expect(removeCompetitor(a.owner, a.project.id, rival.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(requestGapRefresh(a.owner, b.project.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await prisma.competitor.count({ where: { id: rival.id } })).toBe(1);
  });
});
