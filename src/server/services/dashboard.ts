import "server-only";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { ForbiddenError } from "./errors";
import { paging, type Page } from "./paging";
import { getUsageSummary, type UsageLine } from "./usage";

export type ClientRow = {
  id: string;
  name: string;
  projects: number;
  keywords: number;
  /** Average position of the keywords that rank, or null. */
  averagePosition: number | null;
  /** Average places gained over the last week (positive is better), or null. */
  weeklyChange: number | null;
  /** Average of the projects' latest audit scores, or null. */
  auditScore: number | null;
  unreadAlerts: number;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Everything on the agency dashboard. Clients are paged; totals cover the whole agency. */
export async function getDashboard(ctx: TenantContext, options: Page = {}) {
  if (ctx.role === "CLIENT" || !can(ctx.role, "data.view")) throw new ForbiddenError();
  const { take, skip } = paging({ pageSize: 20, ...options });
  const clientWhere = { agencyId: ctx.agencyId, deletedAt: null, status: "ACTIVE" as const };

  const [clients, clientTotal, projectTotal, unreadTotal, keywordTotal, recentAlerts] =
    await Promise.all([
      db.client.findMany({
        where: clientWhere,
        select: {
          id: true,
          name: true,
          projects: { where: { deletedAt: null }, select: { id: true }, take: 500 },
        },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take,
        skip,
      }),
      db.client.count({ where: clientWhere }),
      db.project.count({
        where: {
          agencyId: ctx.agencyId,
          deletedAt: null,
          client: { deletedAt: null, status: "ACTIVE" },
        },
      }),
      db.alert.count({ where: { agencyId: ctx.agencyId, readAt: null } }),
      db.keyword.count({
        where: {
          agencyId: ctx.agencyId,
          project: { deletedAt: null, client: { deletedAt: null, status: "ACTIVE" } },
        },
      }),
      db.alert.findMany({
        where: { agencyId: ctx.agencyId },
        select: {
          id: true,
          title: true,
          severity: true,
          readAt: true,
          createdAt: true,
          projectId: true,
          type: true,
          data: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: 5,
      }),
    ]);

  const projectIds = clients.flatMap((c) => c.projects.map((p) => p.id));
  const [keywordStats, audits, alertCounts] = projectIds.length
    ? await Promise.all([
        db.keyword.groupBy({
          by: ["projectId"],
          where: { agencyId: ctx.agencyId, projectId: { in: projectIds } },
          _count: { _all: true, currentPosition: true, changeWeek: true },
          _sum: { currentPosition: true, changeWeek: true },
        }),
        db.audit.findMany({
          where: {
            agencyId: ctx.agencyId,
            projectId: { in: projectIds },
            status: "COMPLETED",
            healthScore: { not: null },
          },
          select: { projectId: true, healthScore: true },
          orderBy: { createdAt: "desc" },
          take: 2000,
        }),
        db.alert.groupBy({
          by: ["projectId"],
          where: { agencyId: ctx.agencyId, readAt: null, projectId: { in: projectIds } },
          _count: { _all: true },
        }),
      ])
    : [[], [], []];

  const statsByProject = new Map(keywordStats.map((s) => [s.projectId, s]));
  const latestScore = new Map<string, number>();
  for (const a of audits)
    if (!latestScore.has(a.projectId) && a.healthScore !== null)
      latestScore.set(a.projectId, a.healthScore);
  const alertsByProject = new Map(alertCounts.map((a) => [a.projectId, a._count._all]));

  const rows: ClientRow[] = clients.map((client) => {
    let keywords = 0;
    let rankingCount = 0;
    let positionSum = 0;
    let changeCount = 0;
    let changeSum = 0;
    let unread = 0;
    const scores: number[] = [];
    for (const { id } of client.projects) {
      const s = statsByProject.get(id);
      if (s) {
        keywords += s._count._all;
        rankingCount += s._count.currentPosition;
        positionSum += s._sum.currentPosition ?? 0;
        changeCount += s._count.changeWeek;
        changeSum += s._sum.changeWeek ?? 0;
      }
      const score = latestScore.get(id);
      if (score !== undefined) scores.push(score);
      unread += alertsByProject.get(id) ?? 0;
    }
    return {
      id: client.id,
      name: client.name,
      projects: client.projects.length,
      keywords,
      averagePosition: rankingCount > 0 ? round1(positionSum / rankingCount) : null,
      weeklyChange: changeCount > 0 ? round1(changeSum / changeCount) : null,
      auditScore:
        scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      unreadAlerts: unread,
    };
  });

  // Usage is for owners and admins only. Show the three fullest limits.
  let usage: { planName: string; lines: UsageLine[]; resetsOn: Date } | null = null;
  if (can(ctx.role, "branding.edit")) {
    const summary = await getUsageSummary(ctx);
    const lines = [...summary.monthly, ...summary.totals]
      .filter((l) => l.limit !== -1 && l.used > 0)
      .sort((a, b) => b.percent - a.percent)
      .slice(0, 3);
    usage = { planName: summary.planName, lines, resetsOn: summary.period.end };
  }

  return { rows, clientTotal, projectTotal, keywordTotal, unreadTotal, recentAlerts, usage };
}
