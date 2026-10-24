import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getEnv } from "@/env";
import { db } from "@/server/db/client";
import { getStorage } from "@/server/providers/storage";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/server/services/errors";
import { generateReport } from "@/server/services/report-generator";
import {
  createReport,
  deleteReport,
  getReport,
  listReports,
  readReportPdf,
  revokeShare,
  shareReport,
} from "@/server/services/reports";
import { getSharedReport, readSharedLogo, readSharedPdf } from "@/server/services/shared-reports";
import { createAgencyWithMembers } from "../factories";
import { createTestClient, resetDb } from "../helpers/db";
import { readPdf } from "../helpers/pdf-text";

const prisma = createTestClient();
const now = new Date("2026-03-31T12:00:00Z");
const queued: { reportId: string; agencyId: string }[] = [];
const enqueue = async (data: { reportId: string; agencyId: string }) => void queued.push(data);

const base = {
  period: "custom" as const,
  start: "2026-03-01",
  end: "2026-03-30",
  sections: [
    "summary",
    "distribution",
    "movers",
    "rankings",
    "audit",
    "issues",
    "opportunities",
    "notes",
  ],
  notes: "Thanks for a great month.",
};

async function setup() {
  const { agency, members } = await createAgencyWithMembers(
    prisma,
    ["OWNER", "ADMIN", "MEMBER"],
    "Original Agency",
  );
  await prisma.branding.create({
    data: {
      agencyId: agency.id,
      displayName: "Bright Studio",
      primaryColor: "#112233",
      accentColor: "#ABCDEF",
    },
  });
  const client = await prisma.client.create({ data: { agencyId: agency.id, name: "Acme Dental" } });
  const project = await prisma.project.create({
    data: {
      agencyId: agency.id,
      clientId: client.id,
      name: "Main site",
      domain: "acme.test",
      locationCode: 2840,
      languageCode: "en",
    },
  });
  const phrases: [string, (number | null)[]][] = [
    ["blue shoes", [9, 5, 3]],
    ["red shoes", [4, 8, 12]],
    ["green shoes", [null, null, 15]],
  ];
  for (const [phrase, positions] of phrases) {
    const keyword = await prisma.keyword.create({
      data: { agencyId: agency.id, projectId: project.id, phrase },
    });
    const dates = ["2026-03-01", "2026-03-15", "2026-03-29"];
    for (const [i, date] of dates.entries()) {
      await prisma.rankCheck.create({
        data: {
          agencyId: agency.id,
          keywordId: keyword.id,
          date: new Date(`${date}T00:00:00Z`),
          position: positions[i] ?? null,
          rankingUrl: `https://acme.test/${phrase.replace(" ", "-")}`,
          provider: "mock",
        },
      });
    }
  }
  const audit = await prisma.audit.create({
    data: {
      agencyId: agency.id,
      projectId: project.id,
      status: "COMPLETED",
      maxPages: 50,
      pagesCrawled: 20,
      healthScore: 82,
      counts: { critical: 1, warning: 2, notice: 0, byCode: {} },
      finishedAt: new Date("2026-03-20T10:00:00Z"),
    },
  });
  await prisma.auditIssue.createMany({
    data: [
      {
        agencyId: agency.id,
        auditId: audit.id,
        code: "missing_title",
        severity: "CRITICAL",
        url: "https://acme.test/a",
      },
      {
        agencyId: agency.id,
        auditId: audit.id,
        code: "duplicate_title",
        severity: "WARNING",
        url: "https://acme.test/b",
      },
    ],
  });
  return { agency, owner: members[0]!, admin: members[1]!, member: members[2]!, project };
}

