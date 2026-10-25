import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { runReportDispatcher } from "@/server/jobs/system/report-dispatcher";
import { SmtpEmailProvider } from "@/server/providers/email/smtp";
import type { EmailMessage } from "@/server/providers/email/types";
import {
  ConflictError,
  ForbiddenError,
  LimitExceededError,
  NotFoundError,
  ValidationError,
} from "@/server/services/errors";
import { deliverScheduledReport } from "@/server/services/report-delivery";
import { getStorage } from "@/server/providers/storage";
import { generateReport } from "@/server/services/report-generator";
import {
  createSchedule,
  deleteSchedule,
  listSchedules,
  setScheduleEnabled,
  updateSchedule,
} from "@/server/services/report-schedules";
import { createAgencyWithMembers, seedPlans } from "../factories";
import { createTestClient, resetDb } from "../helpers/db";
import { clearMail, waitForEmail } from "../helpers/mailpit";

const prisma = createTestClient();
const queued: { reportId: string; agencyId: string }[] = [];
const enqueue = async (data: { reportId: string; agencyId: string }) => void queued.push(data);
const smtp = new SmtpEmailProvider({
  host: "localhost",
  port: 1025,
  from: "Platform <p@localhost>",
});
const send = async (message: EmailMessage) => smtp.send(message);

const input = (projectId: string, extra: object = {}) => ({
  projectId,
  frequency: "WEEKLY",
  dayOfWeek: 1,
  hour: 8,
  recipients: ["client@example.test"],
  sections: ["summary", "rankings"],
  ...extra,
});

