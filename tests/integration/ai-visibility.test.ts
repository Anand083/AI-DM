import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { runAiScheduler } from "@/server/jobs/system/ai-scheduler";
import type { AiEngine, AiVisibilityResult } from "@/server/providers/seo/types";
import { runAiVisibility, type AiGateway } from "@/server/services/ai-runner";
import {
  addPrompt,
  getAiOverview,
  getAiSettings,
  listLatestAnswers,
  listPrompts,
  removePrompt,
  requestAiCheck,
  saveAiSettings,
} from "@/server/services/ai-visibility";
import { addCompetitor } from "@/server/services/competitors";
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

type Answer = Partial<AiVisibilityResult>;
function fakeGateway(
  answer: (input: { prompt: string; engine: AiEngine; brand: string }) => Answer,
) {
  const calls: { prompt: string; engine: string; brand: string }[] = [];
  const gateway = {
    calls,
    checkAiVisibility: async (
      _caller: unknown,
      input: { prompt: string; engine: AiEngine; brand: string },
    ) => {
      calls.push({ prompt: input.prompt, engine: input.engine, brand: input.brand });
      return {
        data: {
          engine: input.engine,
          prompt: input.prompt,
          brandMentioned: false,
          domainCited: false,
          mentionPosition: null,
          sentiment: null,
          answerSnippet: "Nothing special.",
          citedUrls: [],
          ...answer(input),
        },
        provider: "mock",
        cached: false,
      };
    },
  };
  return gateway as typeof gateway & AiGateway;
}

const runOn = (s: S, gateway: AiGateway, date: string) =>
  runAiVisibility({ db, gateway }, { projectId: s.project.id, agencyId: s.agency.id, date });

describe("AI visibility check", () => {
  it("asks every engine about every prompt, uses the client name as brand and spots competitors", async () => {
    const s = await setup();
    await addPrompt(s.owner, s.project.id, { text: "best dentist in Austin" });
    await addPrompt(s.owner, s.project.id, { text: "teeth whitening near me" });
    await addCompetitor(s.owner, s.project.id, { domain: "northwind.com" });
    const gateway = fakeGateway(({ engine }) =>
      engine === "chatgpt"
        ? {
            brandMentioned: true,
            domainCited: true,
            mentionPosition: 2,
            sentiment: "positive",
            answerSnippet: "Try Northwind or Acme Dental.",
            citedUrls: ["https://acmedental.com/"],
          }
        : {},
    );

    const result = await runOn(s, gateway, "2026-03-02");
    expect(result).toMatchObject({ status: "done", checked: 6, skipped: 0, alerted: false });
    expect(gateway.calls).toHaveLength(6);
    expect(new Set(gateway.calls.map((c) => c.engine))).toEqual(
      new Set(["chatgpt", "gemini", "perplexity"]),
    );
    expect(new Set(gateway.calls.map((c) => c.brand))).toEqual(new Set(["Acme Dental"]));

    const rows = await prisma.aiVisibilityCheck.findMany({
      where: { projectId: s.project.id, engine: "chatgpt" },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      brandMentioned: true,
      domainCited: true,
      mentionPosition: 2,
      sentiment: "positive",
      competitorsMentioned: ["northwind.com"],
      citedUrls: ["https://acmedental.com/"],
    });
  });

  it("does nothing new when run again for the same day", async () => {
    const s = await setup();
    await addPrompt(s.owner, s.project.id, { text: "best dentist in Austin" });
    const gateway = fakeGateway(() => ({}));
    await runOn(s, gateway, "2026-03-02");
    const again = await runOn(s, gateway, "2026-03-02");
    expect(again).toMatchObject({ status: "done", checked: 0, skipped: 3 });
    expect(gateway.calls).toHaveLength(3);
  });

  it("uses the saved brand name and engines", async () => {
    const s = await setup();
    await addPrompt(s.owner, s.project.id, { text: "best dentist in Austin" });
    await saveAiSettings(s.owner, s.project.id, {
      brandName: "Bright Smiles",
      engines: ["claude"],
    });
    const gateway = fakeGateway(() => ({}));
    await runOn(s, gateway, "2026-03-02");
    expect(gateway.calls).toEqual([
      { prompt: "best dentist in Austin", engine: "claude", brand: "Bright Smiles" },
    ]);
  });

  it("stops quietly at the plan limit and keeps what it has", async () => {
    const s = await setup();
    await addPrompt(s.owner, s.project.id, { text: "best dentist in Austin" });
    await addPrompt(s.owner, s.project.id, { text: "teeth whitening near me" });
    let n = 0;
    const gateway = fakeGateway(() => {
      if (++n > 2) throw new LimitExceededError("You have used all 100 AI visibility checks.");
      return {};
    });
    const result = await runOn(s, gateway, "2026-03-02");
    expect(result).toMatchObject({
      status: "stopped",
      checked: 2,
      reason: "You have used all 100 AI visibility checks.",
    });
    expect(await prisma.aiVisibilityCheck.count({ where: { projectId: s.project.id } })).toBe(2);
  });

  it("raises one alert when answers that named the brand stop naming it", async () => {
    const s = await setup();
    await addPrompt(s.owner, s.project.id, { text: "best dentist in Austin" });
    await saveAiSettings(s.owner, s.project.id, {
      brandName: "Acme",
      engines: ["chatgpt", "gemini"],
    });
    await runOn(
      s,
      fakeGateway(() => ({ brandMentioned: true, mentionPosition: 1 })),
      "2026-03-02",
    );
    const result = await runOn(
      s,
      fakeGateway(() => ({ brandMentioned: false })),
      "2026-03-09",
    );
    expect(result).toMatchObject({ status: "done", alerted: true });
    const alert = await prisma.alert.findFirstOrThrow({ where: { agencyId: s.agency.id } });
    expect(alert).toMatchObject({
      type: "AI_MENTION_LOST",
      severity: "WARNING",
      projectId: s.project.id,
      dedupeKey: `ai_mention_lost:${s.project.id}:2026-03-09`,
    });
    expect(alert.body).toContain('"best dentist in Austin" on ChatGPT');
  });

  it("skips projects that were deleted or have no prompts", async () => {
    const s = await setup();
    expect(
      (
        await runOn(
          s,
          fakeGateway(() => ({})),
          "2026-03-02",
        )
      ).status,
    ).toBe("no-prompts");
    await prisma.project.update({ where: { id: s.project.id }, data: { deletedAt: new Date() } });
    expect(
      (
        await runOn(
          s,
          fakeGateway(() => ({})),
          "2026-03-02",
        )
      ).status,
    ).toBe("inactive");
  });
});

