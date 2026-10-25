import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadTenantContext } from "@/server/auth/tenant-context";
import { purgeExpired } from "@/server/jobs/system/purge";
import { getStorage } from "@/server/providers/storage";
import { deleteAgency } from "@/server/services/agency";
import {
  buildAgencyExport,
  listExports,
  purgeExpiredExports,
  readExport,
  requestExport,
} from "@/server/services/data-export";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/server/services/errors";
import { createAgencyWithMembers, seedPlans } from "../factories";
import { createTestClient, resetDb } from "../helpers/db";
import { readZip } from "../helpers/zip";

vi.mock("@/server/services/email", async (original) => {
  const real = await original<typeof import("@/server/services/email")>();
  return { ...real, sendBillingNoticeEmail: vi.fn(async () => undefined) };
});
import { sendBillingNoticeEmail } from "@/server/services/email";

const prisma = createTestClient();
const now = new Date("2026-03-10T12:00:00Z");
const day = (n: number) => new Date(now.getTime() + n * 86_400_000);

async function setup(name = "Agency One") {
  const { agency, members } = await createAgencyWithMembers(
    prisma,
    ["OWNER", "ADMIN"],
    name,
    "STARTER",
  );
  const client = await prisma.client.create({
    data: { agencyId: agency.id, name: `${name} client` },
  });
  const project = await prisma.project.create({
    data: {
      agencyId: agency.id,
      clientId: client.id,
      name: "Site",
      domain: "site.test",
      locationCode: 2840,
      languageCode: "en",
    },
  });
  const keyword = await prisma.keyword.create({
    data: { agencyId: agency.id, projectId: project.id, phrase: `${name} keyword` },
  });
  await prisma.rankCheck.create({
    data: {
      agencyId: agency.id,
      keywordId: keyword.id,
      date: new Date("2026-03-01"),
      position: 4,
      provider: "mock",
    },
  });
  await prisma.report.create({
    data: {
      agencyId: agency.id,
      projectId: project.id,
      title: "Report",
      status: "READY",
      periodStart: new Date("2026-03-01"),
      periodEnd: new Date("2026-03-31"),
      sections: ["summary"],
      shareToken: `secret-share-token-${name.replace(/\W/g, "")}`,
      shareExpiresAt: day(5),
      data: { version: 1 },
    },
  });
  await prisma.invitation.create({
    data: {
      agencyId: agency.id,
      email: "x@y.test",
      role: "MEMBER",
      tokenHash: `hash-${name.replace(/\W/g, "")}`,
      expiresAt: day(3),
      invitedById: members[0]!.user.id,
    },
  });
  await prisma.branding.create({
    data: {
      agencyId: agency.id,
      displayName: name,
      customDomain: `${name.replace(/\W/g, "").toLowerCase()}.example.test`,
      customDomainStatus: "VERIFIED",
      domainVerifyToken: "verify-secret",
    },
  });
  return { agency, owner: members[0]!, admin: members[1]!, client };
}

