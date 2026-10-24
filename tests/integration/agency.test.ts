import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadTenantContext, listUserAgencies } from "@/server/auth/tenant-context";
import { createAgency, getAgency, updateAgencySettings } from "@/server/services/agency";
import { ForbiddenError, ValidationError } from "@/server/services/errors";
import { createAgencyWithMembers, createUser, seedPlans } from "../factories";
import { createTestClient, resetDb } from "../helpers/db";

const prisma = createTestClient();

beforeAll(async () => {
  await resetDb(prisma);
  await seedPlans(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("createAgency", () => {
  it("makes the user the owner and starts a 14 day trial on STARTER", async () => {
    const user = await createUser(prisma);
    const agency = await createAgency(user.id, {
      name: "Acme Digital",
      slug: "acme-digital",
      timezone: "Europe/Paris",
    });
    expect(agency.timezone).toBe("Europe/Paris");

    const member = await prisma.agencyMember.findFirstOrThrow({ where: { agencyId: agency.id } });
    expect(member).toMatchObject({ userId: user.id, role: "OWNER" });

    const sub = await prisma.subscription.findUniqueOrThrow({
      where: { agencyId: agency.id },
      include: { plan: true },
    });
    expect(sub.status).toBe("TRIALING");
    expect(sub.plan.code).toBe("STARTER");
    const days = (sub.trialEndsAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThanOrEqual(14);

    const log = await prisma.activityLog.findFirstOrThrow({ where: { agencyId: agency.id } });
    expect(log).toMatchObject({ action: "agency.created", actorUserId: user.id });
  });

  it("rejects a taken slug, reserved slug, bad time zone and short name", async () => {
    const user = await createUser(prisma);
    await createAgency(user.id, { name: "First", slug: "taken-slug", timezone: "UTC" });
    const other = await createUser(prisma);
    await expect(
      createAgency(other.id, { name: "Second", slug: "taken-slug", timezone: "UTC" }),
    ).rejects.toMatchObject({ fieldErrors: { slug: expect.stringContaining("taken") } });
    await expect(
      createAgency(other.id, { name: "Second", slug: "admin", timezone: "UTC" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createAgency(other.id, { name: "Second", slug: "second-one", timezone: "Mars/Base" }),
    ).rejects.toMatchObject({ fieldErrors: { timezone: expect.any(String) } });
    await expect(
      createAgency(other.id, { name: "x", slug: "second-one", timezone: "UTC" }),
    ).rejects.toMatchObject({ fieldErrors: { name: expect.any(String) } });
  });
});

describe("loadTenantContext", () => {
  it("returns the context for members and null for everyone else", async () => {
    const { agency, members } = await createAgencyWithMembers(prisma, ["OWNER", "MEMBER"]);
    const outsider = await createUser(prisma);

    expect(await loadTenantContext(members[1]!.user.id, agency.slug)).toEqual({
      userId: members[1]!.user.id,
      agencyId: agency.id,
      role: "MEMBER",
    });
    expect(await loadTenantContext(outsider.id, agency.slug)).toBeNull();
    expect(await loadTenantContext(members[0]!.user.id, "no-such-agency")).toBeNull();
  });

  it("returns null for suspended or deleted agencies", async () => {
    const { agency, members } = await createAgencyWithMembers(prisma, ["OWNER"]);
    await prisma.agency.update({ where: { id: agency.id }, data: { status: "SUSPENDED" } });
    expect(await loadTenantContext(members[0]!.user.id, agency.slug)).toBeNull();
    await prisma.agency.update({
      where: { id: agency.id },
      data: { status: "ACTIVE", deletedAt: new Date() },
    });
    expect(await loadTenantContext(members[0]!.user.id, agency.slug)).toBeNull();
  });

  it("lists only the agencies the user belongs to", async () => {
    const a = await createAgencyWithMembers(prisma, ["OWNER"]);
    await createAgencyWithMembers(prisma, ["OWNER"]);
    const list = await listUserAgencies(a.members[0]!.user.id);
    expect(list.map((x) => x.id)).toEqual([a.agency.id]);
  });
});

describe("agency settings", () => {
  it("lets owners and admins edit, not members", async () => {
    const { agency, members } = await createAgencyWithMembers(prisma, ["OWNER", "ADMIN", "MEMBER"]);
    const input = { name: "Renamed Agency", timezone: "Asia/Kolkata" };
    await updateAgencySettings(members[1]!.ctx, input);
    expect((await getAgency(members[0]!.ctx)).name).toBe("Renamed Agency");
    await expect(updateAgencySettings(members[2]!.ctx, input)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(agency.id).toBe(members[0]!.ctx.agencyId);
  });
});
