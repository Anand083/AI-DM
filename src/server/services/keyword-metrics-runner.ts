import type { Db } from "@/server/db/client";
import type { BingRank, KeywordMetric } from "@/server/providers/seo/types";
import { AppError } from "./errors";
import type { GatewayCaller, GatewayResult } from "./seo-gateway";

export type KeywordMetricsGateway = {
  getKeywordMetrics(
    caller: GatewayCaller,
    input: { keywords: string[]; locationCode: number; languageCode: string },
  ): Promise<GatewayResult<KeywordMetric[]>>;
  getBingRankings(
    caller: GatewayCaller,
    input: { domain: string; keywords: string[]; locationCode: number; languageCode: string },
  ): Promise<GatewayResult<BingRank[]>>;
};

export type KeywordMetricsResult =
  | { status: "inactive" }
  | { status: "no-keywords" }
  | {
      status: "done" | "stopped";
      metrics: number;
      bing: number;
      /** Why the run stopped early, in plain words (plan limit or budget). */
      reason?: string;
    };

const BATCH = 100;
/** The most keywords one refresh reads. */
export const MAX_REFRESH_KEYWORDS = 500;
const day = (value: string) => new Date(`${value}T00:00:00Z`);

/**
 * Reads search volume, difficulty, cost per click and the 12 month trend for a project's
 * keywords, and their Bing positions, in batches of 100, and saves them on the keywords. When the
 * plan limit or the provider budget is reached the run stops and keeps what it has. Running it
 * again the same day reads nothing new (the gateway cache answers).
 */
export async function runKeywordMetrics(
  deps: { db: Db; gateway: KeywordMetricsGateway },
  run: { agencyId: string; projectId: string; /** UTC day, YYYY-MM-DD. */ date: string },
): Promise<KeywordMetricsResult> {
  const { db, gateway } = deps;
  const project = await db.project.findFirst({
    where: {
      id: run.projectId,
      agencyId: run.agencyId,
      deletedAt: null,
      client: { deletedAt: null, status: "ACTIVE" },
    },
    select: { id: true, domain: true, locationCode: true, languageCode: true },
  });
  if (!project) return { status: "inactive" };
  const keywords = await db.keyword.findMany({
    where: { agencyId: run.agencyId, projectId: project.id },
    select: { id: true, phrase: true },
    orderBy: [{ phrase: "asc" }, { id: "asc" }],
    take: MAX_REFRESH_KEYWORDS,
  });
  if (keywords.length === 0) return { status: "no-keywords" };

  const caller = { agencyId: run.agencyId, projectId: project.id };
  const on = day(run.date);
  let metrics = 0;
  let bing = 0;
  let reason: string | undefined;

  try {
    for (let i = 0; i < keywords.length; i += BATCH) {
      const batch = keywords.slice(i, i + BATCH);
      const { data } = await gateway.getKeywordMetrics(caller, {
        keywords: batch.map((k) => k.phrase),
        locationCode: project.locationCode,
        languageCode: project.languageCode,
      });
      const byPhrase = new Map(data.map((m) => [m.keyword.toLowerCase(), m]));
      for (const k of batch) {
        const m = byPhrase.get(k.phrase.toLowerCase());
        await db.keyword.updateMany({
          where: { id: k.id, agencyId: run.agencyId },
          data: {
            volume: m?.volume ?? null,
            cpcMicros: m?.cpcMicros ?? null,
            difficulty: m?.difficulty ?? null,
            trend: m?.trend ?? [],
            metricsOn: on,
          },
        });
        metrics++;
      }
    }
    for (let i = 0; i < keywords.length; i += BATCH) {
      const batch = keywords.slice(i, i + BATCH);
      const { data } = await gateway.getBingRankings(caller, {
        domain: project.domain,
        keywords: batch.map((k) => k.phrase),
        locationCode: project.locationCode,
        languageCode: project.languageCode,
      });
      const byPhrase = new Map(data.map((r) => [r.keyword.toLowerCase(), r]));
      for (const k of batch) {
        await db.keyword.updateMany({
          where: { id: k.id, agencyId: run.agencyId },
          data: {
            bingPosition: byPhrase.get(k.phrase.toLowerCase())?.position ?? null,
            bingCheckedOn: on,
          },
        });
        bing++;
      }
    }
  } catch (error) {
    // Plan limit or budget pause: keep what we have and stop.
    if (!(error instanceof AppError)) throw error;
    reason = error.message;
  }
  return { status: reason ? "stopped" : "done", metrics, bing, reason };
}
