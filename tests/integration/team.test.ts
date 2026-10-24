import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashToken } from "@/server/tokens";
import {
  acceptInvitation,
  changeMemberRole,
  inviteMember,
  listMembers,
  listPendingInvitations,
  previewInvitation,
  removeMember,
  resendInvitation,
  revokeInvitation,
} from "@/server/services/team";
import {
  ConflictError,
  ForbiddenError,
  LimitExceededError,
  NotFoundError,
} from "@/server/services/errors";
import { createAgencyWithMembers, createUser, seedPlans } from "../factories";
import { createTestClient, resetDb } from "../helpers/db";

type Sent = { to: string; subject: string; html: string; text: string; fromName?: string };
const sent: Sent[] = [];

// Emails go through the queue in the real app. Here we catch them instead.
vi.mock("@/server/jobs/enqueue", () => ({
  enqueueEmail: async (m: Sent) => void sent.push(m),
}));

const prisma = createTestClient();

beforeAll(async () => {
  await resetDb(prisma);
  await seedPlans(prisma);
});
beforeEach(() => {
  sent.length = 0;
});
afterAll(async () => {
  await prisma.$disconnect();
});

function tokenFromLastEmail(to: string): string {
  const mail = [...sent].reverse().find((m) => m.to === to);
  const match = mail?.text.match(/\/invite\/([A-Za-z0-9_-]+)/);
  if (!match) throw new Error("no invite link in email");
  return match[1]!;
}

async function setup() {
  const { agency, members } = await createAgencyWithMembers(
    prisma,
    ["OWNER", "ADMIN", "MEMBER"],
    undefined,
    "AGENCY",
  );
  const [owner, admin, member] = members;
  return { agency, owner: owner!, admin: admin!, member: member! };
}