async function setup(plan = "STARTER") {
  const { agency, members } = await createAgencyWithMembers(
    prisma,
    ["OWNER", "MEMBER"],
    "Original Agency",
    plan,
  );
  await prisma.branding.create({
    data: {
      agencyId: agency.id,
      displayName: "Bright Studio",
      supportEmail: "help@bright.example",
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
  const keyword = await prisma.keyword.create({
    data: { agencyId: agency.id, projectId: project.id, phrase: "blue shoes" },
  });
  for (const [date, position] of [
    ["2026-03-02", 9],
    ["2026-03-09", 4],
  ] as const) {
    await prisma.rankCheck.create({
      data: {
        agencyId: agency.id,
        keywordId: keyword.id,
        date: new Date(`${date}T00:00:00Z`),
        position,
        provider: "mock",
      },
    });
  }
  return { agency, owner: members[0]!, member: members[1]!, project };
}

beforeEach(async () => {
  await resetDb(prisma);
  await seedPlans(prisma);
  queued.length = 0;
  await clearMail();
});
afterAll(async () => {
  await prisma.$disconnect();
});

// Tuesday 2026-03-10 09:00 UTC.
const now = new Date("2026-03-10T09:00:00Z");

describe("schedule rules", () => {
  it("creates one schedule per project with the next run time in the agency time zone", async () => {
    const { owner, project, agency } = await setup();
    await prisma.agency.update({ where: { id: agency.id }, data: { timezone: "Asia/Kolkata" } });
    const { id } = await createSchedule(owner.ctx, input(project.id), now);
    const row = await prisma.reportSchedule.findUniqueOrThrow({ where: { id } });
    // Next Monday 08:00 in Kolkata.
    expect(row.nextRunAt.toISOString()).toBe("2026-03-16T02:30:00.000Z");
    await expect(createSchedule(owner.ctx, input(project.id), now)).rejects.toThrow(ConflictError);
  });

  it("checks permission, input and ownership", async () => {
    const a = await setup();
    const b = await setup();
    await expect(
      createSchedule({ ...a.owner.ctx, role: "CLIENT" }, input(a.project.id), now),
    ).rejects.toThrow(ForbiddenError);
    await expect(createSchedule(a.owner.ctx, input(b.project.id), now)).rejects.toThrow(
      NotFoundError,
    );
    await expect(
      createSchedule(a.owner.ctx, input(a.project.id, { recipients: [] }), now),
    ).rejects.toThrow(ValidationError);
    await expect(
      createSchedule(a.owner.ctx, input(a.project.id, { recipients: ["nope"] }), now),
    ).rejects.toThrow(ValidationError);
    const bad = await createSchedule(
      a.owner.ctx,
      input(a.project.id, { frequency: "MONTHLY", dayOfMonth: 31 }),
      now,
    ).catch((e: unknown) => e);
    expect(bad).toBeInstanceOf(ValidationError);
    expect((bad as ValidationError).fieldErrors?.dayOfMonth).toMatch(/1 to 28/);
  });

  it("stops at the plan limit", async () => {
    const { owner, agency } = await setup();
    for (let i = 0; i < 5; i++) {
      const client = await prisma.client.create({ data: { agencyId: agency.id, name: `C${i}` } });
      const p = await prisma.project.create({
        data: {
          agencyId: agency.id,
          clientId: client.id,
          name: `P${i}`,
          domain: `p${i}.test`,
          locationCode: 2840,
          languageCode: "en",
        },
      });
      await createSchedule(owner.ctx, input(p.id), now);
    }
    const client = await prisma.client.create({ data: { agencyId: agency.id, name: "Extra" } });
    const extra = await prisma.project.create({
      data: {
        agencyId: agency.id,
        clientId: client.id,
        name: "Extra",
        domain: "extra.test",
        locationCode: 2840,
        languageCode: "en",
      },
    });
    await expect(createSchedule(owner.ctx, input(extra.id), now)).rejects.toThrow(
      LimitExceededError,
    );
    expect((await listSchedules(owner.ctx, { pageSize: 3 })).items).toHaveLength(3);
  });

  it("updates, pauses, resumes and deletes", async () => {
    const { owner, project } = await setup();
    const { id } = await createSchedule(owner.ctx, input(project.id), now);
    await updateSchedule(
      owner.ctx,
      id,
      input(project.id, { frequency: "MONTHLY", dayOfMonth: 15, hour: 6 }),
      now,
    );
    expect(
      (await prisma.reportSchedule.findUniqueOrThrow({ where: { id } })).nextRunAt.toISOString(),
    ).toBe("2026-03-15T06:00:00.000Z");
    await setScheduleEnabled(owner.ctx, { scheduleId: id, enabled: false }, now);
    expect((await prisma.reportSchedule.findUniqueOrThrow({ where: { id } })).enabled).toBe(false);
    await deleteSchedule(owner.ctx, { scheduleId: id });
    await expect(deleteSchedule(owner.ctx, { scheduleId: id })).rejects.toThrow(NotFoundError);
  });
});

describe("dispatcher", () => {
  it("makes a report and an email once per run, and never twice", async () => {
    const { owner, project, agency } = await setup();
    const { id } = await createSchedule(
      owner.ctx,
      input(project.id),
      new Date("2026-03-02T09:00:00Z"),
    );
    // Created on Monday 2 March after 08:00, so the first run is Monday 9 March 08:00 UTC.
    const afterRun = new Date("2026-03-09T08:05:00Z");

    expect(
      await runReportDispatcher({ db: prisma, now: new Date("2026-03-09T07:59:00Z"), enqueue }),
    ).toEqual({ due: 0, created: 0 });
    expect(await runReportDispatcher({ db: prisma, now: afterRun, enqueue })).toEqual({
      due: 1,
      created: 1,
    });
    // Running again (another tick, or two workers) does nothing more.
    expect(await runReportDispatcher({ db: prisma, now: afterRun, enqueue })).toEqual({
      due: 0,
      created: 0,
    });
    expect(queued).toHaveLength(1);

    const schedule = await prisma.reportSchedule.findUniqueOrThrow({ where: { id } });
    expect(schedule.nextRunAt.toISOString()).toBe("2026-03-16T08:00:00.000Z");
    expect(schedule.lastRunAt?.toISOString()).toBe(afterRun.toISOString());

    const report = await prisma.report.findFirstOrThrow({ where: { scheduleId: id } });
    expect(report.createdById).toBeNull();
    expect(report.scheduledFor?.toISOString()).toBe("2026-03-09T08:00:00.000Z");
    // Weekly reports cover the last 7 days up to the run day.
    expect([
      report.periodStart.toISOString().slice(0, 10),
      report.periodEnd.toISOString().slice(0, 10),
    ]).toEqual(["2026-03-03", "2026-03-09"]);

    // The worker builds it, then sends the email.
    expect(await generateReport(agency.id, report.id, { send })).toEqual({ status: "READY" });
    const mail = await waitForEmail("client@example.test", /Main site report/);
    expect(mail.FromName).toBe("Bright Studio");
    expect(mail.ReplyTo?.map((r) => r.Address)).toEqual(["help@bright.example"]);
    expect(mail.Attachments).toHaveLength(1);
    expect(mail.Attachments![0]).toMatchObject({ ContentType: "application/pdf" });
    expect(mail.Attachments![0]!.FileName).toMatch(/\.pdf$/);
    expect(mail.Attachments![0]!.Size).toBeGreaterThan(1500);
    expect(mail.HTML).toContain("Bright Studio");
    expect(mail.HTML).not.toContain("SEO Platform");
    expect(mail.Text).not.toContain("SEO Platform");

    // A second run of the job (retry) does not send again.
    await clearMail();
    await generateReport(agency.id, report.id, { send });
    const list = (await (await fetch("http://localhost:8025/api/v1/messages")).json()) as {
      total: number;
    };
    expect(list.total).toBe(0);
    const row = await prisma.report.findUniqueOrThrow({ where: { id: report.id } });
    expect(row.deliveredAt).not.toBeNull();
  });

  it("sends one report after a long pause, not one per missed run", async () => {
    const { owner, project } = await setup();
    const { id } = await createSchedule(
      owner.ctx,
      input(project.id),
      new Date("2026-03-02T09:00:00Z"),
    );
    const later = new Date("2026-04-20T12:00:00Z");
    expect(await runReportDispatcher({ db: prisma, now: later, enqueue })).toEqual({
      due: 1,
      created: 1,
    });
    expect(await runReportDispatcher({ db: prisma, now: later, enqueue })).toEqual({
      due: 0,
      created: 0,
    });
    const schedule = await prisma.reportSchedule.findUniqueOrThrow({ where: { id } });
    expect(schedule.nextRunAt.toISOString()).toBe("2026-04-27T08:00:00.000Z");
  });

  it("skips paused schedules, archived clients and inactive agencies", async () => {
    const { owner, project, agency } = await setup();
    const { id } = await createSchedule(
      owner.ctx,
      input(project.id),
      new Date("2026-03-02T09:00:00Z"),
    );
    const later = new Date("2026-03-10T00:00:00Z");
    await prisma.reportSchedule.update({ where: { id }, data: { enabled: false } });
    expect((await runReportDispatcher({ db: prisma, now: later, enqueue })).due).toBe(0);
    await prisma.reportSchedule.update({ where: { id }, data: { enabled: true } });
    await prisma.agency.update({ where: { id: agency.id }, data: { status: "SUSPENDED" } });
    expect((await runReportDispatcher({ db: prisma, now: later, enqueue })).due).toBe(0);
    await prisma.agency.update({ where: { id: agency.id }, data: { status: "ACTIVE" } });
    expect((await runReportDispatcher({ db: prisma, now: later, enqueue })).due).toBe(1);
  });

  it("uses the last month for monthly schedules", async () => {
    const { owner, project } = await setup();
    await createSchedule(
      owner.ctx,
      input(project.id, { frequency: "MONTHLY", dayOfMonth: 5, hour: 7 }),
      new Date("2026-03-01T00:00:00Z"),
    );
    await runReportDispatcher({ db: prisma, now: new Date("2026-03-05T07:10:00Z"), enqueue });
    const report = await prisma.report.findFirstOrThrow({ where: { projectId: project.id } });
    expect([
      report.periodStart.toISOString().slice(0, 10),
      report.periodEnd.toISOString().slice(0, 10),
    ]).toEqual(["2026-02-01", "2026-02-28"]);
  });
});

describe("delivery of big reports", () => {
  it("sends a link instead of the PDF when the PDF is over 5 MB", async () => {
    const { owner, project, agency } = await setup();
    await createSchedule(owner.ctx, input(project.id), new Date("2026-03-02T09:00:00Z"));
    await runReportDispatcher({ db: prisma, now: new Date("2026-03-09T08:05:00Z"), enqueue });
    const report = await prisma.report.findFirstOrThrow({ where: { projectId: project.id } });
    const sent: EmailMessage[] = [];
    await generateReport(agency.id, report.id, { send: async (m) => void sent.push(m) });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.attachments).toHaveLength(1);
    expect(sent[0]!.html).not.toContain("/r/");

    // Same report, but now the stored PDF is 6 MB.
    await prisma.report.update({ where: { id: report.id }, data: { deliveredAt: null } });
    const key = (await prisma.report.findUniqueOrThrow({ where: { id: report.id } })).pdfKey!;
    await getStorage().put(key, Buffer.alloc(6 * 1024 * 1024, 1), "application/pdf");
    sent.length = 0;
    await deliverScheduledReport(agency.id, report.id, { send: async (m) => void sent.push(m) });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.attachments).toBeUndefined();
    expect(sent[0]!.html).toMatch(/\/r\/[A-Za-z0-9_-]{16,}/);
    const after = await prisma.report.findUniqueOrThrow({ where: { id: report.id } });
    expect(after.shareToken).not.toBeNull();
    expect(after.shareExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });
});
