import { buildGoogleAnomalyAlert, buildGoogleReconnectAlert } from "@/lib/alert-rules";
import { addDays, GSC_LAG_DAYS as GSC_LAG, syncRanges } from "@/lib/google-metrics";
import type { Db } from "@/server/db/client";
import { open, seal } from "@/server/crypto/secret-box";
import {
  BREAKDOWN_DIMENSIONS,
  GoogleAuthError,
  type BreakdownDimension,
  type GoogleProvider,
} from "@/server/providers/google/types";
import { createAlerts } from "./alert-store";

/** How many rows of each top list are kept. */
export const BREAKDOWN_LIMITS: Record<BreakdownDimension, number> = {
  QUERY: 250,
  PAGE: 250,
  COUNTRY: 50,
  DEVICE: 10,
};
const PAGES_LIMIT = 250;

export type GoogleSyncResult =
  | { status: "inactive" }
  | { status: "not-connected" }
  | { status: "needs-reconnect" }
  | { status: "nothing-selected" }
  | { status: "done"; searchDays: number; analyticsDays: number };

const day = (d: Date) => d.toISOString().slice(0, 10);
const dayDate = (value: string) => new Date(`${value}T00:00:00Z`);
/** Refresh the access token when it ends within this time. */
const REFRESH_MARGIN_MS = 60_000;

/**
 * Reads the latest Search Console and Analytics numbers for one project and saves them.
 * The first run goes back 90 days; later runs overlap the last 5 days, because Google still
 * adjusts recent days. Old rows for the range are replaced, so running twice is safe.
 * When Google no longer accepts the tokens the connection is marked "needs reconnect" and the
 * run ends without an error (nothing to retry). Temporary Google problems are thrown, so the
 * job is tried again.
 */
export async function runGoogleSync(
  deps: { db: Db; provider: GoogleProvider; secret: string; now?: () => Date },
  run: { projectId: string; agencyId: string },
): Promise<GoogleSyncResult> {
  const { db, provider, secret } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const project = await db.project.findFirst({
    where: {
      id: run.projectId,
      agencyId: run.agencyId,
      deletedAt: null,
      client: { deletedAt: null, status: "ACTIVE" },
    },
    select: { id: true, name: true },
  });
  if (!project) return { status: "inactive" };

  const connection = await db.googleConnection.findFirst({
    where: { agencyId: run.agencyId, projectId: project.id },
  });
  if (!connection) return { status: "not-connected" };
  if (connection.status !== "ACTIVE") return { status: "needs-reconnect" };
  if (!connection.gscSite && !connection.ga4PropertyId) return { status: "nothing-selected" };

  const markReconnect = async (message: string): Promise<GoogleSyncResult> => {
    await db.googleConnection.updateMany({
      where: { id: connection.id, agencyId: run.agencyId },
      data: { status: "NEEDS_RECONNECT", lastError: message },
    });
    await createAlerts(db, run.agencyId, [
      buildGoogleReconnectAlert({
        projectId: project.id,
        projectName: project.name,
        date: day(now),
      }),
    ]);
    return { status: "needs-reconnect" };
  };

  try {
    let accessToken = open(connection.accessTokenEnc, secret);
    if (connection.accessExpiresAt.getTime() - now.getTime() < REFRESH_MARGIN_MS) {
      if (!connection.refreshTokenEnc) {
        return markReconnect("Google did not give a long-lasting sign-in. Connect again.");
      }
      const refreshed = await provider.refresh(open(connection.refreshTokenEnc, secret));
      accessToken = refreshed.accessToken;
      await db.googleConnection.updateMany({
        where: { id: connection.id, agencyId: run.agencyId },
        data: {
          accessTokenEnc: seal(refreshed.accessToken, secret),
          accessExpiresAt: refreshed.expiresAt,
        },
      });
    }

    const ranges = syncRanges(
      connection.lastSyncedOn ? day(connection.lastSyncedOn) : null,
      day(now),
    );
    let searchDays = 0;
    let analyticsDays = 0;

    if (connection.gscSite && ranges.gsc) {
      const rows = await provider.getSearchConsoleDaily(accessToken, {
        siteUrl: connection.gscSite,
        startDate: ranges.gsc.start,
        endDate: ranges.gsc.end,
      });
      await db.searchConsoleDay.deleteMany({
        where: {
          agencyId: run.agencyId,
          projectId: project.id,
          date: { gte: dayDate(ranges.gsc.start), lte: dayDate(ranges.gsc.end) },
        },
      });
      if (rows.length > 0)
        await db.searchConsoleDay.createMany({
          data: rows.map((r) => ({
            agencyId: run.agencyId,
            projectId: project.id,
            date: dayDate(r.date),
            clicks: r.clicks,
            impressions: r.impressions,
            positionTenths: Math.round(r.position * 10),
          })),
          skipDuplicates: true,
        });
      searchDays = rows.length;
    }

    if (connection.ga4PropertyId && ranges.ga4) {
      const rows = await provider.getGa4Daily(accessToken, {
        propertyId: connection.ga4PropertyId,
        startDate: ranges.ga4.start,
        endDate: ranges.ga4.end,
      });
      await db.ga4Day.deleteMany({
        where: {
          agencyId: run.agencyId,
          projectId: project.id,
          date: { gte: dayDate(ranges.ga4.start), lte: dayDate(ranges.ga4.end) },
        },
      });
      if (rows.length > 0)
        await db.ga4Day.createMany({
          data: rows.map((r) => ({
            agencyId: run.agencyId,
            projectId: project.id,
            date: dayDate(r.date),
            sessions: r.sessions,
            conversions: r.conversions,
          })),
          skipDuplicates: true,
        });
      analyticsDays = rows.length;
    }

    if (connection.gscSite) {
      await saveBreakdowns(deps, run, connection.gscSite, accessToken, day(now));
    }
    if (connection.ga4PropertyId) {
      await saveLandingPages(deps, run, connection.ga4PropertyId, accessToken, day(now));
    }
    await raiseAnomalies(
      db,
      run.agencyId,
      project,
      !!connection.gscSite,
      !!connection.ga4PropertyId,
    );

    await db.googleConnection.updateMany({
      where: { id: connection.id, agencyId: run.agencyId },
      data: { lastSyncedOn: dayDate(day(now)), lastError: null },
    });
    return { status: "done", searchDays, analyticsDays };
  } catch (error) {
    if (error instanceof GoogleAuthError && error.needsReconnect) {
      return markReconnect(error.message);
    }
    throw error;
  }
}

