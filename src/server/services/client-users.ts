import "server-only";
import { z } from "zod";
import { getEnv } from "@/env";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { generateToken, hashToken } from "@/server/tokens";
import { logActivity } from "./activity";
import { loadBranding } from "./branding";
import { sendClientInviteEmail } from "./email";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { assertCountWithinLimit } from "./plan";

const INVITE_DAYS = 7;

export const clientInviteSchema = z.object({
  clientId: z.string().min(1),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.")),
});

function requireInvite(ctx: TenantContext): void {
  if (!can(ctx.role, "clientUsers.invite")) throw new ForbiddenError();
}

async function findClient(ctx: TenantContext, clientId: string) {
  const client = await db.client.findFirst({
    where: { id: clientId, agencyId: ctx.agencyId, deletedAt: null },
    select: { id: true, name: true, status: true },
  });
  if (!client) throw new NotFoundError("Client not found.");
  return client;
}

export function portalInviteUrl(agencySlug: string, token: string): string {
  return `${getEnv().APP_URL}/portal/${agencySlug}/invite/${token}`;
}

async function sendInvite(ctx: TenantContext, email: string, clientName: string, token: string) {
  const [agency, branding] = await Promise.all([
    db.agency.findUniqueOrThrow({ where: { id: ctx.agencyId }, select: { slug: true } }),
    loadBranding(ctx.agencyId),
  ]);
  await sendClientInviteEmail(email, {
    brandName: branding.displayName,
    clientName,
    url: portalInviteUrl(agency.slug, token),
    supportEmail: branding.supportEmail,
  });
}

/** People with portal access to a client, and invitations that are still open. */
export async function listClientUsers(ctx: TenantContext, clientId: string) {
  requireInvite(ctx);
  await findClient(ctx, clientId);
  const [users, pending] = await Promise.all([
    db.clientUser.findMany({
      where: { agencyId: ctx.agencyId, clientId },
      select: { id: true, createdAt: true, user: { select: { name: true, email: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 100,
    }),
    db.invitation.findMany({
      where: {
        agencyId: ctx.agencyId,
        clientId,
        role: "CLIENT",
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true, email: true, expiresAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 100,
    }),
  ]);
  return { users, pending };
}

export async function inviteClientUser(ctx: TenantContext, rawInput: unknown) {
  requireInvite(ctx);
  const parsed = clientInviteSchema.safeParse(rawInput);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid input.";
    throw new ValidationError(message, { email: message });
  }
  const { clientId, email } = parsed.data;
  const client = await findClient(ctx, clientId);
  if (client.status !== "ACTIVE") throw new ConflictError("This client is archived.");

  if (
    await db.clientUser.findFirst({
      where: { agencyId: ctx.agencyId, clientId, user: { email } },
      select: { id: true },
    })
  ) {
    throw new ConflictError("This person already has access.");
  }
  if (
    await db.invitation.findFirst({
      where: {
        agencyId: ctx.agencyId,
        clientId,
        email,
        role: "CLIENT",
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    })
  ) {
    throw new ConflictError("This person already has an invitation.");
  }

  const [users, pending] = await Promise.all([
    db.clientUser.count({ where: { agencyId: ctx.agencyId } }),
    db.invitation.count({
      where: {
        agencyId: ctx.agencyId,
        role: "CLIENT",
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
    }),
  ]);
  await assertCountWithinLimit(ctx, "maxClientUsers", users + pending);

  const token = generateToken();
  const invitation = await db.invitation.create({
    data: {
      agencyId: ctx.agencyId,
      email,
      role: "CLIENT",
      clientId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
      invitedById: ctx.userId,
    },
    select: { id: true, email: true, expiresAt: true },
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "client_user.invited",
    targetType: "Invitation",
    targetId: invitation.id,
    metadata: { clientId, email },
  });
  await sendInvite(ctx, email, client.name, token);
  return invitation;
}

export async function revokeClientInvitation(ctx: TenantContext, invitationId: string) {
  requireInvite(ctx);
  const result = await db.invitation.deleteMany({
    where: { id: invitationId, agencyId: ctx.agencyId, role: "CLIENT", acceptedAt: null },
  });
  if (result.count === 0) throw new NotFoundError("Invitation not found.");
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "client_user.invite_revoked",
    targetType: "Invitation",
    targetId: invitationId,
  });
}

/** Takes away portal access. Their account stays; they just cannot see this client any more. */
export async function removeClientUser(ctx: TenantContext, clientUserId: string) {
  requireInvite(ctx);
  const row = await db.clientUser.findFirst({
    where: { id: clientUserId, agencyId: ctx.agencyId },
    select: { id: true, clientId: true },
  });
  if (!row) throw new NotFoundError("Person not found.");
  await db.clientUser.deleteMany({ where: { id: row.id, agencyId: ctx.agencyId } });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "client_user.removed",
    targetType: "ClientUser",
    targetId: row.id,
    metadata: { clientId: row.clientId },
  });
}
