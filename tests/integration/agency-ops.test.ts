import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { grantAddOn, removeAddOn } from "@/server/admin/agencies";
import { importClientsCsv } from "@/server/services/client-import";
import { createClient } from "@/server/services/clients";
import {
  ForbiddenError,
  LimitExceededError,
  NotFoundError,
  ValidationError,
} from "@/server/services/errors";
import {
  getFinanceSettings,
  getProfitReport,
  saveFinanceSettings,
  setClientRetainer,
} from "@/server/services/finance";
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

const NOW = new Date("2026-03-10T12:00:00Z");
const admin = { adminUserId: "admin-1", email: "a@example.test" };

async function setup(plan = "GROWTH") {
  const { agency, members } = await createAgencyWithMembers(
    prisma,
    ["OWNER", "ADMIN", "MEMBER"],
    undefined,
    plan,
  );
  return { agency, owner: members[0]!.ctx, adminCtx: members[1]!.ctx, member: members[2]!.ctx };
}

async function clientWithProject(agencyId: string, name: string) {
  const client = await prisma.client.create({ data: { agencyId, name } });
  const project = await prisma.project.create({
    data: {
      agencyId,
      clientId: client.id,
      name: "Site",
      domain: `${name.toLowerCase()}.com`,
      locationCode: 2840,
      languageCode: "en",
    },
  });
  return { client, project };
}

