import { findGap } from "@/lib/competitors";
import type { Db } from "@/server/db/client";
import type { RankedKeyword } from "@/server/providers/seo/types";
import type { GatewayCaller, GatewayResult } from "./seo-gateway";

export type CompetitorGateway = {
  getRankedKeywords(
    caller: GatewayCaller,
    input: { domain: string; locationCode: number; languageCode: string; limit: number },
  ): Promise<GatewayResult<RankedKeyword[]>>;
};

export type CompetitorGapRun = { projectId: string; agencyId: string };

/** How many keywords are read for the project and for each competitor. */
export const GAP_READ_LIMIT = 200;
/** How many gap keywords are kept per competitor. */
export const GAP_KEEP_LIMIT = 100;

export type CompetitorGapResult =
  | { status: "inactive" }
  | { status: "no-competitors" }
  | { status: "done"; competitors: number; stored: number };

/**
 * Refreshes the keyword gap of every competitor of a project: keywords a competitor ranks for
 * that the project neither ranks for nor tracks. The gateway caches provider answers for 7 days,
 * so asking again soon is free. The stored list of a competitor is replaced as a whole.
 */
export async function runCompetitorGap(
  deps: { db: Db; gateway: CompetitorGateway; now?: () => Date },
  run: CompetitorGapRun,
): Promise<CompetitorGapResult> {
  const { db, gateway } = deps;
  const now = deps.now ?? (() => new Date());
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

  const competitors = await db.competitor.findMany({
    where: { agencyId: run.agencyId, projectId: project.id },
    select: { id: true, domain: true },
    orderBy: { domain: "asc" },
    take: 20,
  });
  if (competitors.length === 0) return { status: "no-competitors" };

  const caller = { agencyId: run.agencyId, projectId: project.id };
  const query = { locationCode: project.locationCode, languageCode: project.languageCode };
  const own = await gateway.getRankedKeywords(caller, {
    ...query,
    domain: project.domain,
    limit: GAP_READ_LIMIT,
  });
  const ownRanked = new Set(own.data.map((k) => k.keyword.trim().toLowerCase()));
  const tracked = new Set(
    (
      await db.keyword.findMany({
        where: { agencyId: run.agencyId, projectId: project.id },
        select: { phrase: true },
        take: 5000,
      })
    ).map((k) => k.phrase.trim().toLowerCase()),
  );

  let stored = 0;
  for (const competitor of competitors) {
    const theirs = await gateway.getRankedKeywords(caller, {
      ...query,
      domain: competitor.domain,
      limit: GAP_READ_LIMIT,
    });
    const gap = findGap(theirs.data, ownRanked, tracked, GAP_KEEP_LIMIT);
    await db.competitorKeyword.deleteMany({
      where: { agencyId: run.agencyId, competitorId: competitor.id },
    });
    if (gap.length > 0) {
      await db.competitorKeyword.createMany({
        data: gap.map((g) => ({
          agencyId: run.agencyId,
          projectId: project.id,
          competitorId: competitor.id,
          keyword: g.keyword,
          position: g.position,
          volume: g.volume,
          url: g.url,
        })),
        skipDuplicates: true,
      });
    }
    await db.competitor.updateMany({
      where: { id: competitor.id, agencyId: run.agencyId },
      data: { gapFetchedAt: now() },
    });
    stored += gap.length;
  }
  return { status: "done", competitors: competitors.length, stored };
}
