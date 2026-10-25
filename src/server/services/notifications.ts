import "server-only";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { NotFoundError } from "./errors";

/** The signed-in person's own email choices for this agency. */
export async function getMyNotifications(ctx: TenantContext) {
  const row = await db.agencyMember.findFirst({
    where: { agencyId: ctx.agencyId, userId: ctx.userId },
    select: { emailDigest: true },
  });
  if (!row) throw new NotFoundError("Member not found.");
  return row;
}

export async function setMyDigest(ctx: TenantContext, on: boolean) {
  const result = await db.agencyMember.updateMany({
    where: { agencyId: ctx.agencyId, userId: ctx.userId },
    data: { emailDigest: on },
  });
  if (result.count === 0) throw new NotFoundError("Member not found.");
}
