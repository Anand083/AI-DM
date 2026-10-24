import "server-only";
import type { InviteRole, MemberRole } from "@prisma/client";
import { z } from "zod";
import { getEnv } from "@/env";
import { can, canManageMember, TEAM_INVITE_ROLES } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db, rawDb } from "@/server/db/client";
import { generateToken, hashToken } from "@/server/tokens";
import { logActivity } from "./activity";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { sendInviteEmail } from "./email";
import { paging, type Page } from "./paging";
import { assertCountWithinLimit } from "./plan";

export const INVITE_DAYS = 7;

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.")),
  role: z.enum(TEAM_INVITE_ROLES),
});

export const changeRoleSchema = z.object({
  memberId: z.string().min(1),
  role: z.enum(TEAM_INVITE_ROLES),
});

const ROLE_LABEL: Record<InviteRole, string> = {
  ADMIN: "an admin",
  MEMBER: "a team member",
  CLIENT: "a client",
};

function requireTeamManage(ctx: TenantContext): void {
  if (!can(ctx.role, "team.manage")) throw new ForbiddenError();
}

export async function listMembers(ctx: TenantContext, p: Page = {}) {
  if (!can(ctx.role, "data.view") || ctx.role === "CLIENT") throw new ForbiddenError();
  const { take, skip } = paging(p);
  const [rows, total] = await Promise.all([
    db.agencyMember.findMany({
      where: { agencyId: ctx.agencyId },
      select: {
        id: true,
        role: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take,
      skip,
    }),
    db.agencyMember.count({ where: { agencyId: ctx.agencyId } }),
  ]);
  return { rows, total };
}

export async function listPendingInvitations(ctx: TenantContext, p: Page = {}) {
  requireTeamManage(ctx);
  const { take, skip } = paging(p);
  const where = {
    agencyId: ctx.agencyId,
    acceptedAt: null,
    role: { in: ["ADMIN", "MEMBER"] as InviteRole[] },
  };
  const [rows, total] = await Promise.all([
    db.invitation.findMany({
      where,
      select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take,
      skip,
    }),
    db.invitation.count({ where }),
  ]);
  return { rows, total };
}

function inviteUrl(token: string): string {
  return `${getEnv().APP_URL}/invite/${token}`;
}

async function emailInvitation(
  ctx: TenantContext,
  invitation: { email: string; role: InviteRole },
  token: string,
) {
  const [agency, inviter] = await Promise.all([
    db.agency.findUniqueOrThrow({ where: { id: ctx.agencyId }, select: { name: true } }),
    // Plain user lookup: User is not a tenant table.
    db.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { name: true } }),
  ]);
  await sendInviteEmail(invitation.email, {
    brandName: agency.name,
    inviterName: inviter.name,
    roleLabel: ROLE_LABEL[invitation.role],
    url: inviteUrl(token),
  });
}

export async function inviteMember(ctx: TenantContext, rawInput: unknown) {
  requireTeamManage(ctx);
  const parsed = inviteSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid input.", {
      email: parsed.error.issues[0]?.message ?? "Invalid input.",
    });
  }
  const { email, role } = parsed.data;

  const existingMember = await db.agencyMember.findFirst({
    where: { agencyId: ctx.agencyId, user: { email } },
    select: { id: true },
  });
  if (existingMember) throw new ConflictError("This person is already in your team.");

  const pending = await db.invitation.findFirst({
    where: { agencyId: ctx.agencyId, email, acceptedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true },
  });
  if (pending)
    throw new ConflictError("This person already has an invitation. You can send it again.");

  const [memberCount, pendingCount] = await Promise.all([
    db.agencyMember.count({ where: { agencyId: ctx.agencyId } }),
    db.invitation.count({
      where: {
        agencyId: ctx.agencyId,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
        role: { in: ["ADMIN", "MEMBER"] },
      },
    }),
  ]);
  await assertCountWithinLimit(ctx, "maxTeamMembers", memberCount + pendingCount);

  const token = generateToken();
  const invitation = await db.invitation.create({
    data: {
      agencyId: ctx.agencyId,
      email,
      role,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
      invitedById: ctx.userId,
    },
    select: { id: true, email: true, role: true, expiresAt: true },
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "team.invited",
    targetType: "Invitation",
    targetId: invitation.id,
    metadata: { email, role },
  });
  await emailInvitation(ctx, invitation, token);
  return invitation;
}

async function findOpenInvitation(ctx: TenantContext, invitationId: string) {
  const invitation = await db.invitation.findFirst({
    where: { id: invitationId, agencyId: ctx.agencyId, acceptedAt: null },
    select: { id: true, email: true, role: true },
  });
  if (!invitation) throw new NotFoundError("Invitation not found.");
  return invitation;
}

/** Sends the invitation again with a fresh link and a fresh 7 days. The old link stops working. */
export async function resendInvitation(ctx: TenantContext, invitationId: string) {
  requireTeamManage(ctx);
  const invitation = await findOpenInvitation(ctx, invitationId);
  const token = generateToken();
  await db.invitation.update({
    where: { id: invitation.id, agencyId: ctx.agencyId },
    data: {
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
    },
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "team.invite_resent",
    targetType: "Invitation",
    targetId: invitation.id,
  });
  await emailInvitation(ctx, invitation, token);
}

export async function revokeInvitation(ctx: TenantContext, invitationId: string) {
  requireTeamManage(ctx);
  const invitation = await findOpenInvitation(ctx, invitationId);
  await db.invitation.delete({ where: { id: invitation.id, agencyId: ctx.agencyId } });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "team.invite_revoked",
    targetType: "Invitation",
    targetId: invitation.id,
    metadata: { email: invitation.email },
  });
}

