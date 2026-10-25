import { syncRanges } from "@/lib/google-metrics";
import type { Db } from "@/server/db/client";
import { open, seal } from "@/server/crypto/secret-box";
import { GoogleAuthError, type GoogleProvider } from "@/server/providers/google/types";

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
    select: { id: true },
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
