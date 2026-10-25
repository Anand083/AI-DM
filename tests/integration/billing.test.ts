import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as webhookRoute } from "@/app/api/webhooks/billing/route";
import { POST as advanceRoute } from "@/app/api/dev/billing/advance/route";
import { runBillingTick } from "@/server/jobs/system/billing-tick";
import { runRankCheckScheduler } from "@/server/jobs/system/scheduler";
import { runReportDispatcher } from "@/server/jobs/system/report-dispatcher";
import { getMockBilling } from "@/server/providers/billing";
import {
  cancelSubscription,
  changePlan,
  completeMockCheckout,
  downgradeBlockers,
  getBillingSummary,
  getMockCheckout,
  listInvoices,
  resumeSubscription,
  startCheckout,
} from "@/server/services/billing";
import { createAudit } from "@/server/services/audits";
import {
  ConflictError,
  ForbiddenError,
  LimitExceededError,
  NotFoundError,
} from "@/server/services/errors";
import { createReport } from "@/server/services/reports";
import { createAgencyWithMembers, seedPlans } from "../factories";
import { createTestClient, resetDb } from "../helpers/db";

vi.mock("@/server/services/email", async (original) => {
  const real = await original<typeof import("@/server/services/email")>();
  return { ...real, sendBillingNoticeEmail: vi.fn(async () => undefined) };
});

import { sendBillingNoticeEmail } from "@/server/services/email";

const prisma = createTestClient();
const now = new Date("2026-03-10T12:00:00Z");
const day = (n: number) => new Date(now.getTime() + n * 86_400_000);

async function setup(
  opts: {
    status?: "TRIALING" | "ACTIVE" | "PAST_DUE" | "EXPIRED" | "CANCELED";
    plan?: string;
  } = {},
) {
  const { agency, members } = await createAgencyWithMembers(
    prisma,
    ["OWNER", "ADMIN"],
    "Agency One",
  );
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: opts.plan ?? "STARTER" } });
  const status = opts.status ?? "TRIALING";
  await prisma.subscription.create({
    data: {
      agencyId: agency.id,
      planId: plan.id,
      status,
      trialEndsAt: status === "TRIALING" ? day(10) : null,
      currentPeriodStart: status === "TRIALING" ? null : day(-20),
      currentPeriodEnd: status === "TRIALING" ? null : day(10),
      graceEndsAt: status === "PAST_DUE" ? day(5) : null,
    },
  });
  const slug = (await prisma.agency.findUniqueOrThrow({ where: { id: agency.id } })).slug;
  return { agency, owner: members[0]!, admin: members[1]!, slug };
}

function send(
  agencyId: string,
  type: string,
  extra: object = {},
  id = `evt_${Math.random()}`,
  tamper = false,
) {
  const { body, signature } = getMockBilling().signWebhook({
    id,
    type: type as "checkout.completed",
    agencyId,
    occurredAt: now,
    ...extra,
  });
  return webhookRoute(
    new Request("http://app.test/api/webhooks/billing", {
      method: "POST",
      headers: { "x-mock-billing-signature": tamper ? "0".repeat(64) : signature },
      body,
    }),
  );
}

const ctxOf = (agencyId: string) => ({ userId: "x", agencyId, role: "OWNER" as const });
const sub = (agencyId: string) =>
  prisma.subscription.findFirstOrThrow({ where: { agencyId }, include: { plan: true } });

