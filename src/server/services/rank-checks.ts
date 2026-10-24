import type { Db } from "@/server/db/client";
import { buildRankAlerts, type RankMove } from "@/lib/alert-rules";
import { createAlerts, loadAlertSettings } from "./alert-store";
import { refreshKeywordSnapshots } from "./rank-snapshots";
import type { GatewayCaller, GatewayResult } from "./seo-gateway";
import type { RankPriority, RankResult } from "@/server/providers/seo/types";

export type RankGateway = {
  getRankings(
    caller: GatewayCaller,
    input: {
      domain: string;
      keywords: string[];
      locationCode: number;
      languageCode: string;
      device: "desktop" | "mobile";
      priority?: RankPriority;
    },
  ): Promise<GatewayResult<RankResult[]>>;
};

export const RANK_BATCH_SIZE = 100;

export type RankCheckRun = {
  projectId: string;
  agencyId: string;
  /** UTC day, YYYY-MM-DD. */
  date: string;
  priority: RankPriority;
  /** Only these keywords (check now). Default: every keyword of the project. */
  keywordIds?: string[];
  onProgress?: (done: number, total: number) => Promise<void> | void;
};

/**
 * Checks a project's keywords and saves one RankCheck per keyword per day.
 * Standard runs skip keywords that already have a check for the day, so running a job twice
 * does nothing the second time. Live runs ("check now") replace the day's result.
 */
export async function runProjectRankCheck(
  deps: { db: Db; gateway: RankGateway; now?: () => Date },
  run: RankCheckRun,
): Promise<{ checked: number; skipped: number; total: number; projectActive: boolean }> {
  const { db, gateway } = deps;
  const now = deps.now ?? (() => new Date());

  const project = await db.project.findFirst({
    where: {
      id: run.projectId,
      agencyId: run.agencyId,
      deletedAt: null,
      client: { deletedAt: null, status: "ACTIVE" },
    },
    select: {
      id: true,
      name: true,
      domain: true,
      locationCode: true,
      languageCode: true,
      device: true,
    },
  });
  if (!project) return { checked: 0, skipped: 0, total: 0, projectActive: false };

  const keywordWhere = {
    agencyId: run.agencyId,
    projectId: project.id,
    ...(run.keywordIds ? { id: { in: run.keywordIds } } : {}),
  };
  const total = await db.keyword.count({ where: keywordWhere });
  const date = new Date(`${run.date}T00:00:00Z`);

  const moves: RankMove[] = [];
  let checked = 0;
  let skipped = 0;
  let cursor: string | undefined;

  for (;;) {
    const batch = await db.keyword.findMany({
      where: keywordWhere,
      select: { id: true, phrase: true, lastCheckedOn: true, currentPosition: true },
      orderBy: { id: "asc" },
      take: RANK_BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1]!.id;

    let todo = batch;
    if (run.priority === "standard") {
      const done = await db.rankCheck.findMany({
        where: { agencyId: run.agencyId, date, keywordId: { in: batch.map((k) => k.id) } },
        select: { keywordId: true },
      });
      const doneIds = new Set(done.map((d) => d.keywordId));
      todo = batch.filter((k) => !doneIds.has(k.id));
      skipped += batch.length - todo.length;
    }

    if (todo.length > 0) {
      const { data, provider } = await gateway.getRankings(
        { agencyId: run.agencyId, projectId: project.id },
        {
          domain: project.domain,
          keywords: todo.map((k) => k.phrase),
          locationCode: project.locationCode,
          languageCode: project.languageCode,
          device: project.device === "MOBILE" ? "mobile" : "desktop",
          priority: run.priority,
        },
      );
      const byPhrase = new Map(data.map((r) => [r.keyword, r]));
      const rows = todo.flatMap((k) => {
        const r = byPhrase.get(k.phrase);
        return r
          ? [
              {
                agencyId: run.agencyId,
                keywordId: k.id,
                date,
                checkedAt: now(),
                position: r.position,
                rankingUrl: r.rankingUrl,
                serpFeatures: r.serpFeatures,
                topResults: r.topResults,
                provider,
              },
            ]
          : [];
      });
      if (run.priority === "live") {
        await db.rankCheck.deleteMany({
          where: { agencyId: run.agencyId, date, keywordId: { in: rows.map((r) => r.keywordId) } },
        });
      }
      await db.rankCheck.createMany({ data: rows, skipDuplicates: true });
      // Moves for alerts: compare with the latest check on an EARLIER day. A keyword checked for
      // the first time, or checked again on the same day, has nothing to compare with.
      const priorById = new Map(todo.map((k) => [k.id, k]));
      for (const row of rows) {
        const prior = priorById.get(row.keywordId);
        if (prior?.lastCheckedOn && prior.lastCheckedOn < date) {
          moves.push({
            keywordId: row.keywordId,
            phrase: prior.phrase,
            previous: prior.currentPosition,
            current: row.position,
          });
        }
      }
      await refreshKeywordSnapshots(
        db,
        run.agencyId,
        rows.map((r) => r.keywordId),
      );
      checked += rows.length;
    }
    await run.onProgress?.(checked + skipped, total);
    if (batch.length < RANK_BATCH_SIZE) break;
  }
  if (moves.length > 0) {
    const settings = await loadAlertSettings(db, run.agencyId);
    await createAlerts(
      db,
      run.agencyId,
      buildRankAlerts({
        projectId: project.id,
        projectName: project.name,
        date: run.date,
        moves,
        settings,
      }),
    );
  }
  return { checked, skipped, total, projectActive: true };
}
