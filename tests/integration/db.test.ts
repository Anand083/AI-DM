import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "../../prisma/seed";
import { createGuardedTestClient, createTestClient, resetDb, testDatabaseUrl } from "../helpers/db";

const prisma = createTestClient();
const guarded = createGuardedTestClient(prisma);

beforeAll(async () => {
  await resetDb(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("migrations", () => {
  it("run on an empty database", async () => {
    const admin = new PrismaClient({ datasourceUrl: testDatabaseUrl });
    const name = `migrate_check_${Date.now()}`;
    await admin.$executeRawUnsafe(`CREATE DATABASE ${name}`);
    try {
      const url = new URL(testDatabaseUrl);
      url.pathname = `/${name}`;
      execSync("pnpm exec prisma migrate deploy", {
        env: { ...process.env, DATABASE_URL: url.toString() },
        stdio: "pipe",
      });
      const fresh = new PrismaClient({ datasourceUrl: url.toString() });
      const rows = await fresh.$queryRaw<{ tablename: string }[]>`
        SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
      await fresh.$disconnect();
      const names = rows.map((r) => r.tablename);
      for (const table of [
        "User",
        "Agency",
        "Client",
        "Project",
        "Plan",
        "Subscription",
        "ActivityLog",
      ]) {
        expect(names).toContain(table);
      }
    } finally {
      await admin.$executeRawUnsafe(`DROP DATABASE ${name} WITH (FORCE)`);
      await admin.$disconnect();
    }
  }, 60_000);
});

describe("seed", () => {
  it("runs twice without duplicates", async () => {
    await seed(prisma, { demo: true });
    await seed(prisma, { demo: true });
    expect(await prisma.plan.count()).toBe(3);
    expect(await prisma.user.count()).toBe(6);
    expect(await prisma.account.count()).toBe(6);
    expect(await prisma.agency.count()).toBe(2);
    expect(await prisma.agencyMember.count()).toBe(5);
    expect(await prisma.subscription.count()).toBe(2);
    expect(await prisma.client.count()).toBe(6);
    expect(await prisma.project.count()).toBe(4);
  }, 60_000);

  it("creates only plans when demo is off", async () => {
    await resetDb(prisma);
    await seed(prisma, { demo: false });
    expect(await prisma.plan.count()).toBe(3);
    expect(await prisma.user.count()).toBe(0);
  });
});

describe("tenant guard with a real database", () => {
  beforeAll(async () => {
    await resetDb(prisma);
    await seed(prisma, { demo: true });
  });

  it("throws without agencyId and returns data with it", async () => {
    await expect(guarded.client.findMany()).rejects.toThrow(/agencyId/);
    const rows = await guarded.client.findMany({ where: { agencyId: "seed_agency_one" } });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.agencyId === "seed_agency_one")).toBe(true);
  });

  it("does not return another agency's row by id", async () => {
    const row = await guarded.client.findFirst({
      where: { id: "seed_agency_two_client_1", agencyId: "seed_agency_one" },
    });
    expect(row).toBeNull();
  });
});
