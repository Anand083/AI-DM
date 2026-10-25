import { buildCompetitorMoveAlert } from "@/lib/alert-rules";
import {
  competitorWeekly,
  detectCompetitorMove,
  weekEnds,
  type RankCheckSample,
} from "@/lib/competitor-insights";
import type { TopResult } from "@/lib/competitors";
import type { PrismaClient } from "@prisma/client";
import type { Db } from "@/server/db/client";
import { createAlerts } from "@/server/services/alert-store";

const day = (d: Date) => d.toISOString().slice(0, 10);
const dayDate = (v: string) => new Date(`${v}T00:00:00Z`);

/** How many competitors are looked at in one tick. */
const BATCH = 40;
/** Keywords read per project (the newest checks only). */
const KEYWORDS_PER_PROJECT = 300;

/**
 * Once a day per competitor, compares this week with the week before: if the competitor holds
 * clearly more top 10 places across the project's keywords, an alert is raised (once a week per
 * competitor). Reads saved rank checks only; no provider call.
 */
export async function runCompetitorAlerts(deps: {
  /** System-wide read of every agency's competitors, so it uses the plain client. */
  db: Pick<PrismaClient, "competitor" | "keyword" | "rankCheck">;
  /** Saves the alerts through the guarded client. */
  alertDb: Db;
  now: Date;
}): Promise<{ checked: number; alerts: number }> {
  const { db } = deps;
  const today = day(deps.now);
  const competitors = await db.competitor.findMany({
    where: {
      OR: [{ alertCheckedOn: null }, { alertCheckedOn: { lt: dayDate(today) } }],
      project: {
        deletedAt: null,
        client: { deletedAt: null, status: "ACTIVE" },
        agency: { status: "ACTIVE", deletedAt: null },
      },
    },
    select: {
      id: true,
      agencyId: true,
      projectId: true,
      domain: true,
      project: { select: { name: true } },
    },
    orderBy: { id: "asc" },
    take: BATCH,
  });
  let alerts = 0;
  const byProject = new Map<string, typeof competitors>();
  for (const c of competitors)
    byProject.set(c.projectId, [...(byProject.get(c.projectId) ?? []), c]);

  for (const [projectId, list] of byProject) {
    const { agencyId } = list[0]!;
    const ends = weekEnds(today, 2);
    const since = new Date(dayDate(ends[0]!).getTime() - 6 * 86_400_000);
    const keywords = await db.keyword.findMany({
      where: { agencyId, projectId, lastCheckedOn: { not: null } },
      select: { id: true },
      orderBy: { lastCheckedOn: "desc" },
      take: KEYWORDS_PER_PROJECT,
    });
    const checks =
      keywords.length === 0
        ? []
        : await db.rankCheck.findMany({
            where: {
              agencyId,
              keywordId: { in: keywords.map((k) => k.id) },
              date: { gte: since, lte: dayDate(today) },
            },
            select: { keywordId: true, date: true, topResults: true },
            take: KEYWORDS_PER_PROJECT * 14,
          });
    const samples: RankCheckSample[] = checks.map((c) => ({
      keywordId: c.keywordId,
      date: day(c.date),
      topResults: (c.topResults ?? []) as unknown as TopResult[],
    }));
    const weeks = competitorWeekly(
      samples,
      list.map((c) => c.domain),
      ends,
    );
    for (const c of list) {
      const move = detectCompetitorMove(weeks[0], weeks[1], c.domain);
      if (move) {
        const draft = buildCompetitorMoveAlert({
          projectId,
          projectName: c.project.name,
          competitor: c.domain,
          weekEnd: ends[1]!,
          from: move.from,
          to: move.to,
        });
        alerts += await createAlerts(deps.alertDb, agencyId, [draft]);
      }
      await db.competitor.updateMany({
        where: { id: c.id, agencyId },
        data: { alertCheckedOn: dayDate(today) },
      });
    }
  }
  return { checked: competitors.length, alerts };
}
