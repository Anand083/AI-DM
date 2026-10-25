import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAnnotation, deleteAnnotation, listAnnotations } from "@/server/services/annotations";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  ConflictError,
} from "@/server/services/errors";
import { runGoalSnapshots } from "@/server/services/goal-runner";
import { createGoal, deleteGoal, listGoals } from "@/server/services/goals";
import { listPerformance } from "@/server/services/performance";
import { generateReport } from "@/server/services/report-generator";
import {
  deleteReportTemplate,
  listReportTemplates,
  saveReportTemplate,
} from "@/server/services/report-templates";
import { createReport, getReport, readReportPdf } from "@/server/services/reports";
import { createAgencyWithMembers, seedPlans } from "../factories";
import { createTestClient, resetDb } from "../helpers/db";
import { readPdf } from "../helpers/pdf-text";

const prisma = createTestClient();

beforeAll(async () => {
  await resetDb(prisma);
  await seedPlans(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
});

const day = (v: string) => new Date(`${v}T00:00:00Z`);
const today = new Date().toISOString().slice(0, 10);

async function setup(name = "Original Agency") {
  const { agency, members } = await createAgencyWithMembers(
    prisma,
    ["OWNER", "ADMIN", "MEMBER"],
    name,
    "GROWTH",
  );
  const client = await prisma.client.create({ data: { agencyId: agency.id, name: "Acme Dental" } });
  const mk = (n: string, domain: string) =>
    prisma.project.create({
      data: {
        agencyId: agency.id,
        clientId: client.id,
        name: n,
        domain,
        locationCode: 2840,
        languageCode: "en",
      },
    });
  const project = await mk("Main site", "acme.test");
  const second = await mk("Blog", "blog.acme.test");
  return {
    agency,
    owner: members[0]!.ctx,
    admin: members[1]!.ctx,
    member: members[2]!.ctx,
    project,
    second,
  };
}

async function keywords(agencyId: string, projectId: string, positions: (number | null)[]) {
  for (const [i, position] of positions.entries()) {
    await prisma.keyword.create({
      data: {
        agencyId,
        projectId,
        phrase: `keyword ${i}`,
        currentPosition: position,
        lastCheckedOn: day(today),
      },
    });
  }
}

describe("goals", () => {
  it("starts from today's number, refuses a duplicate and bad input", async () => {
    const s = await setup();
    await keywords(s.agency.id, s.project.id, [3, 8, 15, 40]);
    const created = await createGoal(s.member, s.project.id, { kind: "TOP10_KEYWORDS", target: 4 });
    const goal = await prisma.goal.findUniqueOrThrow({ where: { id: created.id } });
    expect(goal).toMatchObject({ startValue: 2, target: 4 });
    expect(await prisma.goalPoint.count({ where: { goalId: created.id } })).toBe(1);

    await expect(
      createGoal(s.member, s.project.id, { kind: "TOP10_KEYWORDS", target: 9 }),
    ).rejects.toThrow(ConflictError);
    await expect(
      createGoal(s.member, s.project.id, { kind: "AVG_POSITION", target: -1 }),
    ).rejects.toThrow(ValidationError);
    await expect(createGoal(s.member, s.project.id, { kind: "NOPE", target: 1 })).rejects.toThrow(
      ValidationError,
    );
    await expect(
      createGoal(s.member, s.project.id, { kind: "AVG_POSITION", target: 5, dueOn: "2026-02-31" }),
    ).rejects.toThrow(ValidationError);
  });

  it("stores positions in tenths and reports progress", async () => {
    const s = await setup();
    await keywords(s.agency.id, s.project.id, [10, 20]);
    const { id } = await createGoal(s.owner, s.project.id, { kind: "AVG_POSITION", target: 7.5 });
    const goal = await prisma.goal.findUniqueOrThrow({ where: { id } });
    expect(goal).toMatchObject({ target: 75, startValue: 150 });
    const [row] = await listGoals(s.owner, s.project.id);
    expect(row).toMatchObject({ kind: "AVG_POSITION", current: 150, percent: 0, forecast: null });
  });

  it("estimates from saved points and labels it as an estimate input", async () => {
    const s = await setup();
    await keywords(s.agency.id, s.project.id, [3]);
    const { id } = await createGoal(s.owner, s.project.id, {
      kind: "TOP10_KEYWORDS",
      target: 20,
      dueOn: "2099-01-01",
    });
    await prisma.goalPoint.deleteMany({ where: { goalId: id } });
    for (let i = 0; i < 6; i++) {
      await prisma.goalPoint.create({
        data: {
          agencyId: s.agency.id,
          goalId: id,
          on: new Date(Date.UTC(2026, 2, 1 + i)),
          value: 10 + i,
        },
      });
    }
    const [row] = await listGoals(s.owner, s.project.id);
    expect(row!.current).toBe(15);
    expect(row!.forecast?.perDay).toBe(1);
    expect(row!.onTrack).toBe(true);
    expect(row!.percent).toBeLessThan(100);
  });

  it("deletes with permission and only inside the agency", async () => {
    const s = await setup();
    const other = await setup("Other Agency");
    await keywords(s.agency.id, s.project.id, [3]);
    const { id } = await createGoal(s.owner, s.project.id, { kind: "TOP10_KEYWORDS", target: 4 });
    await expect(deleteGoal(s.member, s.project.id, id)).rejects.toThrow(ForbiddenError);
    await expect(deleteGoal(other.owner, other.project.id, id)).rejects.toThrow(NotFoundError);
    await expect(
      createGoal(other.owner, s.project.id, { kind: "HEALTH_SCORE", target: 90 }),
    ).rejects.toThrow(NotFoundError);
    await deleteGoal(s.owner, s.project.id, id);
    expect(await prisma.goal.count({ where: { id } })).toBe(0);
    await expect(listGoals({ ...s.owner, role: "CLIENT" }, s.project.id)).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe("daily goal points", () => {
  it("saves one point a day, fills the start value, and skips goals without data", async () => {
    const s = await setup();
    await keywords(s.agency.id, s.project.id, [3, 50]);
    const withData = await prisma.goal.create({
      data: { agencyId: s.agency.id, projectId: s.project.id, kind: "TOP10_KEYWORDS", target: 5 },
    });
    const noData = await prisma.goal.create({
      data: { agencyId: s.agency.id, projectId: s.project.id, kind: "CLICKS_28D", target: 500 },
    });
    const now = new Date();
    const first = await runGoalSnapshots({ db: prisma, now });
    expect(first.saved).toBeGreaterThanOrEqual(1);
    const again = await runGoalSnapshots({ db: prisma, now });
    expect(again.saved).toBe(0);
    expect(await prisma.goalPoint.count({ where: { goalId: withData.id } })).toBe(1);
    expect(await prisma.goalPoint.count({ where: { goalId: noData.id } })).toBe(0);
    expect((await prisma.goal.findUniqueOrThrow({ where: { id: withData.id } })).startValue).toBe(
      1,
    );

    await prisma.searchConsoleDay.create({
      data: {
        agencyId: s.agency.id,
        projectId: s.project.id,
        date: day(today),
        clicks: 40,
        impressions: 900,
        positionTenths: 80,
      },
    });
    await runGoalSnapshots({ db: prisma, now });
    const point = await prisma.goalPoint.findFirstOrThrow({ where: { goalId: noData.id } });
    expect(point.value).toBe(40);
  });
});

describe("timeline notes", () => {
  it("shows all-project notes on every project of the agency and nowhere else", async () => {
    const s = await setup();
    const other = await setup("Other Agency");
    await createAnnotation(s.member, s.project.id, {
      on: "2026-03-10",
      kind: "CAMPAIGN",
      title: "Spring offer launched",
    });
    await createAnnotation(s.member, s.project.id, {
      on: "2026-03-12",
      kind: "ALGORITHM",
      title: "March core update",
      allProjects: true,
    });
    expect((await listAnnotations(s.owner, s.project.id)).map((n) => n.title)).toEqual([
      "March core update",
      "Spring offer launched",
    ]);
    expect((await listAnnotations(s.owner, s.second.id)).map((n) => n.title)).toEqual([
      "March core update",
    ]);
    expect(await listAnnotations(other.owner, other.project.id)).toEqual([]);
  });

  it("validates, checks permission and the agency on delete", async () => {
    const s = await setup();
    const other = await setup("Other Agency");
    await expect(
      createAnnotation(s.member, s.project.id, { on: "2026-03-10", kind: "OTHER", title: "x" }),
    ).rejects.toThrow(ValidationError);
    await expect(
      createAnnotation(s.member, s.project.id, {
        on: "2026-13-10",
        kind: "OTHER",
        title: "Fine title",
      }),
    ).rejects.toThrow(ValidationError);
    await expect(
      createAnnotation({ ...s.member, role: "CLIENT" }, s.project.id, {
        on: "2026-03-10",
        kind: "OTHER",
        title: "Fine title",
      }),
    ).rejects.toThrow(ForbiddenError);
    const { id } = await createAnnotation(s.owner, s.project.id, {
      on: "2026-03-10",
      kind: "OTHER",
      title: "Fine title",
    });
    await expect(deleteAnnotation(s.member, id)).rejects.toThrow(ForbiddenError);
    await expect(deleteAnnotation(other.owner, id)).rejects.toThrow(NotFoundError);
    await deleteAnnotation(s.owner, id);
    expect(await listAnnotations(s.owner, s.project.id)).toEqual([]);
  });
});

describe("report templates", () => {
  it("saves, updates by name, lists and deletes inside one agency", async () => {
    const s = await setup();
    const other = await setup("Other Agency");
    const saved = await saveReportTemplate(s.member, {
      name: "Monthly",
      sections: ["summary", "goals"],
    });
    await saveReportTemplate(s.member, {
      name: "Monthly",
      sections: ["summary", "movers", "annotations"],
      notes: "Hello",
    });
    const list = await listReportTemplates(s.owner);
    expect(list).toEqual([
      {
        id: saved.id,
        name: "Monthly",
        sections: ["summary", "movers", "annotations"],
        notes: "Hello",
      },
    ]);
    expect(await listReportTemplates(other.owner)).toEqual([]);
    await expect(deleteReportTemplate(other.owner, saved.id)).rejects.toThrow(NotFoundError);
    await expect(saveReportTemplate(s.owner, { name: "Bad", sections: ["nope"] })).rejects.toThrow(
      ValidationError,
    );
    await expect(saveReportTemplate(s.owner, { name: "Empty", sections: [] })).rejects.toThrow(
      ValidationError,
    );
    await deleteReportTemplate(s.owner, saved.id);
    expect(await listReportTemplates(s.owner)).toEqual([]);
  });
});

describe("performance summary", () => {
  it("lists every project of the agency with its numbers and nothing from another agency", async () => {
    const s = await setup();
    const other = await setup("Other Agency");
    await keywords(s.agency.id, s.project.id, [2, 30]);
    await prisma.task.create({
      data: {
        agencyId: s.agency.id,
        projectId: s.project.id,
        title: "Late task",
        dueOn: day("2020-01-01"),
        createdById: s.owner.userId,
      },
    });
    const page = await listPerformance(s.owner, { page: 1, pageSize: 10 });
    expect(page.total).toBe(2);
    const main = page.rows.find((r) => r.projectId === s.project.id)!;
    expect(main).toMatchObject({
      keywords: 2,
      top10: 1,
      averagePosition: 16,
      openTasks: 1,
      overdueTasks: 1,
      clicks28d: null,
    });
    expect(page.rows.map((r) => r.projectId)).not.toContain(other.project.id);
    await expect(listPerformance({ ...s.owner, role: "CLIENT" })).rejects.toThrow(ForbiddenError);
  });
});

describe("report extras", () => {
  it("adds comparison, notes, goals and data labels, and keeps the platform name out", async () => {
    const s = await setup();
    const agencyId = s.agency.id;
    const kw = await prisma.keyword.create({
      data: {
        agencyId,
        projectId: s.project.id,
        phrase: "blue shoes",
        lastCheckedOn: day("2026-03-29"),
        currentPosition: 4,
      },
    });
    for (const [date, position] of [
      ["2026-02-01", 30],
      ["2026-02-15", 25],
      ["2026-03-01", 20],
      ["2026-03-15", 8],
      ["2026-03-29", 4],
    ] as const) {
      await prisma.rankCheck.create({
        data: {
          agencyId,
          keywordId: kw.id,
          date: day(date),
          position,
          rankingUrl: "https://acme.test/",
          provider: "mock",
        },
      });
    }
    const goal = await prisma.goal.create({
      data: { agencyId, projectId: s.project.id, kind: "TOP10_KEYWORDS", target: 5, startValue: 0 },
    });
    await prisma.goalPoint.create({
      data: { agencyId, goalId: goal.id, on: day("2026-03-29"), value: 1 },
    });
    await prisma.annotation.create({
      data: {
        agencyId,
        projectId: null,
        on: day("2026-03-12"),
        kind: "ALGORITHM",
        title: "March core update",
      },
    });
    await prisma.annotation.create({
      data: {
        agencyId,
        projectId: s.project.id,
        on: day("2026-01-05"),
        kind: "CAMPAIGN",
        title: "Outside the period",
      },
    });

    const { id } = await createReport(
      s.owner,
      {
        projectId: s.project.id,
        period: "custom",
        start: "2026-03-01",
        end: "2026-03-30",
        sections: ["summary", "goals", "annotations"],
      },
      { now: new Date("2026-03-31T12:00:00Z"), enqueue: async () => undefined },
    );
    expect(await generateReport(agencyId, id)).toEqual({ status: "READY" });
    const model = (await getReport(s.owner, id)).model!;

    expect(model.previous).toMatchObject({ checked: 1, top10: 0 });
    expect(model.kpis).toMatchObject({ top10: 1 });
    expect(model.annotations).toEqual([
      { on: "2026-03-12", kind: "ALGORITHM", title: "March core update" },
    ]);
    expect(model.goals).toEqual([
      expect.objectContaining({
        label: "Keywords in the top 10",
        current: "1",
        target: "5",
        percent: 20,
      }),
    ]);
    expect(model.sources).toEqual([{ label: "Rankings", updated: "2026-03-29", real: false }]);

    const pdf = await readReportPdf(s.owner, id);
    const { text } = readPdf(pdf!.bytes);
    expect(text).toContain("Keywords in the top 10: 1 (up 1 on the period before).");
    expect(text).toContain("Keywords in the top 10: 1 of 5 (20%)");
    expect(text).toContain("Google update, March core update");
    expect(text).not.toContain("Outside the period");
    expect(text).toContain("Rankings: updated 2026-03-29, sample data");
  });
});
