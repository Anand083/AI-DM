import type { PrismaClient } from "@prisma/client";

export type ReviewSchedulerDeps = {
  /** System-wide read of every agency's projects, so it uses the plain client. */
  db: Pick<PrismaClient, "project">;
  now: Date;
  /** Returns true when a job was added, false when one already existed. */
  enqueue: (job: { projectId: string; agencyId: string; date: string }) => Promise<boolean>;
  batchSize?: number;
  /** When true (provider budget used up) nothing is queued. */
  paused?: () => Promise<boolean>;
};

/**
 * Queues a daily review check for every project that has a linked business and has not been
 * checked today. Linking a business is the request for it. The job id holds the date.
 */
export async function runReviewScheduler(
  deps: ReviewSchedulerDeps,
): Promise<{ scanned: number; queued: number; paused?: true }> {
  if (await deps.paused?.()) return { scanned: 0, queued: 0, paused: true };
  const batchSize = deps.batchSize ?? 500;
  const today = deps.now.toISOString().slice(0, 10);
  const todayStart = new Date(`${today}T00:00:00Z`);
  let cursor: string | undefined;
  let scanned = 0;
  let queued = 0;

  for (;;) {
    const projects = await deps.db.project.findMany({
      where: {
        deletedAt: null,
        client: { deletedAt: null, status: "ACTIVE" },
        agency: {
          status: "ACTIVE",
          deletedAt: null,
          subscription: { isNot: { status: { in: ["EXPIRED", "CANCELED"] } } },
        },
        localBusinesses: {
          some: { OR: [{ lastCheckedOn: null }, { lastCheckedOn: { lt: todayStart } }] },
        },
      },
      select: { id: true, agencyId: true },
      orderBy: { id: "asc" },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (projects.length === 0) break;
    scanned += projects.length;
    for (const project of projects) {
      if (await deps.enqueue({ projectId: project.id, agencyId: project.agencyId, date: today }))
        queued++;
    }
    cursor = projects[projects.length - 1]!.id;
    if (projects.length < batchSize) break;
  }
  return { scanned, queued };
}
