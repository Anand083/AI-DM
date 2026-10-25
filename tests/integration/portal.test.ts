import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPortalContext, type PortalContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import {
  inviteClientUser,
  listClientUsers,
  removeClientUser,
  revokeClientInvitation,
} from "@/server/services/client-users";
import {
  ConflictError,
  ForbiddenError,
  LimitExceededError,
  NotFoundError,
  ValidationError,
} from "@/server/services/errors";
import {
  getPortalAudit,
  getPortalProject,
  getPortalReport,
  listPortalKeywords,
  listPortalProjects,
  listPortalReports,
  readPortalReportPdf,
} from "@/server/services/portal";
import { createClientAccount, previewPortalInvite } from "@/server/services/portal-invite";
import { listMembers, acceptInvitation } from "@/server/services/team";
import { hashToken } from "@/server/tokens";
import { createAgencyWithMembers, createUser, seedPlans } from "../factories";
import { createTestClient, resetDb } from "../helpers/db";

vi.mock("@/server/services/email", () => ({
  sendClientInviteEmail: vi.fn(async () => undefined),
  sendInviteEmail: vi.fn(async () => undefined),
}));

const prisma = createTestClient();

async function project(agencyId: string, clientId: string, name: string) {
  return prisma.project.create({
    data: {
      agencyId,
      clientId,
      name,
      domain: `${name.toLowerCase()}.test`,
      locationCode: 2840,
      languageCode: "en",
    },
  });
}

async function setup() {
  const { agency, members } = await createAgencyWithMembers(
    prisma,
    ["OWNER", "MEMBER"],
    "Agency One",
    "STARTER",
  );
  await prisma.branding.create({ data: { agencyId: agency.id, displayName: "Bright Studio" } });
  const clientA = await prisma.client.create({ data: { agencyId: agency.id, name: "Client A" } });
  const clientB = await prisma.client.create({ data: { agencyId: agency.id, name: "Client B" } });
  const projectA = await project(agency.id, clientA.id, "SiteA");
  const projectB = await project(agency.id, clientB.id, "SiteB");
  for (const [p, phrase] of [
    [projectA, "keyword a"],
    [projectB, "keyword b"],
  ] as const) {
    await prisma.keyword.create({
      data: {
        agencyId: agency.id,
        projectId: p.id,
        phrase,
        lastCheckedOn: new Date("2026-03-01"),
        currentPosition: 5,
      },
    });
  }
  const reportData = (title: string) => ({
    agencyId: agency.id,
    title,
    status: "READY" as const,
    periodStart: new Date("2026-03-01"),
    periodEnd: new Date("2026-03-31"),
    sections: ["summary"],
    data: { version: 1, title, sections: ["summary"] },
    pdfKey: null,
  });
  const reportA = await prisma.report.create({
    data: { ...reportData("Report A"), projectId: projectA.id },
  });
  const reportB = await prisma.report.create({
    data: { ...reportData("Report B"), projectId: projectB.id },
  });
  const clientUser = await createUser(prisma);
  await prisma.clientUser.create({
    data: { agencyId: agency.id, clientId: clientA.id, userId: clientUser.id },
  });
  const portal = (await loadPortalContext(
    clientUser.id,
    (await prisma.agency.findUniqueOrThrow({ where: { id: agency.id } })).slug,
  ))!;
  return {
    agency,
    owner: members[0]!,
    member: members[1]!,
    clientA,
    clientB,
    projectA,
    projectB,
    reportA,
    reportB,
    portal,
    clientUser,
  };
}

