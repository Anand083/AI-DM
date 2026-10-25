import "server-only";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { NotFoundError } from "./errors";

/** The signed-in person's own email choices for this agency. */
export async function getMyNotifications(ctx: TenantContext) {
  const row = await db.agencyMember.findFirst({
    where: { agencyId: ctx.agencyId, userId: ctx.userId },
    select: { emailDigest: true, emailTaskAssigned: true },
  });
  if (!row) throw new NotFoundError("Member not found.");
  return row;
}

export async function setMyNotifications(
  ctx: TenantContext,
  change: { digest?: boolean; taskAssigned?: boolean },
) {
  const result = await db.agencyMember.updateMany({
    where: { agencyId: ctx.agencyId, userId: ctx.userId },
    data: {
      ...(change.digest === undefined ? {} : { emailDigest: change.digest }),
      ...(change.taskAssigned === undefined ? {} : { emailTaskAssigned: change.taskAssigned }),
    },
  });
  if (result.count === 0) throw new NotFoundError("Member not found.");
}

export const setMyDigest = (ctx: TenantContext, on: boolean) =>
  setMyNotifications(ctx, { digest: on });
