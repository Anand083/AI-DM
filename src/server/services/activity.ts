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
};

type ActivityDb = Pick<typeof db, "activityLog">;

/** Writes one activity log row. Pass a transaction client to make it part of that transaction. */
export async function logActivity(input: ActivityInput, client: ActivityDb = db): Promise<void> {
  await client.activityLog.create({
    data: {
      agencyId: input.agencyId,
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: input.metadata,
      ip: input.ip,
    },
  });
}