async function findMember(ctx: TenantContext, memberId: string) {
  const member = await db.agencyMember.findFirst({
    where: { id: memberId, agencyId: ctx.agencyId },
    select: { id: true, userId: true, role: true },
  });
  if (!member) throw new NotFoundError("Team member not found.");
  return member;
}

export async function changeMemberRole(ctx: TenantContext, rawInput: unknown) {
  requireTeamManage(ctx);
  const parsed = changeRoleSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError("Choose a valid role.");
  const member = await findMember(ctx, parsed.data.memberId);

  if (member.userId === ctx.userId) throw new ForbiddenError("You cannot change your own role.");
  if (!canManageMember(ctx.role, member.role)) throw new ForbiddenError();
  if (member.role === "OWNER") throw new ForbiddenError("The owner role cannot be changed here.");

  await db.agencyMember.update({
    where: { id: member.id, agencyId: ctx.agencyId },
    data: { role: parsed.data.role },
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "team.role_changed",
    targetType: "AgencyMember",
    targetId: member.id,
    metadata: { from: member.role, to: parsed.data.role },
  });
}

export async function removeMember(ctx: TenantContext, memberId: string) {
  requireTeamManage(ctx);
  const member = await findMember(ctx, memberId);

  if (member.userId === ctx.userId) throw new ForbiddenError("You cannot remove yourself.");
  if (!canManageMember(ctx.role, member.role)) throw new ForbiddenError();
  if (member.role === "OWNER") {
    const owners = await db.agencyMember.count({
      where: { agencyId: ctx.agencyId, role: "OWNER" },
    });
    if (owners <= 1) throw new ForbiddenError("An agency must keep at least one owner.");
  }

  await db.agencyMember.delete({ where: { id: member.id, agencyId: ctx.agencyId } });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "team.member_removed",
    targetType: "AgencyMember",
    targetId: member.id,
    metadata: { role: member.role },
  });
}

export type InvitationPreview = {
  status: "valid" | "expired" | "used" | "invalid";
  agencyName?: string;
  role?: InviteRole;
  email?: string;
};

/**
 * Looks up an invitation by its secret link token. The token is the proof of access, so this
 * lookup (before we know the agency) uses the plain client.
 */
async function findInvitationByToken(token: string) {
  return rawDb.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      agencyId: true,
      email: true,
      role: true,
      clientId: true,
      expiresAt: true,
      acceptedAt: true,
      agency: { select: { name: true, slug: true, status: true, deletedAt: true } },
    },
  });
}

export async function previewInvitation(token: string): Promise<InvitationPreview> {
  const invitation = await findInvitationByToken(token);
  if (!invitation || invitation.agency.status !== "ACTIVE" || invitation.agency.deletedAt) {
    return { status: "invalid" };
  }
  const base = {
    agencyName: invitation.agency.name,
    role: invitation.role,
    email: invitation.email,
  };
  if (invitation.acceptedAt) return { status: "used", ...base };
  if (invitation.expiresAt <= new Date()) return { status: "expired", ...base };
  return { status: "valid", ...base };
}

/**
 * Accepts an invitation for a signed-in, verified user. The user's email must match the
 * invited email. The link works once. Returns the agency slug to open next.
 */
export async function acceptInvitation(
  user: { id: string; email: string; emailVerified: boolean },
  token: string,
): Promise<{ agencySlug: string; role: InviteRole }> {
  const invitation = await findInvitationByToken(token);
  if (!invitation || invitation.agency.status !== "ACTIVE" || invitation.agency.deletedAt) {
    throw new NotFoundError("This invitation is not valid.");
  }
  if (invitation.acceptedAt) throw new ConflictError("This invitation was already used.");
  if (invitation.expiresAt <= new Date())
    throw new ConflictError("This invitation has expired. Ask for a new one.");
  if (!user.emailVerified) throw new ForbiddenError("Please confirm your email first.");
  if (invitation.email.toLowerCase() !== user.email.toLowerCase()) {
    throw new ForbiddenError(
      `This invitation was sent to ${invitation.email}. Sign in with that email.`,
    );
  }

  await db.$transaction(async (tx) => {
    // Claim the invitation first. If two requests race, only one updates a row.
    const claimed = await tx.invitation.updateMany({
      where: { id: invitation.id, agencyId: invitation.agencyId, acceptedAt: null },
      data: { acceptedAt: new Date() },
    });
    if (claimed.count !== 1) throw new ConflictError("This invitation was already used.");

    if (invitation.role === "CLIENT") {
      if (!invitation.clientId) throw new ValidationError("This client invitation is broken.");
      await tx.clientUser.upsert({
        where: {
          agencyId: invitation.agencyId,
          clientId_userId: { clientId: invitation.clientId, userId: user.id },
        },
        create: { agencyId: invitation.agencyId, clientId: invitation.clientId, userId: user.id },
        update: {},
      });
    } else {
      await tx.agencyMember.upsert({
        where: { agencyId_userId: { agencyId: invitation.agencyId, userId: user.id } },
        create: {
          agencyId: invitation.agencyId,
          userId: user.id,
          role: invitation.role as MemberRole,
        },
        update: {},
      });
    }
    await logActivity(
      {
        agencyId: invitation.agencyId,
        actorUserId: user.id,
        action: "team.invite_accepted",
        targetType: "Invitation",
        targetId: invitation.id,
        metadata: { role: invitation.role },
      },
      tx,
    );
  });
  return { agencySlug: invitation.agency.slug, role: invitation.role };
}
