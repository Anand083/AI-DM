import type { PrismaClient } from "@prisma/client";
import { isSnapshotDue } from "@/lib/backlink-math";

export type AiSchedulerDeps = {
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
 * Queues the weekly AI visibility check for projects whose newest check is 7 or more days old.
 * Only projects that were checked once by hand are repeated, so nobody uses their monthly AI
 * checks without asking. The job id holds the date, so running this often is safe.
 */
export async function runAiScheduler(
  deps: AiSchedulerDeps,
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
        aiPrompts: { some: {} },
        aiChecks: { some: {} },
      },
      select: {
        id: true,
        agencyId: true,
        aiChecks: { select: { checkedOn: true }, orderBy: { checkedOn: "desc" }, take: 1 },
      },
      orderBy: { id: "asc" },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (projects.length === 0) break;
    scanned += projects.length;
    for (const project of projects) {
      const last = project.aiChecks[0]?.checkedOn.toISOString().slice(0, 10) ?? null;
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
