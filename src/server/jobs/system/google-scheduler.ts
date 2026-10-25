import type { PrismaClient } from "@prisma/client";

export type GoogleSchedulerDeps = {
  /** System-wide read of every agency's connections, so it uses the plain client. */
  db: Pick<PrismaClient, "googleConnection">;
  now: Date;
  /** Returns true when a job was added, false when one already existed. */
  enqueue: (job: { projectId: string; agencyId: string; date: string }) => Promise<boolean>;
  batchSize?: number;
};

/**
 * Queues one Google sync a day for every working connection that has something chosen and was not
 * synced today. Connections that need to be connected again are left alone. The job id holds the
 * date, so running this often is safe. Google does not cost anything, so there is no budget check.
 */
export async function runGoogleScheduler(
  deps: GoogleSchedulerDeps,
): Promise<{ scanned: number; queued: number }> {
  const batchSize = deps.batchSize ?? 500;
  const today = deps.now.toISOString().slice(0, 10);
  const todayStart = new Date(`${today}T00:00:00Z`);
  let cursor: string | undefined;
  let scanned = 0;
  let queued = 0;

  for (;;) {
    const rows = await deps.db.googleConnection.findMany({
      where: {
        status: "ACTIVE",
        OR: [{ gscSite: { not: null } }, { ga4PropertyId: { not: null } }],
        AND: [{ OR: [{ lastSyncedOn: null }, { lastSyncedOn: { lt: todayStart } }] }],
        project: {
          deletedAt: null,
          client: { deletedAt: null, status: "ACTIVE" },
          agency: {
            status: "ACTIVE",
            deletedAt: null,
            subscription: { isNot: { status: { in: ["EXPIRED", "CANCELED"] } } },
          },
        },
      },
      select: { id: true, projectId: true, agencyId: true },
      orderBy: { id: "asc" },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) break;
    scanned += rows.length;
    for (const row of rows) {
      if (await deps.enqueue({ projectId: row.projectId, agencyId: row.agencyId, date: today }))
        queued++;
    }
    cursor = rows[rows.length - 1]!.id;
    if (rows.length < batchSize) break;
  }
  return { scanned, queued };
}
