import { buildGoogleReconnectAlert } from "@/lib/alert-rules";
import { open, seal } from "@/server/crypto/secret-box";
import type { Db } from "@/server/db/client";
import { GoogleAuthError, type GoogleProvider } from "@/server/providers/google/types";
import { createAlerts } from "./alert-store";

export type InspectResult =
  | { status: "inactive" }
  | { status: "not-connected" }
  | { status: "needs-reconnect" }
  | { status: "no-site" }
  | { status: "done"; verdict: string };

const REFRESH_MARGIN_MS = 60_000;
const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Asks Google how one page of the project's Search Console site is indexed and saves the answer
 * (one row per page, replaced each time). Access problems mark the connection "needs reconnect"
 * and raise an alert; temporary Google problems are thrown so the job is tried again.
 */
export async function runUrlInspection(
  deps: { db: Db; provider: GoogleProvider; secret: string; now?: () => Date },
  run: { agencyId: string; projectId: string; url: string },
): Promise<InspectResult> {
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
  if (!connection.gscSite) return { status: "no-site" };

  const reconnect = async (message: string): Promise<InspectResult> => {
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
        return reconnect("Google did not give a long-lasting sign-in. Connect again.");
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
    const r = await provider.inspectUrl(accessToken, {
      siteUrl: connection.gscSite,
      inspectionUrl: run.url,
    });
    const data = {
      inspectedAt: now,
      verdict: r.verdict,
      coverageState: r.coverageState.slice(0, 200),
      indexingState: r.indexingState,
      robotsTxtState: r.robotsTxtState,
      pageFetchState: r.pageFetchState,
      lastCrawlTime: r.lastCrawlTime ? new Date(r.lastCrawlTime) : null,
      googleCanonical: r.googleCanonical?.slice(0, 2000) ?? null,
      userCanonical: r.userCanonical?.slice(0, 2000) ?? null,
      mobileVerdict: r.mobileVerdict,
      richVerdict: r.richResultsVerdict,
      richTypes: r.richResultTypes.slice(0, 10),
    };
    await db.urlInspection.upsert({
      where: {
        projectId_url: { projectId: project.id, url: run.url },
        agencyId: run.agencyId,
      },
      create: { agencyId: run.agencyId, projectId: project.id, url: run.url, ...data },
      update: data,
    });
    return { status: "done", verdict: r.verdict };
  } catch (error) {
    if (error instanceof GoogleAuthError && error.needsReconnect) return reconnect(error.message);
    throw error;
  }
}