beforeEach(async () => {
  await resetDb(prisma);
  await seedPlans(prisma);
  vi.mocked(sendBillingNoticeEmail).mockClear();
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("data export", () => {
  it("is for owners only, one at a time", async () => {
    const { owner, admin } = await setup();
    const queued: string[] = [];
    const enqueue = async (d: { exportId: string }) => void queued.push(d.exportId);
    await expect(requestExport(admin.ctx, { now, enqueue })).rejects.toThrow(ForbiddenError);
    const row = await requestExport(owner.ctx, { now, enqueue });
    expect(queued).toEqual([row.id]);
    await expect(requestExport(owner.ctx, { now, enqueue })).rejects.toThrow(ConflictError);
    expect(await listExports(owner.ctx)).toHaveLength(1);
    await expect(listExports(admin.ctx)).rejects.toThrow(ForbiddenError);
  });

  it("builds a zip with this agency's data and no secrets", async () => {
    const a = await setup("Agency One");
    const b = await setup("Agency Two");
    const row = await requestExport(a.owner.ctx, { now, enqueue: async () => undefined });
    expect(await buildAgencyExport(a.agency.id, row.id)).toMatchObject({ status: "READY" });

    const { bytes, createdAt } = await readExport(a.owner.ctx, row.id, now);
    expect(createdAt).toBeInstanceOf(Date);
    const files = readZip(bytes);
    expect([...files.keys()]).toEqual(
      expect.arrayContaining([
        "README.txt",
        "agency.jsonl",
        "team.jsonl",
        "clients.jsonl",
        "projects.jsonl",
        "keywords.jsonl",
        "rank-checks.jsonl",
        "reports.jsonl",
        "activity-log.jsonl",
      ]),
    );
    expect(files.get("README.txt")).toContain("copy of your agency's data");
    expect(files.get("clients.jsonl")).toContain("Agency One client");
    expect(files.get("keywords.jsonl")).toContain("Agency One keyword");
    expect(JSON.parse(files.get("agency.jsonl")!.trim())).toMatchObject({
      name: "Agency One",
      slug: a.agency.slug,
    });
    const team = files
      .get("team.jsonl")!
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { role: string; user: { email: string } });
    expect(team.map((t) => t.role).sort()).toEqual(["ADMIN", "OWNER"]);

    const everything = [...files]
      .filter(([name]) => name !== "README.txt")
      .map(([, text]) => text)
      .join("\n");
    // Nothing from the other agency.
    expect(everything).not.toContain("Agency Two");
    expect(everything).not.toContain(b.agency.id);
    // No secrets.
    for (const secret of [
      "secret-share-token",
      "hash-AgencyOne",
      "verify-secret",
      "tokenHash",
      "shareToken",
      "password",
      "pdfKey",
    ]) {
      expect(everything, secret).not.toContain(secret);
    }
  });

  it("can only be downloaded by the owner of that agency, before it expires", async () => {
    const a = await setup("Agency One");
    const b = await setup("Agency Two");
    const row = await requestExport(a.owner.ctx, { now, enqueue: async () => undefined });
    await expect(readExport(a.owner.ctx, row.id, now)).rejects.toThrow(NotFoundError);
    await buildAgencyExport(a.agency.id, row.id);
    await expect(readExport(b.owner.ctx, row.id, now)).rejects.toThrow(NotFoundError);
    await expect(readExport(a.admin.ctx, row.id, now)).rejects.toThrow(ForbiddenError);
    await expect(readExport(a.owner.ctx, row.id, day(8))).rejects.toThrow(NotFoundError);
    expect((await readExport(a.owner.ctx, row.id, day(6))).bytes.length).toBeGreaterThan(100);
  });

  it("removes expired exports and their files", async () => {
    const a = await setup();
    const row = await requestExport(a.owner.ctx, { now, enqueue: async () => undefined });
    await buildAgencyExport(a.agency.id, row.id);
    const key = (await prisma.dataExport.findUniqueOrThrow({ where: { id: row.id } })).storageKey!;
    expect(await getStorage().get(key)).not.toBeNull();
    expect(await purgeExpiredExports(day(1))).toBe(0);
    expect(await purgeExpiredExports(day(8))).toBe(1);
    expect(await getStorage().get(key)).toBeNull();
  });

  it("skips an export that no longer exists", async () => {
    const a = await setup();
    expect(await buildAgencyExport(a.agency.id, "missing")).toEqual({ status: "SKIPPED" });
  });
});

describe("deleting an agency", () => {
  it("needs the owner and the exact name", async () => {
    const { owner, admin } = await setup("Agency One");
    await expect(deleteAgency(admin.ctx, { confirmName: "Agency One" }, now)).rejects.toThrow(
      ForbiddenError,
    );
    await expect(deleteAgency(owner.ctx, { confirmName: "" }, now)).rejects.toThrow(
      ValidationError,
    );
    await expect(deleteAgency(owner.ctx, { confirmName: "agency one" }, now)).rejects.toThrow(
      /does not match/,
    );
    expect(
      (await prisma.agency.findUniqueOrThrow({ where: { id: owner.ctx.agencyId } })).deletedAt,
    ).toBeNull();
  });

  it("closes the agency now and removes the data after 30 days", async () => {
    const { owner, agency } = await setup("Agency One");
    const slug = (await prisma.agency.findUniqueOrThrow({ where: { id: agency.id } })).slug;
    await deleteAgency(owner.ctx, { confirmName: "Agency One" }, now);

    const row = await prisma.agency.findUniqueOrThrow({ where: { id: agency.id } });
    expect(row).toMatchObject({ status: "DELETED" });
    expect(row.deletedAt?.toISOString()).toBe(now.toISOString());
    expect(
      (await prisma.subscription.findFirstOrThrow({ where: { agencyId: agency.id } })).status,
    ).toBe("CANCELED");
    expect(
      (await prisma.report.findFirstOrThrow({ where: { agencyId: agency.id } })).shareToken,
    ).toBeNull();
    expect(
      await prisma.branding.findFirstOrThrow({ where: { agencyId: agency.id } }),
    ).toMatchObject({ customDomain: null, customDomainStatus: "NONE" });
    expect(await loadTenantContext(owner.ctx.userId, slug)).toBeNull();
    expect(
      (await prisma.activityLog.findMany({ where: { agencyId: agency.id } })).map((l) => l.action),
    ).toContain("agency.deleted");
    expect(sendBillingNoticeEmail).toHaveBeenCalledTimes(1);

    // Not yet purged after 29 days; gone after 31.
    await purgeExpired(prisma, day(29));
    expect(await prisma.agency.count({ where: { id: agency.id } })).toBe(1);
    await purgeExpired(prisma, day(31));
    expect(await prisma.agency.count({ where: { id: agency.id } })).toBe(0);
    expect(await prisma.client.count({ where: { agencyId: agency.id } })).toBe(0);
    await expect(deleteAgency(owner.ctx, { confirmName: "Agency One" }, now)).rejects.toThrow();
  });
});
