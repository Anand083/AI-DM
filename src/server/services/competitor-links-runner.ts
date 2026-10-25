import type { Db } from "@/server/db/client";
import type { BacklinkSummary, ReferringDomain } from "@/server/providers/seo/types";
import { AppError } from "./errors";
import type { GatewayCaller, GatewayResult } from "./seo-gateway";

export type CompetitorLinksGateway = {
  getBacklinkSummary(
    caller: GatewayCaller,
    domain: string,
  ): Promise<GatewayResult<BacklinkSummary>>;
  getReferringDomains(
    caller: GatewayCaller,
    input: { domain: string; limit: number },
  ): Promise<GatewayResult<ReferringDomain[]>>;
};

export type CompetitorLinksResult =
  | { status: "inactive" }
  | { status: "no-competitors" }
  | { status: "done" | "stopped"; competitors: number; links: number; reason?: string };

/** How many linking websites are read for each competitor. */
export const LINKS_READ_LIMIT = 200;
/** Fewer linking websites than this per competitor is not worth reading. */
export const LINKS_READ_MIN = 10;

/**
 * Reads the link numbers of every competitor of a project (total links, linking websites,
 * rating) and the websites that link to each of them, and saves them. The list of a competitor
 * is replaced as a whole. When the plan limit or the budget is reached the run stops and keeps
 * what it has.
 */
export async function runCompetitorLinks(
  deps: {
    db: Db;
    gateway: CompetitorLinksGateway;
    /** How many links the plan can still afford to read this month (throws when too few). */
    windowFor: (agencyId: string) => Promise<number>;
    now?: () => Date;
  },
  run: { agencyId: string; projectId: string },
): Promise<CompetitorLinksResult> {
  const { db, gateway } = deps;
  const now = deps.now ?? (() => new Date());
  const project = await db.project.findFirst({
    where: {
      id: run.projectId,
      agencyId: run.agencyId,
      deletedAt: null,
      client: { deletedAt: null, status: "ACTIVE" },
    },
    select: { id: true },
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
  let done = 0;
  let links = 0;
  let reason: string | undefined;
  try {
    // Share what the plan can afford between the competitors; one unit goes to each summary.
    const window = await deps.windowFor(run.agencyId);
    const each = Math.min(
      LINKS_READ_LIMIT,
      Math.floor((window - competitors.length) / competitors.length),
    );
    if (each < LINKS_READ_MIN) {
      throw new AppError(
        "There are not enough backlink lookups left this month for the competitors. Upgrade your plan to read more.",
        "LIMIT",
      );
    }
    for (const competitor of competitors) {
      const summary = await gateway.getBacklinkSummary(caller, competitor.domain);
      const domains = await gateway.getReferringDomains(caller, {
        domain: competitor.domain,
        limit: each,
      });
      await db.competitorLink.deleteMany({
        where: { agencyId: run.agencyId, competitorId: competitor.id },
      });
      if (domains.data.length > 0) {
        await db.competitorLink.createMany({
          data: domains.data.map((d) => ({
            agencyId: run.agencyId,
            projectId: project.id,
            competitorId: competitor.id,
            sourceDomain: d.domain.toLowerCase().replace(/^www\./, ""),
            rating: Math.round(d.rating),
          })),
          skipDuplicates: true,
        });
      }
      await db.competitor.updateMany({
        where: { id: competitor.id, agencyId: run.agencyId },
        data: {
          backlinks: summary.data.totalBacklinks,
          referringDomains: summary.data.referringDomains,
          domainRating: Math.round(summary.data.domainRating),
          linksFetchedAt: now(),
        },
      });
      done++;
      links += domains.data.length;
    }
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    reason = error.message;
  }
  return { status: reason ? "stopped" : "done", competitors: done, links, reason };
}
