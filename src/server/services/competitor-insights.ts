import "server-only";
import {
  competitorWeekly,
  discoverCompetitors,
  linkGap,
  weekEnds,
  type RankCheckSample,
  type Suggestion,
  type WeekPoint,
} from "@/lib/competitor-insights";
import type { TopResult } from "@/lib/competitors";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { enqueueCompetitorLinks } from "@/server/jobs/enqueue";
import { logActivity } from "./activity";
import { ForbiddenError, ValidationError } from "./errors";
import { getProject } from "./projects";

const day = (d: Date) => d.toISOString().slice(0, 10);
const dayDate = (v: string) => new Date(`${v}T00:00:00Z`);
const WEEKS = 8;
const KEYWORDS = 300;

function requireView(ctx: TenantContext): void {
  if (ctx.role === "CLIENT" || !can(ctx.role, "data.view")) throw new ForbiddenError();
}

/** Asks the worker to read the link numbers and linking websites of the competitors. Once a day. */
export async function requestCompetitorLinks(ctx: TenantContext, projectId: string) {
  if (!can(ctx.role, "tools.run")) throw new ForbiddenError();
  await getProject(ctx, projectId);
  const count = await db.competitor.count({ where: { agencyId: ctx.agencyId, projectId } });
  if (count === 0) throw new ValidationError("Add at least one competitor first.");
  const queued = await enqueueCompetitorLinks({
    agencyId: ctx.agencyId,
    projectId,
    date: day(new Date()),
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "competitor.links_requested",
    targetType: "Project",
    targetId: projectId,
    metadata: {},
  });
  return { queued };
}

export type CompetitorInsights = {
  suggestions: Suggestion[];
  /** Weekly top 10 counts for you and each competitor, oldest week first. */
  history: { weeks: WeekPoint[]; domains: string[]; own: string };
  links: {
    fetchedOn: string | null;
    rows: {
      domain: string;
      isYou: boolean;
      backlinks: number | null;
      referringDomains: number | null;
      rating: number | null;
    }[];
    gap: ReturnType<typeof linkGap>;
  };
};

/**
 * Suggested competitors, weekly movement, and link numbers with the link gap. The first two read
 * saved rank checks; the third reads what the last link refresh saved. No provider is called.
 */
export async function getCompetitorInsights(
  ctx: TenantContext,
  projectId: string,
  today = new Date(),
): Promise<CompetitorInsights> {
  requireView(ctx);
  const project = await getProject(ctx, projectId);
  const base = { agencyId: ctx.agencyId, projectId };
  const competitors = await db.competitor.findMany({
    where: base,
    select: {
      id: true,
      domain: true,
      backlinks: true,
      referringDomains: true,
      domainRating: true,
      linksFetchedAt: true,
    },
    orderBy: { domain: "asc" },
    take: 20,
  });
  const keywords = await db.keyword.findMany({
    where: { ...base, lastCheckedOn: { not: null } },
    select: { id: true },
    orderBy: { lastCheckedOn: "desc" },
    take: KEYWORDS,
  });
  const ends = weekEnds(day(today), WEEKS);
  const since = new Date(dayDate(ends[0]!).getTime() - 6 * 86_400_000);
  const checks =
    keywords.length === 0
      ? []
      : await db.rankCheck.findMany({
          where: {
            agencyId: ctx.agencyId,
            keywordId: { in: keywords.map((k) => k.id) },
            date: { gte: since, lte: dayDate(day(today)) },
          },
          select: { keywordId: true, date: true, topResults: true },
          take: KEYWORDS * WEEKS * 7,
        });
  const samples: RankCheckSample[] = checks.map((c) => ({
    keywordId: c.keywordId,
    date: day(c.date),
    topResults: (c.topResults ?? []) as unknown as TopResult[],
  }));
  const domains = competitors.map((c) => c.domain);
  const latestTops = new Map<string, RankCheckSample>();
  for (const s of samples) {
    const old = latestTops.get(s.keywordId);
    if (!old || s.date > old.date) latestTops.set(s.keywordId, s);
  }
  const own = project.domain.toLowerCase().replace(/^www\./, "");

  const [ourSnapshot, ourLinks, theirLinks] = await Promise.all([
    db.backlinkSnapshot.findFirst({
      where: base,
      select: { totalBacklinks: true, referringDomains: true, domainRating: true },
      orderBy: { takenOn: "desc" },
    }),
    db.backlink.findMany({
      where: { ...base, lostAt: null },
      select: { sourceDomain: true },
      distinct: ["sourceDomain"],
      take: 5000,
    }),
    competitors.length === 0
      ? []
      : db.competitorLink.findMany({
          where: { ...base, competitorId: { in: competitors.map((c) => c.id) } },
          select: { competitorId: true, sourceDomain: true, rating: true },
          take: 20 * 200,
        }),
  ]);
  const fetched = competitors.reduce<Date | null>(
    (m, c) => (c.linksFetchedAt && (!m || c.linksFetchedAt > m) ? c.linksFetchedAt : m),
    null,
  );
  return {
    suggestions: discoverCompetitors(
      [...latestTops.values()].map((s) => s.topResults),
      own,
      domains,
    ),
    history: {
      weeks: competitorWeekly(samples, [own, ...domains], ends),
      domains,
      own,
    },
    links: {
      fetchedOn: fetched ? day(fetched) : null,
      rows: [
        {
          domain: own,
          isYou: true,
          backlinks: ourSnapshot?.totalBacklinks ?? null,
          referringDomains: ourSnapshot?.referringDomains ?? null,
          rating: ourSnapshot?.domainRating ?? null,
        },
        ...competitors.map((c) => ({
          domain: c.domain,
          isYou: false,
          backlinks: c.backlinks,
          referringDomains: c.referringDomains,
          rating: c.domainRating,
        })),
      ],
      gap: linkGap(
        new Set(ourLinks.map((l) => l.sourceDomain)),
        competitors.map((c) => ({
          domain: c.domain,
          links: theirLinks
            .filter((l) => l.competitorId === c.id)
            .map((l) => ({ sourceDomain: l.sourceDomain, rating: l.rating })),
        })),
      ),
    },
  };
}
