import { Prisma, type PrismaClient } from "@prisma/client";
import { nextRunAt } from "@/lib/report-schedule";
import { AppError } from "@/server/services/errors";
import { createReportRecord } from "@/server/services/reports";

export type ReportDispatcherDeps = {
  /** System-wide read of all agencies' schedules, so it uses the plain client. */
  db: Pick<PrismaClient, "reportSchedule" | "report">;
  now: Date;
  /** Queues the worker job that builds a report. Safe to call twice for the same report. */
  enqueue: (data: { reportId: string; agencyId: string }) => Promise<void>;
  batchSize?: number;
};

/**
 * Makes a report for every schedule whose time has come, then moves the schedule to its next
 * run. Safe to run often and in parallel: a report is unique per schedule and run time, so a
 * run is never made twice, and a missed run is made once (not once per missed week).
 */
export async function runReportDispatcher(
  deps: ReportDispatcherDeps,
): Promise<{ due: number; created: number }> {
  const batchSize = deps.batchSize ?? 100;
  const due = await deps.db.reportSchedule.findMany({
    where: {
      enabled: true,
      nextRunAt: { lte: deps.now },
      agency: {
        status: "ACTIVE",
        deletedAt: null,
        subscription: { isNot: { status: { in: ["EXPIRED", "CANCELED"] } } },
      },
      project: { deletedAt: null, client: { deletedAt: null, status: "ACTIVE" } },
    },
    select: {
      id: true,
      agencyId: true,
      projectId: true,
      frequency: true,
      dayOfWeek: true,
      dayOfMonth: true,
      hour: true,
      sections: true,
      nextRunAt: true,
      agency: { select: { timezone: true } },
    },
    orderBy: { nextRunAt: "asc" },
    take: batchSize,
  });

  let created = 0;
  for (const schedule of due) {
    try {
      await createReportRecord(
        { agencyId: schedule.agencyId },
        null,
        {
          projectId: schedule.projectId,
          period: schedule.frequency === "WEEKLY" ? "last7" : "lastMonth",
          sections: schedule.sections,
        },
        {
          now: schedule.nextRunAt,
          enqueue: deps.enqueue,
          schedule: { id: schedule.id, scheduledFor: schedule.nextRunAt },
        },
      );
      created++;
    } catch (error) {
      // The account became read-only or the project went away since the query: skip this run.
      if (error instanceof AppError) {
        await deps.db.reportSchedule.updateMany({
          where: { id: schedule.id, nextRunAt: schedule.nextRunAt },
          data: {
            lastRunAt: deps.now,
            nextRunAt: nextRunAt(schedule, deps.now, schedule.agency.timezone),
          },
        });
        continue;
      }
      // Already made for this run time (an earlier tick stopped before moving the schedule).
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
        throw error;
      }
      const existing = await deps.db.report.findFirst({
        where: { scheduleId: schedule.id, scheduledFor: schedule.nextRunAt },
        select: { id: true, status: true },
      });
      if (existing?.status === "QUEUED") {
        await deps.enqueue({ reportId: existing.id, agencyId: schedule.agencyId });
      }
    }
    // Moves on from now (not from the missed time), so a long outage sends one report.
    await deps.db.reportSchedule.updateMany({
      where: { id: schedule.id, nextRunAt: schedule.nextRunAt },
      data: {
        lastRunAt: deps.now,
        nextRunAt: nextRunAt(schedule, deps.now, schedule.agency.timezone),
      },
    });
  }
  return { due: due.length, created };
}