describe("finance settings and retainers", () => {
  it("only owners can use money settings", async () => {
    const s = await setup();
    await expect(getFinanceSettings(s.adminCtx)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getProfitReport(s.member)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      saveFinanceSettings(s.adminCtx, { baseCurrency: "USD", hourlyCost: "", rates: {} }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("saves settings, replaces rates and rejects bad input", async () => {
    const s = await setup();
    await saveFinanceSettings(s.owner, {
      baseCurrency: "USD",
      hourlyCost: "42.50",
      rates: { EUR: "1.08", GBP: "1.27" },
    });
    let got = await getFinanceSettings(s.owner);
    expect(got).toEqual({
      baseCurrency: "USD",
      hourlyCostCents: 4250,
      rates: { EUR: "1.08", GBP: "1.27" },
    });
    await saveFinanceSettings(s.owner, {
      baseCurrency: "EUR",
      hourlyCost: "",
      rates: { GBP: "1.2", EUR: "1" },
    });
    got = await getFinanceSettings(s.owner);
    expect(got.baseCurrency).toBe("EUR");
    expect(got.hourlyCostCents).toBe(0);
    expect(got.rates).toEqual({ GBP: "1.2" });
    await expect(
      saveFinanceSettings(s.owner, { baseCurrency: "XXX", hourlyCost: "", rates: {} }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      saveFinanceSettings(s.owner, { baseCurrency: "USD", hourlyCost: "abc", rates: {} }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      saveFinanceSettings(s.owner, { baseCurrency: "USD", hourlyCost: "", rates: { EUR: "-2" } }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("sets a retainer only for a client of the same agency", async () => {
    const a = await setup();
    const b = await setup();
    const { client } = await clientWithProject(b.agency.id, "Other");
    await expect(
      setClientRetainer(a.owner, client.id, { amount: "100", currency: "USD" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const mine = await clientWithProject(a.agency.id, "Mine");
    await setClientRetainer(a.owner, mine.client.id, { amount: "1500.50", currency: "EUR" });
    const row = await prisma.client.findUniqueOrThrow({ where: { id: mine.client.id } });
    expect(row.retainerCents).toBe(150050);
    expect(row.retainerCurrency).toBe("EUR");
    await setClientRetainer(a.owner, mine.client.id, { amount: "", currency: "EUR" });
    expect(
      (await prisma.client.findUniqueOrThrow({ where: { id: mine.client.id } })).retainerCents,
    ).toBeNull();
  });
});

describe("profit report", () => {
  it("adds retainer, provider cost and task time for this month only", async () => {
    const s = await setup();
    await saveFinanceSettings(s.owner, {
      baseCurrency: "USD",
      hourlyCost: "60",
      rates: { EUR: "1.10" },
    });
    const acme = await clientWithProject(s.agency.id, "Acme");
    const beta = await clientWithProject(s.agency.id, "Beta");
    await setClientRetainer(s.owner, acme.client.id, { amount: "1000", currency: "USD" });
    await setClientRetainer(s.owner, beta.client.id, { amount: "500", currency: "EUR" });
    const usage = (projectId: string, costMicros: number, createdAt: Date) =>
      prisma.usageRecord.create({
        data: {
          agencyId: s.agency.id,
          projectId,
          metric: "LIVE_CHECK",
          quantity: 1,
          costMicros,
          provider: "mock",
          operation: "rankings",
          createdAt,
        },
      });
    await usage(acme.project.id, 20_000_000, new Date("2026-03-05T00:00:00Z"));
    await usage(acme.project.id, 99_000_000, new Date("2026-02-20T00:00:00Z"));
    await prisma.task.create({
      data: {
        agencyId: s.agency.id,
        projectId: acme.project.id,
        title: "Done work",
        status: "DONE",
        estimateMinutes: 120,
        completedAt: new Date("2026-03-04T00:00:00Z"),
      },
    });
    await prisma.task.create({
      data: {
        agencyId: s.agency.id,
        projectId: acme.project.id,
        title: "Old work",
        status: "DONE",
        estimateMinutes: 600,
        completedAt: new Date("2026-02-04T00:00:00Z"),
      },
    });
    const report = await getProfitReport(s.owner, {}, NOW);
    const a = report.rows.find((r) => r.name === "Acme")!;
    expect(a.revenueCents).toBe(100_000);
    expect(a.providerCents).toBe(2000);
    expect(a.timeCents).toBe(12_000);
    expect(a.marginCents).toBe(86_000);
    expect(a.forecastProviderCents).toBe(6200);
    const b = report.rows.find((r) => r.name === "Beta")!;
    expect(b.revenueCents).toBe(55_000);
    expect(report.totals.revenueCents).toBe(155_000);
    expect(report.month).toBe("2026-03");
    expect(report.missingRates).toEqual([]);
  });

  it("flags a missing rate and does not mix agencies", async () => {
    const s = await setup();
    const other = await setup();
    const c = await clientWithProject(s.agency.id, "Gamma");
    await clientWithProject(other.agency.id, "Hidden");
    await setClientRetainer(s.owner, c.client.id, { amount: "300", currency: "GBP" });
    const report = await getProfitReport(s.owner, {}, NOW);
    expect(report.rows.map((r) => r.name)).toEqual(["Gamma"]);
    expect(report.rows[0]!.marginCents).toBeNull();
    expect(report.missingRates).toEqual(["GBP"]);
    expect(report.totals.skipped).toBe(1);
  });

  it("pages the client list", async () => {
    const s = await setup();
    for (const n of ["A1", "A2", "A3"]) await clientWithProject(s.agency.id, n);
    const first = await getProfitReport(s.owner, { page: 1, pageSize: 2 }, NOW);
    const second = await getProfitReport(s.owner, { page: 2, pageSize: 2 }, NOW);
    expect(first.rows).toHaveLength(2);
    expect(second.rows).toHaveLength(1);
    expect(first.total).toBe(3);
  });
});

describe("add-ons", () => {
  it("raise the plan limit until removed", async () => {
    const s = await setup("STARTER");
    const limit = (
      (await prisma.plan.findUniqueOrThrow({ where: { code: "STARTER" } })).limits as {
        maxClients: number;
      }
    ).maxClients;
    for (let i = 0; i < limit; i++) await createClient(s.owner, { name: `Client ${i}` });
    await expect(createClient(s.owner, { name: "One too many" })).rejects.toBeInstanceOf(
      LimitExceededError,
    );
    await grantAddOn(admin, s.agency.id, { limitKey: "maxClients", amount: 2, note: "Deal" });
    await createClient(s.owner, { name: "Extra 1" });
    await createClient(s.owner, { name: "Extra 2" });
    await expect(createClient(s.owner, { name: "Extra 3" })).rejects.toBeInstanceOf(
      LimitExceededError,
    );
    const row = await prisma.agencyAddOn.findFirstOrThrow({ where: { agencyId: s.agency.id } });
    await removeAddOn(admin, s.agency.id, row.id);
    await expect(createClient(s.owner, { name: "Extra 4" })).rejects.toBeInstanceOf(
      LimitExceededError,
    );
  });

  it("rejects bad input and other agencies", async () => {
    const a = await setup();
    const b = await setup();
    await expect(
      grantAddOn(admin, a.agency.id, { limitKey: "customDomain", amount: 1 }),
    ).rejects.toThrow();
    await expect(
      grantAddOn(admin, a.agency.id, { limitKey: "maxClients", amount: 0 }),
    ).rejects.toThrow();
    await grantAddOn(admin, a.agency.id, { limitKey: "maxClients", amount: 1 });
    const row = await prisma.agencyAddOn.findFirstOrThrow({ where: { agencyId: a.agency.id } });
    await expect(removeAddOn(admin, b.agency.id, row.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("client import", () => {
  it("creates clients and projects, reuses names, and reports bad lines", async () => {
    const s = await setup();
    const csv = [
      "client,website,contact email,project,domain",
      "Acme,acme.com,ann@acme.com,Main,acme.com",
      "acme,,,Blog,blog.acme.com",
      "Beta,,not-an-email,,",
      ",x.com,,,",
      "Delta,,,Bad,not a domain",
    ].join("\n");
    const out = await importClientsCsv(s.owner, { csv });
    expect(out.clientsAdded).toBe(2);
    expect(out.projectsAdded).toBe(2);
    expect(out.problems.map((p) => p.line).sort()).toEqual([4, 5, 6]);
    const clients = await prisma.client.findMany({ where: { agencyId: s.agency.id } });
    expect(clients.map((c) => c.name).sort()).toEqual(["Acme", "Delta"]);
    const again = await importClientsCsv(s.owner, {
      csv: "client,project,domain\nAcme,Main,acme.com",
    });
    expect(again.clientsAdded).toBe(0);
    expect(again.projectsAdded).toBe(0);
    expect(again.problems).toHaveLength(1);
  });

  it("stops at the plan limit and needs edit permission", async () => {
    const s = await setup("STARTER");
    const lines = Array.from({ length: 12 }, (_, i) => `Bulk ${i}`).join("\n");
    const out = await importClientsCsv(s.owner, { csv: `client\n${lines}` });
    const count = await prisma.client.count({ where: { agencyId: s.agency.id } });
    expect(out.clientsAdded).toBe(count);
    expect(count).toBeLessThan(12);
    expect(out.problems.at(-1)!.message).toContain("plan allows");
    await expect(importClientsCsv(s.owner, { csv: "" })).rejects.toBeInstanceOf(ValidationError);
    await expect(
      importClientsCsv({ ...s.owner, role: "CLIENT" }, { csv: "client\nX Co" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
