import type { PrismaClient } from "@prisma/client";
import { isSnapshotDue } from "@/lib/backlink-math";

export type BacklinkSchedulerDeps = {
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
 * Queues the weekly backlink check for projects whose newest snapshot is 7 or more days old.
 * Only projects that were checked once by hand are repeated: nobody pays for lookups they never
 * asked for. Safe to run often, because the job id holds the date.
 */
export async function runBacklinkScheduler(
  deps: BacklinkSchedulerDeps,
): Promise<{ scanned: number; due: number; queued: number; paused?: true }> {
  if (await deps.paused?.()) return { scanned: 0, due: 0, queued: 0, paused: true };
  const batchSize = deps.batchSize ?? 500;
  const today = deps.now.toISOString().slice(0, 10);
  let cursor: string | undefined;
  let scanned = 0;
  let due = 0;
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
        backlinkSnapshots: { some: {} },
      },
      select: {
        id: true,
        agencyId: true,
        backlinkSnapshots: { select: { takenOn: true }, orderBy: { takenOn: "desc" }, take: 1 },
      },
      orderBy: { id: "asc" },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (projects.length === 0) break;
    scanned += projects.length;
    for (const project of projects) {
      const last = project.backlinkSnapshots[0]?.takenOn.toISOString().slice(0, 10) ?? null;
      if (!isSnapshotDue(last, today)) continue;
      due++;
      if (await deps.enqueue({ projectId: project.id, agencyId: project.agencyId, date: today }))
        queued++;
    }
    cursor = projects[projects.length - 1]!.id;
    if (projects.length < batchSize) break;
  }
  return { scanned, due, queued };
}
