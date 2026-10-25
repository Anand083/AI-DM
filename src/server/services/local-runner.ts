import { LISTING_SOURCES } from "@/lib/local";
import type { Db } from "@/server/db/client";
import type { ListingResult, RankResult, SearchDevice } from "@/server/providers/seo/types";
import { AppError } from "./errors";
import type { GatewayCaller, GatewayResult } from "./seo-gateway";

export type LocalGateway = {
  getRankings(
    caller: GatewayCaller,
    input: {
      domain: string;
      keywords: string[];
      locationCode: number;
      languageCode: string;
      device: SearchDevice;
    },
  ): Promise<GatewayResult<RankResult[]>>;
  getListings(
    caller: GatewayCaller,
    input: { name: string; address: string; phone: string; city: string; sources: string[] },
  ): Promise<GatewayResult<ListingResult[]>>;
};

export type LocalRunResult =
  | { status: "inactive" }
  | { status: "no-locations" }
  | { status: "no-keywords" }
  | { status: "done" | "stopped"; locations: number; saved: number; reason?: string };

/** Keywords checked from each location. */
export const LOCAL_KEYWORD_LIMIT = 25;
const day = (v: string) => new Date(`${v}T00:00:00Z`);

async function loadProject(db: Db, run: { agencyId: string; projectId: string }) {
  return db.project.findFirst({
    where: {
      id: run.projectId,
      agencyId: run.agencyId,
      deletedAt: null,
      client: { deletedAt: null, status: "ACTIVE" },
    },
    select: { id: true, domain: true, locationCode: true, languageCode: true },
  });
}

/**
 * Checks where the project's keywords rank as seen from each location. Keywords tagged "local"
 * are used; without any, the first few keywords. A day that already has a result is not asked
 * again (the gateway also caches). `codeFor` gives the search location for a place.
 */
export async function runLocalRanks(
  deps: {
    db: Db;
    gateway: LocalGateway;
    codeFor: (
      location: { city: string; locationCode: number | null },
      projectCode: number,
    ) => number;
  },
  run: { agencyId: string; projectId: string; date: string },
): Promise<LocalRunResult> {
  const { db, gateway } = deps;
  const project = await loadProject(db, run);
  if (!project) return { status: "inactive" };
  const locations = await db.location.findMany({
    where: { agencyId: run.agencyId, projectId: project.id },
    select: { id: true, city: true, locationCode: true },
    orderBy: { name: "asc" },
    take: 10,
  });
  if (locations.length === 0) return { status: "no-locations" };

  const tagged = await db.keyword.findMany({
    where: { agencyId: run.agencyId, projectId: project.id, tags: { has: "local" } },
    select: { id: true, phrase: true },
    orderBy: { phrase: "asc" },
    take: LOCAL_KEYWORD_LIMIT,
  });
  const keywords =
    tagged.length > 0
      ? tagged
      : await db.keyword.findMany({
          where: { agencyId: run.agencyId, projectId: project.id },
          select: { id: true, phrase: true },
          orderBy: { phrase: "asc" },
          take: LOCAL_KEYWORD_LIMIT,
        });
  if (keywords.length === 0) return { status: "no-keywords" };

  const caller = { agencyId: run.agencyId, projectId: project.id };
  const date = day(run.date);
  let saved = 0;
  let done = 0;
  let reason: string | undefined;
  try {
    for (const location of locations) {
      const result = await gateway.getRankings(caller, {
        domain: project.domain,
        keywords: keywords.map((k) => k.phrase),
        locationCode: deps.codeFor(location, project.locationCode),
        languageCode: project.languageCode,
        device: "desktop",
      });
      const byPhrase = new Map(result.data.map((r) => [r.keyword.toLowerCase(), r]));
      const rows = keywords.flatMap((k) => {
        const r = byPhrase.get(k.phrase.toLowerCase());
        return r
          ? [
              {
                agencyId: run.agencyId,
                projectId: project.id,
                locationId: location.id,
                keywordId: k.id,
                date,
                position: r.position,
                url: r.rankingUrl,
                provider: result.provider,
              },
            ]
          : [];
      });
      if (rows.length > 0) {
        const created = await db.localRank.createMany({ data: rows, skipDuplicates: true });
        saved += created.count;
      }
      done++;
    }
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    reason = error.message;
  }
  return { status: reason ? "stopped" : "done", locations: done, saved, reason };
}

/**
 * Looks up what directories show for each location and saves it (one row per directory, replaced
 * each time). Comparing with the right details happens when the page is shown.
 */
export async function runListingChecks(
  deps: { db: Db; gateway: LocalGateway },
  run: { agencyId: string; projectId: string; date: string },
): Promise<LocalRunResult> {
  const { db, gateway } = deps;
  const project = await loadProject(db, run);
  if (!project) return { status: "inactive" };
  const locations = await db.location.findMany({
    where: { agencyId: run.agencyId, projectId: project.id },
    select: { id: true, name: true, city: true, address: true, phone: true },
    orderBy: { name: "asc" },
    take: 10,
  });
  if (locations.length === 0) return { status: "no-locations" };

  const caller = { agencyId: run.agencyId, projectId: project.id };
  let saved = 0;
  let done = 0;
  let reason: string | undefined;
  try {
    for (const location of locations) {
      const result = await gateway.getListings(caller, {
        name: location.name,
        address: location.address,
        phone: location.phone,
        city: location.city,
        sources: [...LISTING_SOURCES],
      });
      await db.listingCheck.deleteMany({
        where: { agencyId: run.agencyId, locationId: location.id },
      });
      if (result.data.length > 0) {
        await db.listingCheck.createMany({
          data: result.data.map((l) => ({
            agencyId: run.agencyId,
            projectId: project.id,
            locationId: location.id,
            source: l.source,
            found: l.found,
            name: l.name,
            address: l.address,
            phone: l.phone,
            url: l.url,
            checkedOn: day(run.date),
            provider: result.provider,
          })),
          skipDuplicates: true,
        });
        saved += result.data.length;
      }
      done++;
    }
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    reason = error.message;
  }
  return { status: reason ? "stopped" : "done", locations: done, saved, reason };
}
