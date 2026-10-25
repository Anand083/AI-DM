import "server-only";
import { adminDb } from "@/server/db/admin-client";
import { IMPERSONATION_MINUTES } from "@/server/auth/impersonation-token";
import { ConflictError, NotFoundError } from "@/server/services/errors";
import type { AdminContext } from "./guard";

/**
 * Starts a support session: the admin will see the agency as its owner (or the member chosen).
 * It lasts 30 minutes. A new session ends any earlier one by the same admin. Both are logged in
 * the agency's activity log.
 */
export async function startSupportSession(
  admin: AdminContext,
  agencyId: string,
  targetUserId?: string,
  now = new Date(),
) {
  const agency = await adminDb.agency.findFirst({
    where: { id: agencyId, deletedAt: null },
    select: { id: true, slug: true, status: true },
  });
  if (!agency) throw new NotFoundError("Agency not found.");
  if (agency.status !== "ACTIVE") throw new ConflictError("Unsuspend this agency first.");
  const member = await adminDb.agencyMember.findFirst({
    where: targetUserId ? { agencyId, userId: targetUserId } : { agencyId, role: "OWNER" },
    select: { userId: true },
    orderBy: { createdAt: "asc" },
  });
  if (!member) throw new NotFoundError("That person is not in this agency.");
  if (member.userId === admin.adminUserId)
    throw new ConflictError("You cannot view an agency as yourself.");

  await adminDb.impersonation.updateMany({
    where: { adminUserId: admin.adminUserId, endedAt: null },
    data: { endedAt: now },
  });
  const session = await adminDb.impersonation.create({
    data: {
      adminUserId: admin.adminUserId,
      targetUserId: member.userId,
      agencyId,
      expiresAt: new Date(now.getTime() + IMPERSONATION_MINUTES * 60_000),
    },
    select: { id: true, expiresAt: true },
  });
  const slug = agency.slug;
  await adminDb.activityLog.create({
    data: {
      agencyId,
      actorUserId: admin.adminUserId,
      impersonatorUserId: admin.adminUserId,
      action: "admin.impersonation_started",
      targetType: "User",
      targetId: member.userId,
    },
  });
  return { ...session, slug };
}

export async function endSupportSession(admin: AdminContext, now = new Date()) {
  const open = await adminDb.impersonation.findMany({
    where: { adminUserId: admin.adminUserId, endedAt: null },
    select: { id: true, agencyId: true },
    take: 10,
  });
  if (open.length === 0) return;
  await adminDb.impersonation.updateMany({
    where: { id: { in: open.map((o) => o.id) } },
    data: { endedAt: now },
  });
  for (const session of open) {
    await adminDb.activityLog.create({
      data: {
        agencyId: session.agencyId,
        actorUserId: admin.adminUserId,
        impersonatorUserId: admin.adminUserId,
        action: "admin.impersonation_ended",
      },
    });
  }
}
