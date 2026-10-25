import type { Prisma } from "@prisma/client";
import { buildBacklinkLossAlert } from "@/lib/alert-rules";
import { keywordSet, suspiciousReasons } from "@/lib/backlink-math";
import type { Db } from "@/server/db/client";
import type { Backlink, BacklinkSummary } from "@/server/providers/seo/types";
import { createAlerts } from "./alert-store";
import type { GatewayCaller, GatewayResult } from "./seo-gateway";

export type BacklinkGateway = {
  getBacklinkSummary(
    caller: GatewayCaller,
    domain: string,
  ): Promise<GatewayResult<BacklinkSummary>>;
  getBacklinks(
    caller: GatewayCaller,
    input: { domain: string; limit: number; offset: number },
  ): Promise<GatewayResult<Backlink[]>>;
};

export type BacklinkRun = {
  projectId: string;
  agencyId: string;
  /** UTC day, YYYY-MM-DD. */
  date: string;
};

export type BacklinkRunResult =
  | { status: "inactive" }
  | { status: "already-checked" }
  | {
      status: "done";
      stored: number;
      newLinks: number;
      lostLinks: number;
      suspicious: number;
      alerted: boolean;
    };

const BATCH = 100;
const day = (value: string) => new Date(`${value}T00:00:00Z`);
const sameDay = (a: Date | null, b: Date | null) =>
  (a?.getTime() ?? null) === (b?.getTime() ?? null);

/**
 * One weekly check of a project's backlinks: reads the summary and a window of links from the
 * provider, saves the links (a link the provider reports as lost keeps its `lostAt`), flags
 * suspicious ones, saves a snapshot and raises an alert after a big loss.
 * Running it twice for the same day does nothing the second time.
 * `windowFor` says how many links the plan can still afford to read.
 */
export async function runBacklinkRefresh(
  deps: {
    db: Db;
    gateway: BacklinkGateway;
    windowFor: (agencyId: string) => Promise<number>;
  },
  run: BacklinkRun,
): Promise<BacklinkRunResult> {
  const { db, gateway } = deps;
  const project = await db.project.findFirst({
    where: {
      id: run.projectId,
      agencyId: run.agencyId,
      deletedAt: null,
      client: { deletedAt: null, status: "ACTIVE" },
    },
    select: { id: true, name: true, domain: true },
  });
  if (!project) return { status: "inactive" };

  const takenOn = day(run.date);
  const existing = await db.backlinkSnapshot.findFirst({
    where: { agencyId: run.agencyId, projectId: project.id, takenOn },
    select: { id: true },
  });
  if (existing) return { status: "already-checked" };

  const limit = await deps.windowFor(run.agencyId);
  const caller = { agencyId: run.agencyId, projectId: project.id };
  const { data: summary } = await gateway.getBacklinkSummary(caller, project.domain);
  const { data: links } = await gateway.getBacklinks(caller, {
    domain: project.domain,
    limit,
    offset: 0,
  });

  const keywords = await db.keyword.findMany({
    where: { agencyId: run.agencyId, projectId: project.id },
    select: { phrase: true },
    take: 2000,
  });
  const tracked = keywordSet(keywords.map((k) => k.phrase));

  const previous = await db.backlinkSnapshot.findFirst({
    where: { agencyId: run.agencyId, projectId: project.id, takenOn: { lt: takenOn } },
    select: { takenOn: true },
    orderBy: { takenOn: "desc" },
  });
  const activeBefore = await db.backlink.count({
    where: { agencyId: run.agencyId, projectId: project.id, lostAt: null },
  });

  let suspicious = 0;
  for (let i = 0; i < links.length; i += BATCH) {
    const batch = links.slice(i, i + BATCH);
    const found = await db.backlink.findMany({
      where: {
        agencyId: run.agencyId,
        projectId: project.id,
        sourceUrl: { in: batch.map((l) => l.sourceUrl) },
      },
      select: { id: true, sourceUrl: true, targetUrl: true, lastSeen: true, lostAt: true },
      take: BATCH * 5,
    });
    const known = new Map(found.map((f) => [`${f.sourceUrl}\n${f.targetUrl}`, f]));
    const fresh: Prisma.BacklinkCreateManyInput[] = [];

    for (const link of batch) {
      const reasons = suspiciousReasons(link, tracked);
      if (reasons.length > 0) suspicious++;
      const lastSeen = day(link.lastSeen);
      const lostAt = link.lostAt ? day(link.lostAt) : null;
      const row = known.get(`${link.sourceUrl}\n${link.targetUrl}`);
      if (!row) {
        fresh.push({
          agencyId: run.agencyId,
          projectId: project.id,
          sourceUrl: link.sourceUrl,
          sourceDomain: link.sourceDomain,
          targetUrl: link.targetUrl,
          anchor: link.anchor.slice(0, 300),
          dofollow: link.dofollow,
          sourceRating: link.sourceRating,
          firstSeen: day(link.firstSeen),
          lastSeen,
          lostAt,
          suspicious: reasons.length > 0,
          suspiciousReasons: reasons,
        });
      } else if (!sameDay(row.lostAt, lostAt) || !sameDay(row.lastSeen, lastSeen)) {
        await db.backlink.update({
          where: { id: row.id, agencyId: run.agencyId },
          data: { lastSeen, lostAt },
        });
      }
    }
    if (fresh.length > 0) {
      await db.backlink.createMany({ data: fresh, skipDuplicates: true });
    }
  }

  // New and lost "since the last check" use the dates the provider reports, so they stay right
  // even when the window of links we read moves. The very first check has nothing to compare with.
  let newLinks = 0;
  let lostLinks = 0;
  if (previous) {
    [newLinks, lostLinks] = await Promise.all([
      db.backlink.count({
        where: {
          agencyId: run.agencyId,
          projectId: project.id,
          firstSeen: { gt: previous.takenOn, lte: takenOn },
        },
      }),
      db.backlink.count({
        where: {
          agencyId: run.agencyId,
          projectId: project.id,
          lostAt: { gt: previous.takenOn, lte: takenOn },
        },
      }),
    ]);
  }

  try {
    await db.backlinkSnapshot.create({
      data: {
        agencyId: run.agencyId,
        projectId: project.id,
        takenOn,
        totalBacklinks: summary.totalBacklinks,
        referringDomains: summary.referringDomains,
        dofollowPercent: Math.round(summary.dofollowPercent),
        domainRating: Math.round(summary.domainRating),
        newLinks,
        lostLinks,
      },
    });
  } catch (error) {
    // Another run saved the same day first. That is fine.
    if ((error as { code?: string }).code === "P2002") return { status: "already-checked" };
    throw error;
  }

  let alerted = false;
  if (previous) {
    const draft = buildBacklinkLossAlert({
      projectId: project.id,
      projectName: project.name,
      date: run.date,
      lost: lostLinks,
      activeBefore,
    });
    if (draft) alerted = (await createAlerts(db, run.agencyId, [draft])) > 0;
  }
  return { status: "done", stored: links.length, newLinks, lostLinks, suspicious, alerted };
}