beforeEach(async () => {
  await resetDb(prisma);
  await seedPlans(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("inviting client users", () => {
  it("lets team members invite, and lists pending invitations", async () => {
    const { owner, member, clientA } = await setup();
    await inviteClientUser(member.ctx, { clientId: clientA.id, email: "New@Client.test" });
    const list = await listClientUsers(owner.ctx, clientA.id);
    expect(list.users).toHaveLength(1);
    expect(list.pending.map((p) => p.email)).toEqual(["new@client.test"]);
    const row = await prisma.invitation.findFirstOrThrow({ where: { email: "new@client.test" } });
    expect(row).toMatchObject({ role: "CLIENT", clientId: clientA.id });
  });

  it("refuses duplicates, bad emails, archived clients, other agencies and client users", async () => {
    const a = await setup();
    const b = await setup();
    const ctx = a.owner.ctx;
    await inviteClientUser(ctx, { clientId: a.clientA.id, email: "x@client.test" });
    await expect(
      inviteClientUser(ctx, { clientId: a.clientA.id, email: "x@client.test" }),
    ).rejects.toThrow(ConflictError);
    await expect(inviteClientUser(ctx, { clientId: a.clientA.id, email: "nope" })).rejects.toThrow(
      ValidationError,
    );
    await expect(
      inviteClientUser(ctx, { clientId: b.clientA.id, email: "y@client.test" }),
    ).rejects.toThrow(NotFoundError);
    await prisma.client.update({ where: { id: a.clientB.id }, data: { status: "ARCHIVED" } });
    await expect(
      inviteClientUser(ctx, { clientId: a.clientB.id, email: "z@client.test" }),
    ).rejects.toThrow(ConflictError);
    await expect(
      inviteClientUser(a.portal, { clientId: a.clientA.id, email: "w@client.test" }),
    ).rejects.toThrow(ForbiddenError);
    const existing = await prisma.user.findUniqueOrThrow({ where: { id: a.clientUser.id } });
    await expect(
      inviteClientUser(ctx, { clientId: a.clientA.id, email: existing.email }),
    ).rejects.toThrow(/already has access/);
  });

  it("stops at the plan limit for client users", async () => {
    const { owner, clientA } = await setup();
    // STARTER allows a few client users. One already exists.
    const plan = await prisma.plan.findUniqueOrThrow({ where: { code: "STARTER" } });
    const limit = (plan.limits as { maxClientUsers: number }).maxClientUsers;
    for (let i = 0; i < limit - 1; i++) {
      await inviteClientUser(owner.ctx, { clientId: clientA.id, email: `p${i}@client.test` });
    }
    await expect(
      inviteClientUser(owner.ctx, { clientId: clientA.id, email: "over@client.test" }),
    ).rejects.toThrow(LimitExceededError);
  });

  it("revokes invitations and removes access", async () => {
    const { owner, clientA, agency } = await setup();
    await inviteClientUser(owner.ctx, { clientId: clientA.id, email: "r@client.test" });
    const { pending, users } = await listClientUsers(owner.ctx, clientA.id);
    await revokeClientInvitation(owner.ctx, pending[0]!.id);
    await expect(revokeClientInvitation(owner.ctx, pending[0]!.id)).rejects.toThrow(NotFoundError);
    await removeClientUser(owner.ctx, users[0]!.id);
    expect(await prisma.clientUser.count({ where: { agencyId: agency.id } })).toBe(0);
    await expect(removeClientUser(owner.ctx, users[0]!.id)).rejects.toThrow(NotFoundError);
  });
});

describe("accepting a client invitation in the portal", () => {
  async function invited(email = "fresh@client.test") {
    const s = await setup();
    await inviteClientUser(s.owner.ctx, { clientId: s.clientA.id, email });
    // The token is only in the email, so make a known one for the test.
    const token = "t".repeat(40);
    await prisma.invitation.updateMany({ where: { email }, data: { tokenHash: hashToken(token) } });
    const slug = (await prisma.agency.findUniqueOrThrow({ where: { id: s.agency.id } })).slug;
    return { ...s, token, slug, email };
  }

  it("previews, creates a verified account without a platform email, and gives access", async () => {
    const { token, slug, email, clientA, agency } = await invited();
    expect(await previewPortalInvite(slug, token, "Bright Studio")).toMatchObject({
      status: "valid",
      email,
      hasAccount: false,
    });
    expect((await previewPortalInvite("other-agency", token, "X")).status).toBe("invalid");

    await expect(
      createClientAccount(slug, token, { name: "Pat", password: "short" }),
    ).rejects.toThrow(ValidationError);
    await createClientAccount(slug, token, { name: "Pat", password: "a-long-enough-password" });
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      include: { accounts: true },
    });
    expect(user).toMatchObject({ name: "Pat", emailVerified: true });
    expect(user.accounts[0]).toMatchObject({ providerId: "credential" });
    expect(user.accounts[0]!.password).toMatch(/\S{20,}/);
    await expect(
      createClientAccount(slug, token, { name: "Pat", password: "a-long-enough-password" }),
    ).rejects.toThrow(/already exists/);

    await acceptInvitation(user, token);
    const ctx = await loadPortalContext(user.id, slug);
    expect(ctx).toMatchObject({ role: "CLIENT", clientIds: [clientA.id], agencyId: agency.id });
    expect((await previewPortalInvite(slug, token, "Bright Studio")).status).toBe("used");
  });

  it("does not accept expired invitations or invitations for team roles", async () => {
    const { token, slug, email, owner } = await invited("late@client.test");
    await prisma.invitation.updateMany({
      where: { email },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await previewPortalInvite(slug, token, "B")).status).toBe("expired");
    await expect(
      createClientAccount(slug, token, { name: "Pat", password: "a-long-enough-password" }),
    ).rejects.toThrow(/expired/);
    await prisma.invitation.create({
      data: {
        agencyId: owner.ctx.agencyId,
        email: "team@x.test",
        role: "MEMBER",
        tokenHash: hashToken("m".repeat(40)),
        expiresAt: new Date(Date.now() + 1e6),
        invitedById: owner.ctx.userId,
      },
    });
    expect((await previewPortalInvite(slug, "m".repeat(40), "B")).status).toBe("invalid");
  });
});

describe("client isolation", () => {
  function expectOnlyA(ids: string[], s: Awaited<ReturnType<typeof setup>>) {
    expect(ids).toContain(s.projectA.id);
    expect(ids).not.toContain(s.projectB.id);
  }

  it("lists only the projects and reports of the invited client", async () => {
    const s = await setup();
    expectOnlyA(
      (await listPortalProjects(s.portal)).items.map((p) => p.id),
      s,
    );
    expect((await listPortalReports(s.portal)).items.map((r) => r.id)).toEqual([s.reportA.id]);
    expect((await listPortalProjects(s.portal)).items[0]).toMatchObject({
      name: "SiteA",
      keywords: 1,
      top10: 1,
    });
  });

  it("gives not found for another client's data", async () => {
    const s = await setup();
    await expect(getPortalProject(s.portal, s.projectB.id)).rejects.toThrow(NotFoundError);
    await expect(listPortalKeywords(s.portal, s.projectB.id)).rejects.toThrow(NotFoundError);
    await expect(getPortalAudit(s.portal, s.projectB.id)).rejects.toThrow(NotFoundError);
    await expect(getPortalReport(s.portal, s.reportB.id)).rejects.toThrow(NotFoundError);
    expect(await readPortalReportPdf(s.portal, s.reportB.id)).toBeNull();
    expect((await listPortalReports(s.portal, { projectId: s.projectB.id })).items).toEqual([]);
    expect((await listPortalKeywords(s.portal, s.projectA.id)).items.map((k) => k.phrase)).toEqual([
      "keyword a",
    ]);
  });

  it("does not leak across agencies", async () => {
    const a = await setup();
    const b = await setup();
    await expect(getPortalProject(a.portal, b.projectA.id)).rejects.toThrow(NotFoundError);
    await expect(getPortalReport(a.portal, b.reportA.id)).rejects.toThrow(NotFoundError);
  });

  it("hides archived clients, unfinished reports and removed access", async () => {
    const s = await setup();
    await prisma.report.update({ where: { id: s.reportA.id }, data: { status: "GENERATING" } });
    expect((await listPortalReports(s.portal)).items).toEqual([]);
    await prisma.client.update({ where: { id: s.clientA.id }, data: { status: "ARCHIVED" } });
    expect((await listPortalProjects(s.portal)).items).toEqual([]);
    const slug = (await prisma.agency.findUniqueOrThrow({ where: { id: s.agency.id } })).slug;
    expect(await loadPortalContext(s.clientUser.id, slug)).toBeNull();
  });

  it("gives team members and strangers no portal context, and client users no team access", async () => {
    const s = await setup();
    const slug = (await prisma.agency.findUniqueOrThrow({ where: { id: s.agency.id } })).slug;
    expect(await loadPortalContext(s.owner.user.id, slug)).toBeNull();
    const stranger = await createUser(prisma);
    expect(await loadPortalContext(stranger.id, slug)).toBeNull();
    const forged: PortalContext = { ...s.portal, clientIds: [s.clientA.id] };
    await expect(listMembers(forged)).rejects.toThrow(ForbiddenError);
    expect(await db.clientUser.count({ where: { agencyId: s.agency.id } })).toBe(1);
  });
});