type SyncDeps = { db: Db; provider: GoogleProvider };

/** Top queries, pages, countries and devices for the last 28 days and the 28 days before. */
async function saveBreakdowns(
  { db, provider }: SyncDeps,
  run: { projectId: string; agencyId: string },
  siteUrl: string,
  accessToken: string,
  today: string,
): Promise<void> {
  const end = addDays(today, -GSC_LAG);
  const periods = [
    { period: "NOW", startDate: addDays(end, -27), endDate: end },
    { period: "BEFORE", startDate: addDays(end, -55), endDate: addDays(end, -28) },
  ] as const;
  for (const dimension of BREAKDOWN_DIMENSIONS) {
    for (const p of periods) {
      // Before-period lists are only needed to show change for queries and pages.
      if (p.period === "BEFORE" && (dimension === "COUNTRY" || dimension === "DEVICE")) continue;
      const rows = await provider.getSearchBreakdown(accessToken, {
        siteUrl,
        startDate: p.startDate,
        endDate: p.endDate,
        dimension,
        limit: BREAKDOWN_LIMITS[dimension],
      });
      const unique = new Map(rows.map((r) => [r.key.slice(0, 500), r]));
      await db.searchBreakdown.deleteMany({
        where: { agencyId: run.agencyId, projectId: run.projectId, dimension, period: p.period },
      });
      if (unique.size > 0)
        await db.searchBreakdown.createMany({
          data: [...unique].map(([key, r]) => ({
            agencyId: run.agencyId,
            projectId: run.projectId,
            dimension,
            period: p.period,
            key,
            clicks: r.clicks,
            impressions: r.impressions,
            positionTenths: Math.round(r.position * 10),
          })),
          skipDuplicates: true,
        });
    }
  }
}

/** Top landing pages from Google Analytics for the last 28 days (up to yesterday). */
async function saveLandingPages(
  { db, provider }: SyncDeps,
  run: { projectId: string; agencyId: string },
  propertyId: string,
  accessToken: string,
  today: string,
): Promise<void> {
  const end = addDays(today, -1);
  const rows = await provider.getGa4Pages(accessToken, {
    propertyId,
    startDate: addDays(end, -27),
    endDate: end,
    limit: PAGES_LIMIT,
  });
  const unique = new Map(rows.map((r) => [r.path.slice(0, 500), r]));
  await db.ga4Page.deleteMany({ where: { agencyId: run.agencyId, projectId: run.projectId } });
  if (unique.size > 0)
    await db.ga4Page.createMany({
      data: [...unique].map(([path, r]) => ({
        agencyId: run.agencyId,
        projectId: run.projectId,
        path,
        sessions: r.sessions,
        engagedSessions: r.engagedSessions,
        conversions: r.conversions,
      })),
      skipDuplicates: true,
    });
}

/** Compares the newest 7 days with the 7 days before and alerts on a sharp fall. */
async function raiseAnomalies(
  db: Db,
  agencyId: string,
  project: { id: string; name: string },
  search: boolean,
  analytics: boolean,
): Promise<void> {
  const drafts = [];
  if (search) {
    const rows = await db.searchConsoleDay.findMany({
      where: { agencyId, projectId: project.id },
      select: { date: true, clicks: true },
      orderBy: { date: "desc" },
      take: 14,
    });
    if (rows.length === 14) {
      const sum = (part: typeof rows) => part.reduce((a, r) => a + r.clicks, 0);
      const draft = buildGoogleAnomalyAlert({
        projectId: project.id,
        projectName: project.name,
        source: "clicks",
        date: day(rows[0]!.date),
        recent: sum(rows.slice(0, 7)),
        before: sum(rows.slice(7)),
      });
      if (draft) drafts.push(draft);
    }
  }
  if (analytics) {
    const rows = await db.ga4Day.findMany({
      where: { agencyId, projectId: project.id },
      select: { date: true, sessions: true },
      orderBy: { date: "desc" },
      take: 14,
    });
    if (rows.length === 14) {
      const sum = (part: typeof rows) => part.reduce((a, r) => a + r.sessions, 0);
      const draft = buildGoogleAnomalyAlert({
        projectId: project.id,
        projectName: project.name,
        source: "sessions",
        date: day(rows[0]!.date),
        recent: sum(rows.slice(0, 7)),
        before: sum(rows.slice(7)),
      });
      if (draft) drafts.push(draft);
    }
  }
  await createAlerts(db, agencyId, drafts);
}
