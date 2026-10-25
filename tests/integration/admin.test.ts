import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

let realUser: { id: string; email: string; emailVerified: boolean; isSuperAdmin: boolean } | null =
  null;
let support: {
  id: string;
  adminUserId: string;
  targetUserId: string;
  agencyId: string;
  expiresAt: Date;
} | null = null;

vi.mock("@/server/auth/session", () => ({
  getRealSessionUser: async () => realUser,
  getSessionUser: async () => realUser,
}));
vi.mock("@/server/auth/impersonation", () => ({
  readActiveImpersonation: async () => support,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: () => {
    throw new Error("NEXT_REDIRECT");
  },
}));

import { withAdminAction } from "@/server/admin/actions";
import {
  addBonusUsage,
  changeAgencyPlan,
  extendTrial,
  getAgencyDetail,
  listAgencies,
  setAgencySuspended,
} from "@/server/admin/agencies";
import { requireSuperAdmin, type AdminContext } from "@/server/admin/guard";
import { getOverview } from "@/server/admin/overview";
import { listPlansForAdmin, updatePlan } from "@/server/admin/plans";
import { getProviderOverview, testProviderConnection } from "@/server/admin/providers";
import { listQueues, removeJob, retryJob, setQueuePaused } from "@/server/admin/queues";
import {
  FEATURE_FLAGS,
  getPlatformSettings,
  isFeatureEnabled,
  isMaintenanceMode,
  setFeatureFlag,
  setMaintenanceMode,
  setProviderBudget,
} from "@/server/admin/settings";
import { endSupportSession, startSupportSession } from "@/server/admin/support-session";
import { assertWithinLimit, getUsageSummary } from "@/server/services/usage";
import { logActivity } from "@/server/services/activity";
import {
  ConflictError,
  LimitExceededError,
  NotFoundError,
  ValidationError,
} from "@/server/services/errors";
import { createAgencyWithMembers, createUser, seedPlans } from "../factories";
import { createTestClient, resetDb } from "../helpers/db";

const prisma = createTestClient();
const now = new Date("2026-03-18T12:00:00Z");
const day = (n: number) => new Date(now.getTime() + n * 86_400_000);
const admin: AdminContext = { adminUserId: "admin-1", email: "admin@example.test" };

async function agencyWith(opts: {
  name: string;
  plan: string;
  status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "EXPIRED";
  interval?: "MONTH" | "YEAR";
  createdAt?: Date;
}) {
  const { agency, members } = await createAgencyWithMembers(prisma, ["OWNER"], opts.name);
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: opts.plan } });
  await prisma.subscription.create({
    data: {
      agencyId: agency.id,
      planId: plan.id,
      status: opts.status,
      interval: opts.interval ?? "MONTH",
      trialEndsAt: opts.status === "TRIALING" ? day(5) : null,
    },
  });
  if (opts.createdAt)
    await prisma.agency.update({ where: { id: agency.id }, data: { createdAt: opts.createdAt } });
  return { agency, owner: members[0]! };
}