describe("inviting", () => {
  it("stores only a hash, emails a link with the agency name, and writes the activity log", async () => {
    const { agency, owner } = await setup();
    const invitation = await inviteMember(owner.ctx, {
      email: "New.Person@Example.test",
      role: "MEMBER",
    });
    expect(invitation.email).toBe("new.person@example.test");

    const token = tokenFromLastEmail("new.person@example.test");
    const row = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(row.tokenHash).toBe(hashToken(token));
    expect(row.tokenHash).not.toContain(token);
    expect(row.agencyId).toBe(agency.id);

    const mail = sent[0]!;
    expect(mail.html).toContain(agency.name);
    expect(mail.html).not.toContain("SEO Platform");
    expect(mail.fromName).toBe(agency.name);

    const log = await prisma.activityLog.findFirst({
      where: { agencyId: agency.id, action: "team.invited" },
    });
    expect(log).not.toBeNull();
  });

  it("lets admins invite but not members", async () => {
    const { admin, member } = await setup();
    await expect(
      inviteMember(admin.ctx, { email: "a@example.test", role: "ADMIN" }),
    ).resolves.toBeTruthy();
    await expect(
      inviteMember(member.ctx, { email: "b@example.test", role: "MEMBER" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("cannot invite owners, bad emails, existing members, or the same person twice", async () => {
    const { owner, member } = await setup();
    await expect(
      inviteMember(owner.ctx, { email: "x@example.test", role: "OWNER" }),
    ).rejects.toBeTruthy();
    await expect(
      inviteMember(owner.ctx, { email: "not-an-email", role: "MEMBER" }),
    ).rejects.toBeTruthy();
    await expect(
      inviteMember(owner.ctx, { email: member.user.email, role: "MEMBER" }),
    ).rejects.toBeInstanceOf(ConflictError);
    await inviteMember(owner.ctx, { email: "dup@example.test", role: "MEMBER" });
    await expect(
      inviteMember(owner.ctx, { email: "dup@example.test", role: "MEMBER" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("lists pending invitations and members with paging", async () => {
    const { owner } = await setup();
    for (let i = 0; i < 3; i++)
      await inviteMember(owner.ctx, { email: `p${i}@example.test`, role: "MEMBER" });
    const page = await listPendingInvitations(owner.ctx, { page: 1, pageSize: 2 });
    expect(page.rows).toHaveLength(2);
    expect(page.total).toBe(3);
    const members = await listMembers(owner.ctx, { pageSize: 2 });
    expect(members.rows).toHaveLength(2);
    expect(members.total).toBe(3);
    expect((await listMembers(owner.ctx, { pageSize: 100000 })).rows.length).toBeLessThanOrEqual(
      100,
    );
  });
});

describe("accepting", () => {
  it("adds the user to the agency with the invited role, once", async () => {
    const { agency, owner } = await setup();
    const invitee = await createUser(prisma, { email: "joiner@example.test" });
    await inviteMember(owner.ctx, { email: "joiner@example.test", role: "ADMIN" });
    const token = tokenFromLastEmail("joiner@example.test");

    expect((await previewInvitation(token)).status).toBe("valid");
    const result = await acceptInvitation(invitee, token);
    expect(result).toEqual({ agencySlug: agency.slug, role: "ADMIN" });

    const member = await prisma.agencyMember.findFirstOrThrow({
      where: { agencyId: agency.id, userId: invitee.id },
    });
    expect(member.role).toBe("ADMIN");
    expect((await previewInvitation(token)).status).toBe("used");
    await expect(acceptInvitation(invitee, token)).rejects.toBeInstanceOf(ConflictError);
  });

  it("only works for the invited email and a verified user", async () => {
    const { owner } = await setup();
    await inviteMember(owner.ctx, { email: "right@example.test", role: "MEMBER" });
    const token = tokenFromLastEmail("right@example.test");
    const wrong = await createUser(prisma, { email: "wrong@example.test" });
    await expect(acceptInvitation(wrong, token)).rejects.toBeInstanceOf(ForbiddenError);
    const unverified = await createUser(prisma, {
      email: "right@example.test",
      emailVerified: false,
    });
    await expect(acceptInvitation(unverified, token)).rejects.toThrow(/confirm your email/);
  });

  it("rejects expired and unknown tokens", async () => {
    const { owner } = await setup();
    const invitee = await createUser(prisma, { email: "late@example.test" });
    const inv = await inviteMember(owner.ctx, { email: "late@example.test", role: "MEMBER" });
    const token = tokenFromLastEmail("late@example.test");
    await prisma.invitation.update({
      where: { id: inv.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await previewInvitation(token)).status).toBe("expired");
    await expect(acceptInvitation(invitee, token)).rejects.toBeInstanceOf(ConflictError);
    expect((await previewInvitation("nope-nope-nope")).status).toBe("invalid");
    await expect(acceptInvitation(invitee, "nope-nope-nope")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("only one of two parallel accepts succeeds", async () => {
    const { agency, owner } = await setup();
    const invitee = await createUser(prisma, { email: "race@example.test" });
    await inviteMember(owner.ctx, { email: "race@example.test", role: "MEMBER" });
    const token = tokenFromLastEmail("race@example.test");
    const results = await Promise.allSettled([
      acceptInvitation(invitee, token),
      acceptInvitation(invitee, token),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await prisma.agencyMember.count({ where: { agencyId: agency.id, userId: invitee.id } }),
    ).toBe(1);
  });
});

describe("resend and revoke", () => {
  it("resend kills the old link and gives a working new one", async () => {
    const { owner } = await setup();
    const invitee = await createUser(prisma, { email: "again@example.test" });
    const inv = await inviteMember(owner.ctx, { email: "again@example.test", role: "MEMBER" });
    const oldToken = tokenFromLastEmail("again@example.test");
    await resendInvitation(owner.ctx, inv.id);
    const newToken = tokenFromLastEmail("again@example.test");
    expect(newToken).not.toBe(oldToken);
    expect((await previewInvitation(oldToken)).status).toBe("invalid");
    await expect(acceptInvitation(invitee, newToken)).resolves.toBeTruthy();
  });

  it("revoke removes the invitation", async () => {
    const { owner, member } = await setup();
    const inv = await inviteMember(owner.ctx, { email: "gone@example.test", role: "MEMBER" });
    const token = tokenFromLastEmail("gone@example.test");
    await expect(revokeInvitation(member.ctx, inv.id)).rejects.toBeInstanceOf(ForbiddenError);
    await revokeInvitation(owner.ctx, inv.id);
    expect((await previewInvitation(token)).status).toBe("invalid");
  });
});

describe("roles and removal", () => {
  it("owner changes a member to admin; nobody changes their own role", async () => {
    const { owner, member } = await setup();
    await changeMemberRole(owner.ctx, { memberId: member.member.id, role: "ADMIN" });
    expect(
      (await prisma.agencyMember.findUniqueOrThrow({ where: { id: member.member.id } })).role,
    ).toBe("ADMIN");
    await expect(
      changeMemberRole(owner.ctx, { memberId: owner.member.id, role: "MEMBER" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("an admin cannot change or remove an owner", async () => {
    const { admin, owner } = await setup();
    await expect(
      changeMemberRole(admin.ctx, { memberId: owner.member.id, role: "MEMBER" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(removeMember(admin.ctx, owner.member.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await prisma.agencyMember.count({ where: { id: owner.member.id } })).toBe(1);
  });

  it("an admin can remove a member; members cannot remove anyone; nobody removes themselves", async () => {
    const { admin, member, owner } = await setup();
    await expect(removeMember(member.ctx, admin.member.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(removeMember(admin.ctx, admin.member.id)).rejects.toBeInstanceOf(ForbiddenError);
    await removeMember(admin.ctx, member.member.id);
    expect(await prisma.agencyMember.count({ where: { id: member.member.id } })).toBe(0);
    const log = await prisma.activityLog.findFirst({
      where: { agencyId: owner.ctx.agencyId, action: "team.member_removed" },
    });
    expect(log?.actorUserId).toBe(admin.user.id);
  });

  it("an owner can remove another owner but the agency keeps one", async () => {
    const { members } = await createAgencyWithMembers(prisma, ["OWNER", "OWNER"]);
    await removeMember(members[0]!.ctx, members[1]!.member.id);
    expect(
      await prisma.agencyMember.count({
        where: { agencyId: members[0]!.ctx.agencyId, role: "OWNER" },
      }),
    ).toBe(1);
    await expect(removeMember(members[0]!.ctx, members[0]!.member.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("team size limit", () => {
  it("counts members and pending invitations against the plan", async () => {
    // STARTER allows 2 team members.
    const { members } = await createAgencyWithMembers(prisma, ["OWNER"], undefined, "STARTER");
    const owner = members[0]!.ctx;
    await inviteMember(owner, { email: "second@example.test", role: "MEMBER" });
    const error = await inviteMember(owner, { email: "third@example.test", role: "MEMBER" }).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(LimitExceededError);
    expect(error.message).toBe(
      "Your Starter plan allows up to 2 team members. Upgrade your plan to add more.",
    );
  });
});
