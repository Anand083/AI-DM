import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { MockSeoProvider } from "@/server/providers/seo/mock";
import type { AiEngine, AiVisibilityResult } from "@/server/providers/seo/types";
import { runAiVisibility, type AiGateway } from "@/server/services/ai-runner";
import { getAiInsights } from "@/server/services/ai-insights";
import { addPrompt } from "@/server/services/ai-visibility";
import { addCompetitor } from "@/server/services/competitors";
import { ForbiddenError, NotFoundError } from "@/server/services/errors";
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

/** The real mock provider behind the gateway shape the runner expects. */
function gatewayWith(
  answer: (i: { prompt: string; engine: AiEngine }) => Partial<AiVisibilityResult>,
  calls: string[] = [],
): AiGateway {
  const mock = new MockSeoProvider();
  const wrap = <T>(data: T) => ({ data, provider: "mock", cached: false, costMicros: 0 });
  return {
    checkAiVisibility: async (_c, input) => {
      calls.push(`check:${input.prompt}:${input.engine}`);
      const base = (await mock.checkAiVisibility(input)).data;
      return wrap({ ...base, ...answer(input) });
    },
    getAiTopicDemand: async (_c, input) => {
      calls.push("topics");
      return wrap((await mock.getAiTopicDemand(input)).data);
    },
    getLlmMentions: async (_c, input) => {
      calls.push("mentions");
      return wrap((await mock.getLlmMentions(input)).data);
    },
  };
}

const run = (s: S, gateway: AiGateway, date: string) =>
  runAiVisibility({ db, gateway }, { projectId: s.project.id, agencyId: s.agency.id, date });

describe("market snapshot", () => {
  it("saves topic demand and mentions once a day and does not ask again", async () => {
    const s = await setup();
    await addPrompt(s.owner, s.project.id, { text: "best dentist in Austin" });
    const calls: string[] = [];
    const gateway = gatewayWith(() => ({}), calls);
    const first = await run(s, gateway, "2026-03-02");
    expect(first).toMatchObject({ status: "done", marketSaved: true });
    const snap = await prisma.aiMarketSnapshot.findFirstOrThrow({
      where: { projectId: s.project.id },
    });
    expect((snap.topics as unknown[]).length).toBe(12);
    expect((snap.mentions as { engine: string }[]).map((m) => m.engine)).toEqual([
      "google_ai_overview",
      "chatgpt",
    ]);
    expect(snap.provider).toBe("mock");
    const before = calls.length;
    const second = await run(s, gateway, "2026-03-02");
    expect(second).toMatchObject({ status: "done", marketSaved: false });
    expect(calls.slice(before)).toEqual([]);
  });

  it("keeps the answers and stops quietly when the market call is refused", async () => {
    const s = await setup();
    await addPrompt(s.owner, s.project.id, { text: "best dentist in Austin" });
    const gateway = gatewayWith(() => ({}));
    const { AppError } = await import("@/server/services/errors");
    gateway.getAiTopicDemand = async () => {
      throw new AppError("The monthly provider budget is used up.", "LIMIT");
    };
    const result = await run(s, gateway, "2026-03-02");
    expect(result).toMatchObject({ status: "stopped", marketSaved: false });
    expect(await prisma.aiVisibilityCheck.count({ where: { projectId: s.project.id } })).toBe(3);
    expect(await prisma.aiMarketSnapshot.count({ where: { projectId: s.project.id } })).toBe(0);
  });
});

describe("getAiInsights", () => {
  it("is empty and honest before the first check", async () => {
    const s = await setup();
    const insights = await getAiInsights(s.owner, s.project.id);
    expect(insights).toMatchObject({
      latestOn: null,
      citations: [],
      recommendations: [],
      market: null,
    });
    expect(insights.coverage.label).toBe("No check yet, sample data");
  });

  it("builds citations, competitors, trends, coverage and advice from saved answers", async () => {
    const s = await setup();
    await addPrompt(s.owner, s.project.id, { text: "best dentist in Austin" });
    await addPrompt(s.owner, s.project.id, { text: "teeth whitening near me" });
    await addCompetitor(s.owner, s.project.id, { domain: "northwind.com" });
    // Week 1: never named. Week 2: named on ChatGPT only, rival linked everywhere.
    await run(
      s,
      gatewayWith(() => ({
        brandMentioned: false,
        domainCited: false,
        answerSnippet: "Try Northwind.",
        citedUrls: ["https://northwind.com/a"],
        sentiment: null,
      })),
      "2026-03-02",
    );
    await run(
      s,
      gatewayWith(({ engine }) => ({
        brandMentioned: engine === "chatgpt",
        domainCited: false,
        mentionPosition: engine === "chatgpt" ? 1 : null,
        sentiment: engine === "chatgpt" ? "negative" : null,
        answerSnippet: "Northwind and Acme Dental.",
        citedUrls: ["https://northwind.com/a", "https://wiki.example/"],
      })),
      "2026-03-09",
    );

    const insights = await getAiInsights(s.owner, s.project.id, new Date("2026-03-10T10:00:00Z"));
    expect(insights.latestOn).toBe("2026-03-09");
    expect(insights.coverage).toMatchObject({
      expected: 6,
      actual: 6,
      percent: 100,
      ageDays: 1,
      stale: false,
      sample: true,
    });
    expect(insights.citations[0]).toMatchObject({
      domain: "northwind.com",
      count: 6,
      kind: "competitor",
    });
    expect(insights.comparison.brand).toEqual({ answers: 2, rate: 33 });
    expect(insights.comparison.rivals[0]).toMatchObject({
      domain: "northwind.com",
      answers: 6,
      rate: 100,
    });
    const chatgpt = insights.engineTrends.find((t) => t.key === "chatgpt")!;
    expect(chatgpt.points.map((p) => p.rate)).toEqual([0, 100]);
    expect(chatgpt.change).toBe(100);
    expect(insights.promptTrends.map((t) => t.key).sort()).toEqual([
      "best dentist in Austin",
      "teeth whitening near me",
    ]);
    const ids = insights.recommendations.map((r) => r.id);
    expect(ids.some((id) => id.startsWith("competitor-ahead:northwind.com"))).toBe(true);
    expect(ids.some((id) => id.startsWith("engine-gap:"))).toBe(true);
    expect(insights.market?.sample).toBe(true);
    expect(insights.market?.topics).toHaveLength(12);
  });

  it("stays inside the agency and away from client users", async () => {
    const a = await setup();
    const b = await setup("Other Agency");
    await expect(getAiInsights(b.owner, a.project.id)).rejects.toThrow(NotFoundError);
    await expect(getAiInsights({ ...a.owner, role: "CLIENT" }, a.project.id)).rejects.toThrow(
      ForbiddenError,
    );
  });
});
