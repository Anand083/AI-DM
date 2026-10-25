import "server-only";
import { db } from "@/server/db/client";
import type { Prisma } from "@prisma/client";

export type ActivityInput = {
  agencyId: string;
  actorUserId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Prisma.InputJsonValue;
  ip?: string;
  /** Set by the caller when known. Otherwise it is read from the current support session. */
  impersonatorUserId?: string;
};

type ActivityDb = Pick<typeof db, "activityLog">;

/** Writes one activity log row. Pass a transaction client to make it part of that transaction. */
export async function logActivity(input: ActivityInput, client: ActivityDb = db): Promise<void> {
  await client.activityLog.create({
    data: {
      agencyId: input.agencyId,
      actorUserId: input.actorUserId,
      impersonatorUserId: input.impersonatorUserId ?? (await currentImpersonatorId(input.agencyId)),
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: input.metadata,
      ip: input.ip,
    },
  });
}

/**
 * During a support session, every logged action carries the id of the super admin who did it.
 * Outside a web request (the worker, tests) there is no session, so this is undefined.
 */
async function currentImpersonatorId(agencyId: string): Promise<string | undefined> {
  try {
    const { readActiveImpersonation } = await import("@/server/auth/impersonation");
    const support = await readActiveImpersonation();
    return support && support.agencyId === agencyId ? support.adminUserId : undefined;
  } catch {
    return undefined;
  }
}