beforeAll(async () => {
  await resetDb(prisma);
});
beforeEach(() => {
  queued.length = 0;
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("creating a report", () => {
  it("saves a queued report and queues the job", async () => {
    const { agency, owner, project } = await setup();
    const report = await createReport(
      owner.ctx,
      { ...base, projectId: project.id },
      { now, enqueue },
    );
    expect(queued).toEqual([{ reportId: report.id, agencyId: agency.id }]);
    const row = await getReport(owner.ctx, report.id);
    expect(row).toMatchObject({ status: "QUEUED", model: null });
    expect(row.title).toBe("Main site report, 1 Mar 2026 to 30 Mar 2026");
    expect(row.sections).toContain("movers");
  });

  it("refuses bad dates and empty section lists with plain messages", async () => {
    const { owner, project } = await setup();
    const make = (extra: object) =>
      createReport(owner.ctx, { ...base, projectId: project.id, ...extra }, { now, enqueue });
    await expect(make({ start: "2026-03-30", end: "2026-03-01" })).rejects.toThrow(ValidationError);
    await expect(make({ end: "2026-04-15" })).rejects.toThrow(/future/);
    await expect(make({ sections: [] })).rejects.toThrow(ValidationError);
    expect(queued).toHaveLength(0);
  });

  it("only team members with permission can create, and only for their own projects", async () => {
    const { owner, project } = await setup();
    const other = await setup();
    await expect(
      createReport(owner.ctx, { ...base, projectId: other.project.id }, { now, enqueue }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      createReport(
        { ...owner.ctx, role: "CLIENT" },
        { ...base, projectId: project.id },
        { now, enqueue },
      ),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("generating a report", () => {
  it("builds a PDF with the agency name and never the platform name", async () => {
    const { owner, project } = await setup();
    const { id } = await createReport(
      owner.ctx,
      { ...base, projectId: project.id },
      { now, enqueue },
    );
    expect(await generateReport(owner.ctx.agencyId, id)).toEqual({ status: "READY" });

    const report = await getReport(owner.ctx, id);
    expect(report.status).toBe("READY");
    expect(report.model?.kpis).toMatchObject({ tracked: 3, top3: 1, top10: 1 });
    expect(report.model?.summary).toContain("acme.test");

    const pdf = await readReportPdf(owner.ctx, id);
    expect(pdf).not.toBeNull();
    expect(pdf!.bytes.length).toBeGreaterThan(1500);
    expect(pdf!.bytes.subarray(0, 5).toString()).toBe("%PDF-");
    const { text, raw } = readPdf(pdf!.bytes);
    expect(text).toContain("Bright Studio");
    expect(text).toContain("Acme Dental");
    expect(text).toContain("blue shoes");
    expect(text).toContain("Thanks for a great month.");
    const appName = getEnv().APP_NAME;
    expect(text).not.toContain(appName);
    expect(raw).not.toContain(appName);
    expect(raw).not.toContain("react-pdf");
  });

  it("works for a project with no keywords and no audit", async () => {
    const { owner } = await setup();
    const client = await prisma.client.create({
      data: { agencyId: owner.ctx.agencyId, name: "Empty" },
    });
    const project = await prisma.project.create({
      data: {
        agencyId: owner.ctx.agencyId,
        clientId: client.id,
        name: "Empty site",
        domain: "empty.test",
        locationCode: 2840,
        languageCode: "en",
      },
    });
    const { id } = await createReport(
      owner.ctx,
      { ...base, projectId: project.id },
      { now, enqueue },
    );
    expect((await generateReport(owner.ctx.agencyId, id)).status).toBe("READY");
    const { text } = readPdf((await readReportPdf(owner.ctx, id))!.bytes);
    expect(text).toContain("none have been checked yet");
    expect(text).toContain("No keywords are tracked yet.");
  });

  it("marks the report failed on the last attempt and rethrows before that", async () => {
    const { owner, project } = await setup();
    const { id } = await createReport(
      owner.ctx,
      { ...base, projectId: project.id },
      { now, enqueue },
    );
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    // The report row is gone with the project (cascade), so generation is skipped quietly.
    expect(await generateReport(owner.ctx.agencyId, id)).toEqual({ status: "SKIPPED" });
  });

  it("uses data only up to the last day of the period", async () => {
    const { owner, project } = await setup();
    const { id } = await createReport(
      owner.ctx,
      { ...base, projectId: project.id, end: "2026-03-10" },
      { now, enqueue },
    );
    await generateReport(owner.ctx.agencyId, id);
    const report = await getReport(owner.ctx, id);
    const blue = report.model!.rankings.find((r) => r.phrase === "blue shoes")!;
    expect(blue).toMatchObject({ position: 9, startPosition: null });
  });
});

describe("sharing and access", () => {
  it("shares, renews and revokes a link", async () => {
    const { owner, project } = await setup();
    const { id } = await createReport(
      owner.ctx,
      { ...base, projectId: project.id },
      { now, enqueue },
    );
    await expect(shareReport(owner.ctx, { reportId: id, days: 7 }, now)).rejects.toThrow(
      ConflictError,
    );
    await generateReport(owner.ctx.agencyId, id);

    const first = await shareReport(owner.ctx, { reportId: id, days: 7 }, now);
    expect(first.shareToken.length).toBeGreaterThanOrEqual(24);
    expect(first.shareExpiresAt.toISOString()).toBe("2026-04-07T12:00:00.000Z");
    const renewed = await shareReport(owner.ctx, { reportId: id, days: 30 }, now);
    expect(renewed.shareToken).toBe(first.shareToken);
    expect(renewed.shareExpiresAt.toISOString()).toBe("2026-04-30T12:00:00.000Z");

    await revokeShare(owner.ctx, id);
    expect(await prisma.report.findUnique({ where: { id }, select: { shareToken: true } })).toEqual(
      { shareToken: null },
    );
    const again = await shareReport(owner.ctx, { reportId: id, days: 7 }, now);
    expect(again.shareToken).not.toBe(first.shareToken);
  });

  it("keeps reports private to the agency and lists them in pages", async () => {
    const a = await setup();
    const b = await setup();
    const { id } = await createReport(
      a.owner.ctx,
      { ...base, projectId: a.project.id },
      { now, enqueue },
    );
    await expect(getReport(b.owner.ctx, id)).rejects.toThrow(NotFoundError);
    await expect(deleteReport(b.owner.ctx, id)).rejects.toThrow(NotFoundError);
    await expect(revokeShare(b.owner.ctx, id)).rejects.toThrow(NotFoundError);
    await expect(shareReport(b.owner.ctx, { reportId: id, days: 7 }, now)).rejects.toThrow(
      NotFoundError,
    );
    expect((await listReports(b.owner.ctx)).total).toBe(0);
    for (let i = 0; i < 3; i++)
      await createReport(a.owner.ctx, { ...base, projectId: a.project.id }, { now, enqueue });
    const page = await listReports(a.owner.ctx, { pageSize: 2 });
    expect(page).toMatchObject({ total: 4, page: 1, pageSize: 2 });
    expect(page.items).toHaveLength(2);
  });

  it("deletes the report and its PDF", async () => {
    const { owner, project } = await setup();
    const { id } = await createReport(
      owner.ctx,
      { ...base, projectId: project.id },
      { now, enqueue },
    );
    await generateReport(owner.ctx.agencyId, id);
    const key = (await prisma.report.findUniqueOrThrow({ where: { id } })).pdfKey!;
    expect(await getStorage().get(key)).not.toBeNull();
    await deleteReport(owner.ctx, id);
    expect(await getStorage().get(key)).toBeNull();
    expect(await db.report.count({ where: { agencyId: owner.ctx.agencyId, id } })).toBe(0);
  });
});

describe("public share links", () => {
  async function readyReport() {
    const ctx = await setup();
    const { id } = await createReport(
      ctx.owner.ctx,
      { ...base, projectId: ctx.project.id },
      { now, enqueue },
    );
    await generateReport(ctx.owner.ctx.agencyId, id);
    return { ...ctx, id };
  }

  it("opens with a valid token, with the agency branding and PDF", async () => {
    const { owner, id } = await readyReport();
    const { shareToken } = await shareReport(owner.ctx, { reportId: id, days: 7 }, now);
    const shared = await getSharedReport(shareToken, new Date("2026-04-02T00:00:00Z"));
    expect(shared).not.toBeNull();
    expect(shared!.branding.displayName).toBe("Bright Studio");
    expect(shared!.model.kpis.tracked).toBe(3);
    expect((await readSharedPdf(shared!))!.subarray(0, 5).toString()).toBe("%PDF-");
    expect(await readSharedLogo(shared!)).toBeNull();
  });

  it("returns nothing for an expired, revoked, unknown or badly shaped token", async () => {
    const { owner, id } = await readyReport();
    const { shareToken } = await shareReport(owner.ctx, { reportId: id, days: 7 }, now);
    expect(await getSharedReport(shareToken, new Date("2026-04-08T00:00:00Z"))).toBeNull();
    expect(await getSharedReport(shareToken, new Date("2026-04-07T11:59:00Z"))).not.toBeNull();
    expect(await getSharedReport("x".repeat(32))).toBeNull();
    expect(await getSharedReport("short")).toBeNull();
    expect(await getSharedReport("../../etc/passwd")).toBeNull();
    await revokeShare(owner.ctx, id);
    expect(await getSharedReport(shareToken, new Date("2026-04-01T00:00:00Z"))).toBeNull();
  });
});
