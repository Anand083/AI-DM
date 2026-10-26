import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError } from "@/server/services/errors";
import { getClientProgress, getProjectProgress } from "@/server/services/progress";
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

const day = (v: string) => new Date(`${v}T00:00:00Z`);

async function setup() {
  const { agency, members } = await createAgencyWithMembers(prisma, ["OWNER"], undefined, "GROWTH");
  const client = await prisma.client.create({ data: { agencyId: agency.id, name: "Acme" } });
  const mk = (name: string) =>
    prisma.project.create({
      data: {
        agencyId: agency.id,
        clientId: client.id,
        name,
        domain: `${name}.example.com`,
        locationCode: 2840,
        languageCode: "en",
      },
    });
  return { agency, ctx: members[0]!.ctx, client, mk };
}

async function keyword(
  agencyId: string,
  projectId: string,
  phrase: string,
  checks: [string, number | null][],
) {
  const last = checks[checks.length - 1]!;
  const k = await prisma.keyword.create({
    data: {
      agencyId,
      projectId,
      phrase,
      lastCheckedOn: day(last[0]),
      currentPosition: last[1],
    },
  });
  for (const [date, position] of checks)
    await prisma.rankCheck.create({
      data: { agencyId, keywordId: k.id, date: day(date), position, provider: "mock" },
    });
  return k;
}

describe("progress since tracking started", () => {
  it("compares the first check with the latest for a project", async () => {
    const s = await setup();
    const p = await s.mk("one");
    await keyword(s.agency.id, p.id, "a", [
      ["2026-01-01", 40],
      ["2026-01-15", 20],
      ["2026-02-01", 6],
    ]);
    await keyword(s.agency.id, p.id, "b", [
      ["2026-01-02", 5],
      ["2026-02-01", 8],
    ]);
    await keyword(s.agency.id, p.id, "c", [
      ["2026-01-03", null],
      ["2026-02-01", 30],
    ]);
    await keyword(s.agency.id, p.id, "new", [["2026-02-01", 9]]);
    const out = await getProjectProgress(s.ctx, p.id);
    expect(out.since).toBe("2026-01-01");
    expect(out).toMatchObject({
      compared: 3,
      waiting: 1,
      up: 2,
      down: 1,
      same: 0,
      pageOneStart: 1,
      pageOneNow: 2,
    });
    expect(out.verdict).toBe("better");
  });

  it("adds up all projects of a client and ignores other clients and agencies", async () => {
    const s = await setup();
    const other = await setup();
    const p1 = await s.mk("one");
    const p2 = await s.mk("two");
    await keyword(s.agency.id, p1.id, "a", [
      ["2026-01-01", 50],
      ["2026-02-01", 5],
    ]);
    await keyword(s.agency.id, p2.id, "b", [
      ["2026-01-01", 50],
      ["2026-02-01", 7],
    ]);
    const stranger = await other.mk("x");
    await keyword(other.agency.id, stranger.id, "z", [
      ["2026-01-01", 5],
      ["2026-02-01", 90],
    ]);
    const out = await getClientProgress(s.ctx, s.client.id);
    expect(out).toMatchObject({ compared: 2, up: 2, down: 0 });
    await expect(getProjectProgress(s.ctx, stranger.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getClientProgress(s.ctx, other.client.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("says there is nothing to compare before a second day of checks", async () => {
    const s = await setup();
    const p = await s.mk("fresh");
    expect((await getProjectProgress(s.ctx, p.id)).verdict).toBe("none");
    await keyword(s.agency.id, p.id, "a", [["2026-02-01", 9]]);
    const out = await getProjectProgress(s.ctx, p.id);
    expect(out.verdict).toBe("none");
    expect(out.since).toBe("2026-02-01");
    await expect(getProjectProgress({ ...s.ctx, role: "CLIENT" }, p.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
