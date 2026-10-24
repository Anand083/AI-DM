import type { PrismaClient } from "@prisma/client";
import { isRankCheckDue } from "../schedule";

export type SchedulerDeps = {
  /** System-wide read: the scheduler looks at every agency's projects, so it uses the plain client. */
  db: Pick<PrismaClient, "project">;
  now: Date;
  /** Returns true when a job was added, false when one already existed. */
  enqueue: (job: { projectId: string; agencyId: string; date: string }) => Promise<boolean>;
  batchSize?: number;
};

/**
 * Adds a rank check job for every project that is due. Safe to run often: the job id
 * (`rank:<project>:<date>`) means a project is queued once per day.
 */
export async function runRankCheckScheduler(
  deps: SchedulerDeps,
): Promise<{ scanned: number; due: number; queued: number }> {
  const batchSize = deps.batchSize ?? 500;
  const date = deps.now.toISOString().slice(0, 10);
  let cursor: string | undefined;
  let scanned = 0;
  let due = 0;
  let queued = 0;

  for (;;) {
    const projects = await deps.db.project.findMany({
      where: {
        deletedAt: null,
        client: { deletedAt: null, status: "ACTIVE" },
        agency: { status: "ACTIVE", deletedAt: null },
      },
      select: { id: true, agencyId: true, rankCheckFrequency: true, rankCheckHourUtc: true },
      orderBy: { id: "asc" },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (projects.length === 0) break;
    scanned += projects.length;
    for (const project of projects) {
      if (!isRankCheckDue(project, deps.now)) continue;
      due++;
      if (await deps.enqueue({ projectId: project.id, agencyId: project.agencyId, date })) queued++;
    }
    cursor = projects[projects.length - 1]!.id;
    if (projects.length < batchSize) break;
  }
  return { scanned, due, queued };
}