beforeEach(async () => {
  await resetDb(prisma);
  await seedPlans(prisma);
  vi.mocked(sendBillingNoticeEmail).mockClear();
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("webhook", () => {
  it("rejects a bad signature and stores nothing", async () => {
    const { agency } = await setup();
    const res = await send(
      agency.id,
      "checkout.completed",
      { planCode: "GROWTH", interval: "MONTH" },
      "evt_bad",
      true,
    );
    expect(res.status).toBe(400);
    expect(await prisma.billingEvent.count()).toBe(0);
    expect((await sub(agency.id)).status).toBe("TRIALING");
    const garbage = await webhookRoute(
      new Request("http://app.test/x", { method: "POST", body: "not json" }),
    );
    expect(garbage.status).toBe(400);
  });

  it("processes the same event once, even when sent twice", async () => {
    const { agency } = await setup();
    const first = await send(
      agency.id,
      "checkout.completed",
      { planCode: "GROWTH", interval: "MONTH" },
      "evt_same",
    );
    expect(await first.json()).toEqual({ status: "processed" });
    const again = await send(
      agency.id,
      "checkout.completed",
      { planCode: "GROWTH", interval: "MONTH" },
      "evt_same",
    );
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ status: "duplicate" });
    expect(await prisma.billingEvent.count({ where: { eventId: "evt_same" } })).toBe(1);
    expect(await prisma.invoice.count({ where: { agencyId: agency.id } })).toBe(1);
    const s = await sub(agency.id);
    expect(s).toMatchObject({ status: "ACTIVE", trialEndsAt: null });
    expect(s.plan.code).toBe("GROWTH");
    expect((await listInvoices((await setup()).owner.ctx)).items).toEqual([]);
    expect((await listInvoices({ ...ctxOf(agency.id) })).items).toHaveLength(1);
  });

  it("starts the grace period on a failed payment and recovers on a late one", async () => {
    const { agency } = await setup({ status: "ACTIVE", plan: "GROWTH" });
    await send(agency.id, "payment.failed");
    let s = await sub(agency.id);
    expect(s.status).toBe("PAST_DUE");
    expect(s.graceEndsAt).not.toBeNull();
    expect(sendBillingNoticeEmail).toHaveBeenCalledTimes(1); // one owner
    expect(
      (await prisma.invoice.findMany({ where: { agencyId: agency.id } })).map((i) => i.status),
    ).toEqual(["FAILED"]);
    await send(agency.id, "payment.succeeded");
    s = await sub(agency.id);
    expect(s).toMatchObject({ status: "ACTIVE", graceEndsAt: null });
  });

  it("keeps a record of an event for an unknown agency without failing", async () => {
    const res = await send("does-not-exist", "payment.failed", {}, "evt_unknown");
    expect(res.status).toBe(200);
    expect(
      await prisma.billingEvent.findUnique({ where: { eventId: "evt_unknown" } }),
    ).toMatchObject({ agencyId: null });
  });

  it("records, but does not apply, an event the rules refuse", async () => {
    const { agency } = await setup({ status: "EXPIRED" });
    const res = await send(agency.id, "payment.succeeded", {}, "evt_ignored");
    expect(res.status).toBe(200);
    expect((await sub(agency.id)).status).toBe("EXPIRED");
  });
});