describe("prompts and settings", () => {
  it("checks the text, refuses duplicates and a 21st prompt, and removes by id", async () => {
    const s = await setup();
    const first = await addPrompt(s.member, s.project.id, { text: "  best dentist in Austin  " });
    expect(first.text).toBe("best dentist in Austin");
    await expect(
      addPrompt(s.owner, s.project.id, { text: "best dentist in Austin" }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(addPrompt(s.owner, s.project.id, { text: "hi" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    for (let i = 2; i <= 20; i++)
      await addPrompt(s.owner, s.project.id, { text: `question number ${i}` });
    await expect(
      addPrompt(s.owner, s.project.id, { text: "one more question" }),
    ).rejects.toBeInstanceOf(LimitExceededError);
    expect(await listPrompts(s.owner, s.project.id)).toHaveLength(20);
    await removePrompt(s.owner, s.project.id, first.id);
    await expect(removePrompt(s.owner, s.project.id, first.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(await listPrompts(s.owner, s.project.id)).toHaveLength(19);
  });

  it("gives defaults, saves changes, and rejects bad engines", async () => {
    const s = await setup();
    expect(await getAiSettings(s.owner, s.project.id)).toEqual({
      brandName: "Acme Dental",
      engines: ["chatgpt", "gemini", "perplexity"],
      saved: false,
    });
    await saveAiSettings(s.owner, s.project.id, {
      brandName: "Bright",
      engines: ["claude", "gemini"],
    });
    await saveAiSettings(s.owner, s.project.id, { brandName: "Brighter", engines: ["claude"] });
    expect(await getAiSettings(s.owner, s.project.id)).toEqual({
      brandName: "Brighter",
      engines: ["claude"],
      saved: true,
    });
    expect(await prisma.aiSetting.count({ where: { projectId: s.project.id } })).toBe(1);
    await expect(
      saveAiSettings(s.owner, s.project.id, { brandName: "X", engines: [] }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      saveAiSettings(s.owner, s.project.id, { brandName: "X", engines: ["bing"] }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      saveAiSettings(s.owner, s.project.id, { brandName: " ", engines: ["claude"] }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("only people who may edit or run tools can change things", async () => {
    const s = await setup();
    const client = { ...s.owner, role: "CLIENT" as const };
    await expect(
      addPrompt(client, s.project.id, { text: "best dentist in Austin" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(requestAiCheck(client, s.project.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getAiOverview(client, s.project.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(requestAiCheck(s.owner, s.project.id)).rejects.toThrow(
      "Add at least one question first.",
    );
  });

  it("refuses a check when everything was already checked today", async () => {
    const s = await setup();
    await addPrompt(s.owner, s.project.id, { text: "best dentist in Austin" });
    await saveAiSettings(s.owner, s.project.id, { brandName: "Acme", engines: ["chatgpt"] });
    const prompt = (await listPrompts(s.owner, s.project.id))[0]!;
    await prisma.aiVisibilityCheck.create({
      data: {
        agencyId: s.agency.id,
        projectId: s.project.id,
        promptId: prompt.id,
        engine: "chatgpt",
        checkedOn: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`),
        brandMentioned: false,
        domainCited: false,
        snippet: "x",
        citedUrls: [],
        competitorsMentioned: [],
        provider: "mock",
      },
    });
    await expect(requestAiCheck(s.owner, s.project.id)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("overview", () => {
  it("is empty before the first check", async () => {
    const s = await setup();
    const overview = await getAiOverview(s.owner, s.project.id);
    expect(overview).toMatchObject({ latest: null, history: [], latestOn: null });
    expect((await listLatestAnswers(s.owner, s.project.id)).total).toBe(0);
  });

  it("shows the latest run, the run before, share of voice and cited pages", async () => {
    const s = await setup();
    await addPrompt(s.owner, s.project.id, { text: "best dentist in Austin" });
    await addPrompt(s.owner, s.project.id, { text: "teeth whitening near me" });
    await saveAiSettings(s.owner, s.project.id, {
      brandName: "Acme",
      engines: ["chatgpt", "gemini"],
    });
    await addCompetitor(s.owner, s.project.id, { domain: "northwind.com" });

    await runOn(
      s,
      fakeGateway(() => ({ brandMentioned: true, mentionPosition: 1 })),
      "2026-03-02",
    );
    await runOn(
      s,
      fakeGateway(({ engine, prompt }) =>
        engine === "chatgpt" && prompt.startsWith("best")
          ? {
              brandMentioned: true,
              mentionPosition: 3,
              citedUrls: ["https://acmedental.com/"],
              domainCited: true,
            }
          : {
              answerSnippet: "Northwind is popular.",
              citedUrls: ["https://wiki-facts.example/"],
            },
      ),
      "2026-03-09",
    );

    const overview = await getAiOverview(s.owner, s.project.id);
    expect(overview.latestOn).toBe("2026-03-09");
    expect(overview.history.map((h) => [h.date, h.mentionRate])).toEqual([
      ["2026-03-09", 25],
      ["2026-03-02", 100],
    ]);
    expect(overview.previousRate).toBe(100);
    expect(overview.latest).toMatchObject({
      total: 4,
      mentioned: 1,
      mentionRate: 25,
      averagePosition: 3,
      competitorMentions: { "northwind.com": 3 },
      // 1 brand mention against 3 rival mentions
      shareOfVoice: 25,
    });
    expect(overview.citedPages[0]).toEqual({ url: "https://wiki-facts.example/", count: 3 });

    const answers = await listLatestAnswers(s.owner, s.project.id, { page: 1, pageSize: 3 });
    expect(answers.total).toBe(4);
    expect(answers.rows).toHaveLength(3);
    expect(answers.rows[0]?.prompt.text).toBe("best dentist in Austin");
  });
});

describe("weekly scheduler", () => {
  it("queues projects whose last check is 7 or more days old, never ones without a first check", async () => {
    const s = await setup();
    const prompt = await prisma.aiPrompt.create({
      data: { agencyId: s.agency.id, projectId: s.project.id, text: "best dentist in Austin" },
    });
    await prisma.aiVisibilityCheck.create({
      data: {
        agencyId: s.agency.id,
        projectId: s.project.id,
        promptId: prompt.id,
        engine: "chatgpt",
        checkedOn: new Date("2026-03-01T00:00:00Z"),
        brandMentioned: false,
        domainCited: false,
        snippet: "x",
        citedUrls: [],
        competitorsMentioned: [],
        provider: "mock",
      },
    });
    const never = await prisma.project.create({
      data: {
        agencyId: s.agency.id,
        clientId: (await prisma.client.findFirstOrThrow({ where: { agencyId: s.agency.id } })).id,
        name: "Never",
        domain: "never.com",
        locationCode: 2840,
        languageCode: "en",
      },
    });
    await prisma.aiPrompt.create({
      data: { agencyId: s.agency.id, projectId: never.id, text: "some question here" },
    });
    const queued: string[] = [];
    const now = new Date("2026-03-09T00:05:00Z");
    await runAiScheduler({
      db: prisma,
      now,
      enqueue: async (j) => (queued.push(j.projectId), true),
    });
    expect(queued).toContain(s.project.id);
    expect(queued).not.toContain(never.id);

    const paused = await runAiScheduler({
      db: prisma,
      now,
      enqueue: async () => true,
      paused: async () => true,
    });
    expect(paused).toMatchObject({ queued: 0, paused: true });
  });
});

describe("tenant isolation: AI visibility", () => {
  it("another agency's project is not found for every call", async () => {
    const a = await setup();
    const b = await setup();
    const prompt = await addPrompt(b.owner, b.project.id, { text: "best dentist in Austin" });
    await runOn(
      b,
      fakeGateway(() => ({})),
      "2026-03-02",
    );
    await expect(getAiSettings(a.owner, b.project.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      saveAiSettings(a.owner, b.project.id, { brandName: "X", engines: ["claude"] }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(listPrompts(a.owner, b.project.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      addPrompt(a.owner, b.project.id, { text: "my own question" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(removePrompt(a.owner, b.project.id, prompt.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(removePrompt(a.owner, a.project.id, prompt.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(getAiOverview(a.owner, b.project.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listLatestAnswers(a.owner, b.project.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(requestAiCheck(a.owner, b.project.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await prisma.aiPrompt.count({ where: { id: prompt.id } })).toBe(1);
  });
});
