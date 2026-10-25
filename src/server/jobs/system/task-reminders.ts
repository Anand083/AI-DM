import type { PrismaClient } from "@prisma/client";
import { buildTaskDueAlert } from "@/lib/alert-rules";
import { createAlerts } from "@/server/services/alert-store";
import type { Db } from "@/server/db/client";

const PAGE = 500;

/**
 * One alert a day for each active agency that has open tasks past their day or due today.
 * Safe to run often: the alert key holds the agency and the date.
 */
export async function runTaskReminders(deps: {
  db: Pick<PrismaClient, "task">;
  /** Used to save the alerts. */
  alertDb: Db;
  now: Date;
}): Promise<{ agencies: number; alerts: number }> {
  const date = deps.now.toISOString().slice(0, 10);
  const today = new Date(`${date}T00:00:00Z`);
  const open = {
    status: { not: "DONE" },
    agency: { status: "ACTIVE" as const, deletedAt: null },
  };
  const counts = new Map<string, { overdue: number; dueToday: number }>();
  const read = async (key: "overdue" | "dueToday", dueOn: object) => {
    for (let skip = 0; ; skip += PAGE) {
      const rows = await deps.db.task.groupBy({
        by: ["agencyId"],
        where: { ...open, dueOn },
        _count: { _all: true },
        orderBy: { agencyId: "asc" },
        take: PAGE,
        skip,
      });
      for (const r of rows) {
        const c = counts.get(r.agencyId) ?? { overdue: 0, dueToday: 0 };
        c[key] = r._count._all;
        counts.set(r.agencyId, c);
      }
      if (rows.length < PAGE) break;
    }
  };
  await read("overdue", { lt: today });
  await read("dueToday", { equals: today });

  let alerts = 0;
  for (const [agencyId, c] of counts) {
    const draft = buildTaskDueAlert({ agencyId, date, ...c });
    if (draft) alerts += await createAlerts(deps.alertDb, agencyId, [draft]);
  }
  return { agencies: counts.size, alerts };
}
