import type { PrismaClient } from "@prisma/client";

export type AuditSchedulerDeps = {
  /** System-wide read of all agencies' projects, so it uses the plain client. */
  db: Pick<PrismaClient, "project">;
  now: Date;
  /** Returns true when a job was added, false when one already existed. */
  enqueue: (job: { agencyId: string; projectId: string; month: string }) => Promise<boolean>;
  paused?: () => Promise<boolean>;
  batchSize?: number;
};

/**
 * Queues a monthly audit for every project that has "audit every month" on and has not had an
 * audit yet this calendar month (UTC). Safe to run often: the job id has the month in it.
 */
export async function runAuditScheduler(
  deps: AuditSchedulerDeps,
): Promise<{ scanned: number; queued: number; paused?: true }> {
  if (await deps.paused?.()) return { scanned: 0, queued: 0, paused: true };
  const month = deps.now.toISOString().slice(0, 7);
  const monthStart = new Date(Date.UTC(deps.now.getUTCFullYear(), deps.now.getUTCMonth(), 1));
  const batchSize = deps.batchSize ?? 500;
  let cursor: string | undefined;
  let scanned = 0;
  let queued = 0;

  for (;;) {
    const projects = await deps.db.project.findMany({
      where: {
        autoAudit: true,
        deletedAt: null,
        client: { deletedAt: null, status: "ACTIVE" },
        agency: {
          status: "ACTIVE",
          deletedAt: null,
          // Read-only accounts (trial over, unpaid, canceled) get no new work.
          subscription: { isNot: { status: { in: ["EXPIRED", "CANCELED"] } } },
        },
        audits: { none: { createdAt: { gte: monthStart } } },
      },
      select: { id: true, agencyId: true },
      orderBy: { id: "asc" },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (projects.length === 0) break;
    scanned += projects.length;
    for (const project of projects) {
      if (await deps.enqueue({ agencyId: project.agencyId, projectId: project.id, month }))
        queued++;
    }
    cursor = projects[projects.length - 1]!.id;
    if (projects.length < batchSize) break;
  }
  return { scanned, queued };
}