beforeEach(async () => {
  await resetDb(prisma);
  await seedPlans(prisma);
  realUser = null;
  support = null;
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("who can use the admin area", () => {
  it("only a verified super admin passes the guard", async () => {
    await expect(requireSuperAdmin()).rejects.toThrow("NEXT_NOT_FOUND");
    realUser = { id: "u", email: "u@x.test", emailVerified: true, isSuperAdmin: false };
    await expect(requireSuperAdmin()).rejects.toThrow("NEXT_NOT_FOUND");
    realUser = { id: "u", email: "u@x.test", emailVerified: false, isSuperAdmin: true };
    await expect(requireSuperAdmin()).rejects.toThrow("NEXT_NOT_FOUND");
    realUser = { id: "u", email: "u@x.test", emailVerified: true, isSuperAdmin: true };
    await expect(requireSuperAdmin()).resolves.toEqual({ adminUserId: "u", email: "u@x.test" });
  });

  it("admin actions refuse everyone else and validate input", async () => {
    const action = withAdminAction(
      z.object({ n: z.number().min(1, "Too small.") }),
      async (_a, input) => input.n,
    );
    expect(await action({ n: 5 })).toEqual({ ok: false, error: "Not found." });
    realUser = { id: "u", email: "u@x.test", emailVerified: true, isSuperAdmin: false };
    expect(await action({ n: 5 })).toEqual({ ok: false, error: "Not found." });
    realUser = { id: "a", email: "a@x.test", emailVerified: true, isSuperAdmin: true };
    expect(await action({ n: 5 })).toEqual({ ok: true, data: 5 });
    expect(await action({ n: 0 })).toMatchObject({
      ok: false,
      error: "Too small.",
      fieldErrors: { n: "Too small." },
    });
    const failing = withAdminAction(z.object({}), async () => {
      throw new NotFoundError("Nope.");
    });
    expect(await failing({})).toMatchObject({ ok: false, error: "Nope." });
  });
});

describe("overview math", () => {
  it("adds up MRR, churn, signups, cost and margin from fixtures", async () => {
    await agencyWith({
      name: "Growth monthly",
      plan: "GROWTH",
      status: "ACTIVE",
      createdAt: day(-1),
    });
    const yearly = await agencyWith({
      name: "Agency yearly",
      plan: "AGENCY",
      status: "ACTIVE",
      interval: "YEAR",
      createdAt: day(-8),
    });
    await agencyWith({
      name: "Starter late",
      plan: "STARTER",
      status: "PAST_DUE",
      createdAt: day(-9),
    });
    await agencyWith({ name: "On trial", plan: "GROWTH", status: "TRIALING", createdAt: day(-2) });
    const lost = await agencyWith({
      name: "Lost",
      plan: "GROWTH",
      status: "CANCELED",
      createdAt: day(-60),
    });
    await prisma.subscription.updateMany({
      where: { agencyId: lost.agency.id },
      data: { updatedAt: day(-3) },
    });
    const suspended = await agencyWith({
      name: "Suspended",
      plan: "STARTER",
      status: "ACTIVE",
      createdAt: day(-70),
    });
    await prisma.agency.update({
      where: { id: suspended.agency.id },
      data: { status: "SUSPENDED" },
    });
    // Cost this month: $12.34 (12,340,000 micro-dollars).
    await prisma.usageRecord.create({
      data: {
        agencyId: yearly.agency.id,
        metric: "RANK_CHECK",
        quantity: 1,
        costMicros: 12_340_000,
        provider: "mock",
        operation: "x",
        createdAt: day(-1),
      },
    });
    // Another month does not count.
    await prisma.usageRecord.create({
      data: {
        agencyId: yearly.agency.id,
        metric: "RANK_CHECK",
        quantity: 1,
        costMicros: 99_000_000,
        provider: "mock",
        operation: "x",
        createdAt: new Date("2025-01-10"),
      },
    });
    const o = await getOverview(admin, now);

    expect(o.agencies).toEqual({ active: 5, suspended: 1 });
    expect(o.subscriptions).toMatchObject({ trialing: 1, paying: 4, pastDue: 1, ended: 1 });
    // 14,900 + 399,000 / 12 (33,250) + 4,900 + the suspended agency's 4,900 (still a paying subscription)
    expect(o.mrrCents).toBe(14900 + 33250 + 4900 + 4900);
    expect(o.providerCostCents).toBe(1234);
    expect(o.margin.revenueCents).toBe(o.mrrCents);
    expect(o.margin.marginCents).toBe(o.mrrCents - o.providerCostCents);
    expect(o.churnPercent).toBe(Math.round((1 / (4 + 1)) * 1000) / 10);
    expect(o.signupsPerWeek).toHaveLength(8);
    expect(o.signupsPerWeek.reduce((sum, w) => sum + w.count, 0)).toBeGreaterThanOrEqual(0);
    expect(o.budget.state).toBeDefined();
  });
});

describe("agencies", () => {
  it("lists with search, filters and pages", async () => {
    await agencyWith({ name: "Alpha Digital", plan: "GROWTH", status: "ACTIVE" });
    const beta = await agencyWith({ name: "Beta Studio", plan: "STARTER", status: "TRIALING" });
    await agencyWith({ name: "Gamma Labs", plan: "STARTER", status: "EXPIRED" });
    await prisma.agency.update({ where: { id: beta.agency.id }, data: { status: "SUSPENDED" } });
    const ownerEmail = (await prisma.user.findUniqueOrThrow({ where: { id: beta.owner.user.id } }))
      .email;

    expect((await listAgencies(admin)).total).toBe(3);
    expect((await listAgencies(admin, { q: "alpha" })).items.map((a) => a.name)).toEqual([
      "Alpha Digital",
    ]);
    expect((await listAgencies(admin, { q: ownerEmail })).items.map((a) => a.name)).toEqual([
      "Beta Studio",
    ]);
    expect((await listAgencies(admin, { status: "SUSPENDED" })).items.map((a) => a.name)).toEqual([
      "Beta Studio",
    ]);
    expect(
      (await listAgencies(admin, { subscription: "EXPIRED" })).items.map((a) => a.name),
    ).toEqual(["Gamma Labs"]);
    const paged = await listAgencies(admin, { pageSize: 2 });
    expect(paged).toMatchObject({ total: 3, page: 1, pageSize: 2 });
    expect(paged.items).toHaveLength(2);
    expect((await listAgencies(admin, { page: 2, pageSize: 2 })).items).toHaveLength(1);
  });

  it("shows members, usage, cost versus revenue and the activity log", async () => {
    const { agency } = await agencyWith({
      name: "Alpha Digital",
      plan: "GROWTH",
      status: "ACTIVE",
    });
    await prisma.usageRecord.createMany({
      data: [
        {
          agencyId: agency.id,
          metric: "AUDIT_PAGE",
          quantity: 40,
          costMicros: 5_000_000,
          provider: "mock",
          operation: "audit",
        },
        {
          agencyId: agency.id,
          metric: "LIVE_CHECK",
          quantity: 3,
          costMicros: 1_500_000,
          provider: "mock",
          operation: "live",
        },
      ],
    });
    await prisma.activityLog.create({ data: { agencyId: agency.id, action: "client.created" } });
    const detail = await getAgencyDetail(admin, agency.id, new Date());
    expect(detail.members).toHaveLength(1);
    expect(detail.usage).toEqual(
      expect.arrayContaining([{ metric: "AUDIT_PAGE", quantity: 40, costCents: 500 }]),
    );
    expect(detail.margin).toEqual({
      revenueCents: 14900,
      costCents: 650,
      marginCents: 14250,
      percent: 95.6,
    });
    expect(detail.dailyCost).toHaveLength(1);
    expect(detail.activity.map((a) => a.action)).toContain("client.created");
    await expect(getAgencyDetail(admin, "nope")).rejects.toThrow(NotFoundError);
  });

  it("suspends and unsuspends, and logs it", async () => {
    const { agency } = await agencyWith({ name: "A", plan: "GROWTH", status: "ACTIVE" });
    await setAgencySuspended(admin, agency.id, true);
    expect((await prisma.agency.findUniqueOrThrow({ where: { id: agency.id } })).status).toBe(
      "SUSPENDED",
    );
    await expect(setAgencySuspended(admin, agency.id, true)).rejects.toThrow(ConflictError);
    await setAgencySuspended(admin, agency.id, false);
    await expect(setAgencySuspended(admin, agency.id, false)).rejects.toThrow(ConflictError);
    const actions = (
      await prisma.activityLog.findMany({
        where: { agencyId: agency.id },
        orderBy: { createdAt: "asc" },
      })
    ).map((a) => a.action);
    expect(actions).toEqual(["admin.suspended", "admin.unsuspended"]);
  });

  it("changes the plan without charging", async () => {
    const { agency } = await agencyWith({ name: "A", plan: "STARTER", status: "ACTIVE" });
    await changeAgencyPlan(admin, agency.id, "AGENCY");
    const sub = await prisma.subscription.findFirstOrThrow({
      where: { agencyId: agency.id },
      include: { plan: true },
    });
    expect(sub.plan.code).toBe("AGENCY");
    expect(await prisma.invoice.count()).toBe(0);
    await expect(changeAgencyPlan(admin, agency.id, "NOPE")).rejects.toThrow(ValidationError);
  });

  it("extends a trial, restarts an ended trial and refuses paid plans", async () => {
    const trial = await agencyWith({ name: "T", plan: "STARTER", status: "TRIALING" });
    await extendTrial(admin, trial.agency.id, 10, now);
    expect(
      (
        await prisma.subscription.findFirstOrThrow({ where: { agencyId: trial.agency.id } })
      ).trialEndsAt?.toISOString(),
    ).toBe(day(15).toISOString());

    const ended = await agencyWith({ name: "E", plan: "STARTER", status: "TRIALING" });
    await prisma.subscription.updateMany({
      where: { agencyId: ended.agency.id },
      data: { status: "EXPIRED", trialEndsAt: day(-3) },
    });
    await extendTrial(admin, ended.agency.id, 7, now);
    const sub = await prisma.subscription.findFirstOrThrow({
      where: { agencyId: ended.agency.id },
    });
    expect(sub).toMatchObject({ status: "TRIALING" });
    expect(sub.trialEndsAt?.toISOString()).toBe(day(7).toISOString());

    const paid = await agencyWith({ name: "P", plan: "GROWTH", status: "ACTIVE" });
    await expect(extendTrial(admin, paid.agency.id, 5, now)).rejects.toThrow(ConflictError);
    await expect(extendTrial(admin, trial.agency.id, 0, now)).rejects.toThrow();
  });

  it("bonus usage raises this month's limit", async () => {
    const { agency } = await agencyWith({ name: "B", plan: "STARTER", status: "ACTIVE" });
    const starter = await prisma.plan.findUniqueOrThrow({ where: { code: "STARTER" } });
    const limit = (starter.limits as { liveChecksPerMonth: number }).liveChecksPerMonth;
    await prisma.usageRecord.create({
      data: {
        agencyId: agency.id,
        metric: "LIVE_CHECK",
        quantity: limit,
        costMicros: 0,
        provider: "mock",
        operation: "live",
      },
    });
    await expect(assertWithinLimit({ agencyId: agency.id }, "LIVE_CHECK", 1)).rejects.toThrow(
      LimitExceededError,
    );
    await addBonusUsage(admin, agency.id, {
      metric: "LIVE_CHECK",
      quantity: 10,
      note: "Thanks for waiting",
    });
    await expect(
      assertWithinLimit({ agencyId: agency.id }, "LIVE_CHECK", 10),
    ).resolves.toBeUndefined();
    await expect(assertWithinLimit({ agencyId: agency.id }, "LIVE_CHECK", 11)).rejects.toThrow(
      LimitExceededError,
    );
    const summary = await getUsageSummary({ userId: "x", agencyId: agency.id, role: "OWNER" });
    expect(summary.monthly.find((l) => l.key === "LIVE_CHECK")).toMatchObject({
      used: limit,
      limit: limit + 10,
    });
    await expect(
      addBonusUsage(admin, agency.id, { metric: "RANK_CHECK", quantity: 1 }),
    ).rejects.toThrow();
    await expect(
      addBonusUsage(admin, "nope", { metric: "LIVE_CHECK", quantity: 1 }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("support sessions", () => {
  it("starts a 30 minute session as the owner and logs it", async () => {
    const { agency, owner } = await agencyWith({ name: "A", plan: "GROWTH", status: "ACTIVE" });
    const adminUser = await createUser(prisma);
    const ctx: AdminContext = { adminUserId: adminUser.id, email: adminUser.email };
    const session = await startSupportSession(ctx, agency.id, undefined, now);
    expect(session.expiresAt.toISOString()).toBe(
      new Date(now.getTime() + 30 * 60_000).toISOString(),
    );
    const row = await prisma.impersonation.findUniqueOrThrow({ where: { id: session.id } });
    expect(row).toMatchObject({
      adminUserId: adminUser.id,
      targetUserId: owner.user.id,
      agencyId: agency.id,
      endedAt: null,
    });

    // A second session ends the first.
    const second = await startSupportSession(ctx, agency.id, undefined, day(0));
    expect(
      (await prisma.impersonation.findUniqueOrThrow({ where: { id: session.id } })).endedAt,
    ).not.toBeNull();
    expect(second.id).not.toBe(session.id);
    await endSupportSession(ctx, day(0));
    expect(
      (await prisma.impersonation.findUniqueOrThrow({ where: { id: second.id } })).endedAt,
    ).not.toBeNull();
    const log = await prisma.activityLog.findMany({
      where: { agencyId: agency.id },
      orderBy: { createdAt: "asc" },
    });
    expect(log.map((l) => l.action)).toEqual([
      "admin.impersonation_started",
      "admin.impersonation_started",
      "admin.impersonation_ended",
    ]);
    expect(log.every((l) => l.impersonatorUserId === adminUser.id)).toBe(true);
  });

  it("refuses suspended agencies, strangers and yourself", async () => {
    const { agency, owner } = await agencyWith({ name: "A", plan: "GROWTH", status: "ACTIVE" });
    const stranger = await createUser(prisma);
    const ctx: AdminContext = { adminUserId: stranger.id, email: stranger.email };
    await expect(startSupportSession(ctx, agency.id, stranger.id)).rejects.toThrow(NotFoundError);
    await expect(
      startSupportSession({ adminUserId: owner.user.id, email: "o@x.test" }, agency.id),
    ).rejects.toThrow(/yourself/);
    await prisma.agency.update({ where: { id: agency.id }, data: { status: "SUSPENDED" } });
    await expect(startSupportSession(ctx, agency.id)).rejects.toThrow(ConflictError);
    await expect(startSupportSession(ctx, "nope")).rejects.toThrow(NotFoundError);
  });

  it("marks every logged action with the admin during a support session", async () => {
    const { agency, owner } = await agencyWith({ name: "A", plan: "GROWTH", status: "ACTIVE" });
    await logActivity({
      agencyId: agency.id,
      actorUserId: owner.user.id,
      action: "client.created",
    });
    support = {
      id: "s1",
      adminUserId: "admin-9",
      targetUserId: owner.user.id,
      agencyId: agency.id,
      expiresAt: day(1),
    };
    await logActivity({
      agencyId: agency.id,
      actorUserId: owner.user.id,
      action: "client.deleted",
    });
    // A session for another agency does not mark this one.
    support = { ...support, agencyId: "other" };
    await logActivity({
      agencyId: agency.id,
      actorUserId: owner.user.id,
      action: "client.updated",
    });
    const rows = await prisma.activityLog.findMany({
      where: { agencyId: agency.id },
      orderBy: { createdAt: "asc" },
    });
    expect(rows.map((r) => [r.action, r.impersonatorUserId])).toEqual([
      ["client.created", null],
      ["client.deleted", "admin-9"],
      ["client.updated", null],
    ]);
  });
});

describe("queues, providers, plans and settings", () => {
  it("lists every queue, pauses and resumes, and handles missing jobs", async () => {
    const queues = await listQueues(admin);
    expect(queues.map((q) => q.name).sort()).toEqual([
      "alerts",
      "audits",
      "emails",
      "maintenance",
      "provider-tasks",
      "rank-checks",
      "reports",
    ]);
    expect(queues.every((q) => q.paused === false && q.failed.length === 0)).toBe(true);
    await setQueuePaused(admin, "reports", true);
    expect((await listQueues(admin)).find((q) => q.name === "reports")?.paused).toBe(true);
    await setQueuePaused(admin, "reports", false);
    expect((await listQueues(admin)).find((q) => q.name === "reports")?.paused).toBe(false);
    await expect(setQueuePaused(admin, "nope", true)).rejects.toThrow(NotFoundError);
    await expect(retryJob(admin, "emails", "missing")).rejects.toThrow(NotFoundError);
    await expect(removeJob(admin, "emails", "missing")).rejects.toThrow(NotFoundError);
  });

  it("describes the providers and tests the mock connection", async () => {
    const o = await getProviderOverview(admin);
    expect(o.defaultProvider).toBe("mock");
    expect(o.environment).toBe("mock");
    expect(o.modules.length).toBeGreaterThan(3);
    expect(o.modules.every((m) => m.provider === "mock")).toBe(true);
    expect(o.callbackUrls.pingback).toMatch(/\/api\/providers\/dataforseo\/pingback$/);
    expect(JSON.stringify(o)).not.toMatch(/password|secret/i);
    expect(await testProviderConnection(admin, "mock")).toMatchObject({ ok: true });
    await expect(testProviderConnection(admin, "other")).rejects.toThrow(NotFoundError);
    // The real provider has no credentials here, so the test reports a failure instead of throwing.
    expect((await testProviderConnection(admin, "dataforseo")).ok).toBe(false);
  });

  it("edits plans and refuses bad numbers", async () => {
    const [starter] = await listPlansForAdmin(admin);
    const values = {
      name: "Starter Plus",
      priceMonthlyCents: 5900,
      priceYearlyCents: 59000,
      isPublic: true,
      limits: { ...starter!.limits, maxClients: -1, maxProjects: 12 },
    };
    await updatePlan(admin, starter!.id, values);
    const after = (await listPlansForAdmin(admin))[0]!;
    expect(after).toMatchObject({ name: "Starter Plus", priceMonthlyCents: 5900 });
    expect(after.limits).toMatchObject({ maxClients: -1, maxProjects: 12 });
    await expect(
      updatePlan(admin, starter!.id, { ...values, limits: { ...values.limits, maxClients: -5 } }),
    ).rejects.toThrow(ValidationError);
    await expect(updatePlan(admin, starter!.id, { ...values, name: "" })).rejects.toThrow(
      ValidationError,
    );
    await expect(updatePlan(admin, "nope", values)).rejects.toThrow(NotFoundError);
  });

  it("saves the budget, maintenance mode and feature flags", async () => {
    expect(await getPlatformSettings(admin, 50)).toMatchObject({
      budgetUsd: 50,
      maintenance: false,
    });
    await setProviderBudget(admin, 120);
    await setMaintenanceMode(admin, true);
    await setFeatureFlag(admin, "backlinks", false);
    const settings = await getPlatformSettings(admin, 50);
    expect(settings).toMatchObject({ budgetUsd: 120, maintenance: true });
    expect(settings.flags.find((f) => f.key === "backlinks")?.enabled).toBe(false);
    expect(settings.flags).toHaveLength(FEATURE_FLAGS.length);
    expect(await isMaintenanceMode()).toBe(true);
    expect(await isFeatureEnabled("backlinks")).toBe(false);
    expect(await isFeatureEnabled("reviews")).toBe(true);
    await expect(setProviderBudget(admin, -1)).rejects.toThrow(ValidationError);
    await expect(setFeatureFlag(admin, "nope", true)).rejects.toThrow(ValidationError);
  });
});