describe("mock checkout", () => {
  it("pays through a signed webhook and upgrades the plan", async () => {
    const { owner, agency } = await setup();
    const { sessionId } = await startCheckout(owner.ctx, { planCode: "GROWTH", interval: "YEAR" });
    expect((await getMockCheckout(owner.ctx, sessionId)).amountCents).toBe(149000);
    const post = async (_url: string, body: string, signature: string) =>
      webhookRoute(
        new Request("http://app.test/api/webhooks/billing", {
          method: "POST",
          headers: { "x-mock-billing-signature": signature },
          body,
        }),
      );
    expect(await completeMockCheckout(owner.ctx, sessionId, "pay", post)).toEqual({ paid: true });
    const s = await sub(agency.id);
    expect(s).toMatchObject({ status: "ACTIVE", interval: "YEAR" });
    expect(s.plan.code).toBe("GROWTH");
    expect((await getMockCheckout(owner.ctx, sessionId)).status).toBe("COMPLETED");
    await expect(completeMockCheckout(owner.ctx, sessionId, "pay", post)).rejects.toThrow(
      ConflictError,
    );
  });

  it("a failed payment leaves a trial as it is", async () => {
    const { owner, agency } = await setup();
    const { sessionId } = await startCheckout(owner.ctx, { planCode: "GROWTH", interval: "MONTH" });
    const post = async (_u: string, body: string, signature: string) =>
      webhookRoute(
        new Request("http://app.test/x", {
          method: "POST",
          headers: { "x-mock-billing-signature": signature },
          body,
        }),
      );
    expect(await completeMockCheckout(owner.ctx, sessionId, "fail", post)).toEqual({ paid: false });
    expect((await sub(agency.id)).status).toBe("TRIALING");
    expect((await getMockCheckout(owner.ctx, sessionId)).status).toBe("FAILED");
  });

  it("keeps checkouts private to the agency and to owners", async () => {
    const a = await setup();
    const b = await setup();
    const { sessionId } = await startCheckout(a.owner.ctx, {
      planCode: "GROWTH",
      interval: "MONTH",
    });
    await expect(getMockCheckout(b.owner.ctx, sessionId)).rejects.toThrow(NotFoundError);
    await expect(
      startCheckout(a.admin.ctx, { planCode: "GROWTH", interval: "MONTH" }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      startCheckout(a.owner.ctx, { planCode: "NOPE", interval: "MONTH" }),
    ).rejects.toThrow(/Choose one of the plans/);
  });
});

describe("changing plans", () => {
  it("upgrades now, schedules a downgrade, and can undo it", async () => {
    const { owner, agency } = await setup({ status: "ACTIVE", plan: "GROWTH" });
    await changePlan(owner.ctx, { planCode: "AGENCY", interval: "MONTH" }, now);
    expect((await sub(agency.id)).plan.code).toBe("AGENCY");
    expect(await prisma.invoice.count({ where: { agencyId: agency.id, status: "PAID" } })).toBe(1);

    const down = await changePlan(owner.ctx, { planCode: "STARTER", interval: "MONTH" }, now);
    expect(down.scheduled).toBe(true);
    expect((await sub(agency.id)).plan.code).toBe("AGENCY");
    expect((await getBillingSummary(owner.ctx, now)).pendingPlanName).toBe("Starter");
    await changePlan(owner.ctx, { planCode: "AGENCY", interval: "MONTH" }, now);
    expect((await getBillingSummary(owner.ctx, now)).pendingPlanName).toBeNull();
  });

  it("blocks a downgrade when usage is too big, and says what to remove", async () => {
    const { owner, agency } = await setup({ status: "ACTIVE", plan: "GROWTH" });
    const starter = await prisma.plan.findUniqueOrThrow({ where: { code: "STARTER" } });
    const max = (starter.limits as { maxClients: number }).maxClients;
    for (let i = 0; i < max + 2; i++)
      await prisma.client.create({ data: { agencyId: agency.id, name: `C${i}` } });
    await expect(
      changePlan(owner.ctx, { planCode: "STARTER", interval: "MONTH" }, now),
    ).rejects.toThrow(
      new RegExp(
        `You have ${max + 2} clients, but the Starter plan allows ${max}. Remove 2 to switch.`,
      ),
    );
    expect((await sub(agency.id)).pendingPlanId).toBeNull();
  });

  it("downgradeBlockers ignores unlimited limits", () => {
    const limits = {
      maxClients: -1,
      maxProjects: 2,
      maxKeywords: 5,
      maxTeamMembers: 1,
      maxClientUsers: 0,
    } as never;
    expect(
      downgradeBlockers(
        { clients: 99, projects: 3, keywords: 5, team: 1, clientUsers: 1 },
        limits,
        "Tiny",
      ),
    ).toEqual([
      "You have 3 projects, but the Tiny plan allows 2. Remove 1 to switch.",
      "You have 1 client user, but the Tiny plan allows 0. Remove 1 to switch.",
    ]);
  });

  it("cancels at period end and resumes", async () => {
    const { owner, agency } = await setup({ status: "ACTIVE", plan: "GROWTH" });
    await cancelSubscription(owner.ctx, now);
    expect((await sub(agency.id)).cancelAtPeriodEnd).toBe(true);
    await expect(cancelSubscription(owner.ctx, now)).rejects.toThrow(/already set to end/);
    await resumeSubscription(owner.ctx, now);
    expect((await sub(agency.id)).cancelAtPeriodEnd).toBe(false);
    const trial = await setup();
    await expect(cancelSubscription(trial.owner.ctx, now)).rejects.toThrow(/free trial/);
  });
});

describe("time", () => {
  it("expires a trial, reminds first, and never reminds twice", async () => {
    const { agency } = await setup();
    await prisma.subscription.updateMany({
      where: { agencyId: agency.id },
      data: { trialEndsAt: day(2.5) },
    });
    expect((await runBillingTick({ db: prisma, now })).reminders).toBe(1);
    expect((await runBillingTick({ db: prisma, now })).reminders).toBe(0);
    await prisma.subscription.updateMany({
      where: { agencyId: agency.id },
      data: { trialEndsAt: day(0.5) },
    });
    expect((await runBillingTick({ db: prisma, now })).reminders).toBe(1);
    expect((await runBillingTick({ db: prisma, now })).reminders).toBe(0);
    expect(sendBillingNoticeEmail).toHaveBeenCalledTimes(2);

    const result = await runBillingTick({ db: prisma, now: day(1) });
    expect(result.expired).toBe(1);
    expect((await sub(agency.id)).status).toBe("EXPIRED");
    expect((await runBillingTick({ db: prisma, now: day(1) })).checked).toBe(0);
  });

  it("renews with the mock provider, applying a planned downgrade", async () => {
    const { agency, owner } = await setup({ status: "ACTIVE", plan: "GROWTH" });
    await changePlan(owner.ctx, { planCode: "STARTER", interval: "MONTH" }, now);
    const result = await runBillingTick({ db: prisma, now: day(11) });
    expect(result.renewed).toBe(1);
    const s = await sub(agency.id);
    expect(s).toMatchObject({ status: "ACTIVE", pendingPlanId: null });
    expect(s.plan.code).toBe("STARTER");
    expect(s.currentPeriodEnd!.getTime()).toBeGreaterThan(day(11).getTime());
    expect((await runBillingTick({ db: prisma, now: day(11) })).checked).toBe(0);
  });

  it("a failed renewal goes past due, then read-only after 7 days", async () => {
    const { agency } = await setup({ status: "ACTIVE", plan: "GROWTH" });
    await prisma.subscription.updateMany({
      where: { agencyId: agency.id },
      data: { providerMeta: { failRenewal: true } },
    });
    expect((await runBillingTick({ db: prisma, now: day(11) })).failed).toBe(1);
    const s = await sub(agency.id);
    expect(s.status).toBe("PAST_DUE");
    expect(s.graceEndsAt!.toISOString()).toBe(day(18).toISOString());
    expect((await runBillingTick({ db: prisma, now: day(17) })).expired).toBe(0);
    expect((await runBillingTick({ db: prisma, now: day(18) })).expired).toBe(1);
    expect((await sub(agency.id)).status).toBe("EXPIRED");
  });

  it("ends a subscription that was set to cancel", async () => {
    const { agency, owner } = await setup({ status: "ACTIVE", plan: "GROWTH" });
    await cancelSubscription(owner.ctx, now);
    expect((await runBillingTick({ db: prisma, now: day(11) })).canceled).toBe(1);
    expect((await sub(agency.id)).status).toBe("CANCELED");
  });

  it("the dev clock moves dates back and runs the tick", async () => {
    const { agency, slug } = await setup();
    const res = await advanceRoute(
      new Request("http://app.test/api/dev/billing/advance", {
        method: "POST",
        body: JSON.stringify({ agency: slug, days: 11 }),
      }),
    );
    expect(res.status).toBe(200);
    expect((await sub(agency.id)).status).toBe("EXPIRED");
    const bad = await advanceRoute(
      new Request("http://app.test/x", { method: "POST", body: "{}" }),
    );
    expect(bad.status).toBe(400);
  });
});

describe("read-only mode", () => {
  async function expired() {
    const s = await setup({ status: "EXPIRED" });
    const client = await prisma.client.create({ data: { agencyId: s.agency.id, name: "C" } });
    const project = await prisma.project.create({
      data: {
        agencyId: s.agency.id,
        clientId: client.id,
        name: "P",
        domain: "p.test",
        locationCode: 2840,
        languageCode: "en",
        rankCheckHourUtc: 0,
      },
    });
    return { ...s, project };
  }

  it("blocks new reports and audits with a clear message", async () => {
    const { owner, project } = await expired();
    const enqueue = async () => undefined;
    const input = { projectId: project.id, period: "last7", sections: ["summary"] };
    await expect(createReport(owner.ctx, input, { now, enqueue })).rejects.toThrow(
      LimitExceededError,
    );
    await expect(createReport(owner.ctx, input, { now, enqueue })).rejects.toThrow(/read-only/);
    await expect(
      createAudit(
        { agencyId: owner.ctx.agencyId },
        project.id,
        owner.ctx.userId,
        async () => undefined,
      ),
    ).rejects.toThrow(/subscription has ended/);
  });

  it("the schedulers create no jobs for it", async () => {
    const { project, agency } = await expired();
    const queued: string[] = [];
    const result = await runRankCheckScheduler({
      db: prisma,
      now: new Date("2026-03-10T05:00:00Z"),
      enqueue: async (j) => (queued.push(j.projectId), true),
    });
    expect(queued).not.toContain(project.id);
    expect(result.scanned).toBe(0);
    // Reports on a schedule are skipped too.
    await prisma.reportSchedule.create({
      data: {
        agencyId: agency.id,
        projectId: project.id,
        frequency: "WEEKLY",
        recipients: ["a@b.test"],
        sections: ["summary"],
        nextRunAt: day(-1),
      },
    });
    expect(await runReportDispatcher({ db: prisma, now, enqueue: async () => undefined })).toEqual({
      due: 0,
      created: 0,
    });
  });

  it("the same account works again after a plan is bought", async () => {
    const { owner, agency, project } = await expired();
    await send(agency.id, "checkout.completed", { planCode: "STARTER", interval: "MONTH" });
    const report = await createReport(
      owner.ctx,
      { projectId: project.id, period: "last7", sections: ["summary"] },
      { now, enqueue: async () => undefined },
    );
    expect(report.id).toBeTruthy();
  });
});
