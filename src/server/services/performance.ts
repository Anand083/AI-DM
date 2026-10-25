import "server-only";
import { goalPercent } from "@/lib/goals";
import { averagePosition } from "@/lib/rank-math";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { ForbiddenError } from "./errors";
import { paging, type Page } from "./paging";

export type PerformanceRow = {
  projectId: string;
  projectName: string;
  clientName: string;
  keywords: number;
  averagePosition: number | null;
  top10: number;
  healthScore: number | null;
  clicks28d: number | null;
  openTasks: number;
  overdueTasks: number;
  goals: number;
  goalsReached: number;
};

const DAY_MS = 86_400_000;

/**
 * One row per project of the agency with the numbers an account manager scans first.
 * Staff only, because it lists every client.
 */
export async function listPerformance(ctx: TenantContext, p: Page = {}) {
  if (ctx.role === "CLIENT" || !can(ctx.role, "data.view")) throw new ForbiddenError();
  const { take, skip } = paging(p);
  const where = {
    agencyId: ctx.agencyId,
    deletedAt: null,
    client: { deletedAt: null, status: "ACTIVE" as const },
  };
  const [projects, total] = await Promise.all([
    db.project.findMany({
      where,
      select: { id: true, name: true, client: { select: { name: true } } },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take,
      skip,
    }),
    db.project.count({ where }),
  ]);
  const now = new Date();
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const from = new Date(now.getTime() - 28 * DAY_MS);
  const rows: PerformanceRow[] = await Promise.all(
    projects.map(async (project) => {
      const base = { agencyId: ctx.agencyId, projectId: project.id };
      const [keywords, audit, clicks, open, overdue, goals] = await Promise.all([
        db.keyword.findMany({
          where: { ...base, lastCheckedOn: { not: null } },
          select: { currentPosition: true },
          take: 5000,
        }),
        db.audit.findFirst({
          where: { ...base, status: "COMPLETED" },
          select: { healthScore: true },
          orderBy: { finishedAt: "desc" },
        }),
        db.searchConsoleDay.aggregate({
          where: { ...base, date: { gte: from } },
          _sum: { clicks: true },
          _count: { _all: true },
        }),
        db.task.count({ where: { ...base, status: { not: "DONE" } } }),
        db.task.count({ where: { ...base, status: { not: "DONE" }, dueOn: { lt: today } } }),
        db.goal.findMany({
          where: base,
          select: {
            kind: true,
            target: true,
            startValue: true,
            points: { select: { value: true }, orderBy: { on: "desc" }, take: 1 },
          },
          take: 20,
        }),
      ]);
      const positions = keywords.map((k) => k.currentPosition);
      return {
        projectId: project.id,
        projectName: project.name,
        clientName: project.client.name,
        keywords: keywords.length,
        averagePosition: averagePosition(positions),
        top10: positions.filter((x) => x !== null && x <= 10).length,
        healthScore: audit?.healthScore ?? null,
        clicks28d: clicks._count._all > 0 ? (clicks._sum.clicks ?? 0) : null,
        openTasks: open,
        overdueTasks: overdue,
        goals: goals.length,
        goalsReached: goals.filter(
          (g) => goalPercent(g.kind, g.startValue, g.points[0]?.value ?? null, g.target) >= 100,
        ).length,
      };
    }),
  );
  return { rows, total, page: Math.floor(skip / take) + 1, pageSize: take };
}
