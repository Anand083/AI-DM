import { toCsv } from "@/lib/csv";
import { REASON_LABELS } from "@/lib/backlink-math";
import { getSessionUser } from "@/server/auth/session";
import { loadTenantContext } from "@/server/auth/tenant-context";
import { logger } from "@/server/logger";
import {
  BACKLINK_FILTERS,
  listBacklinksForExport,
  type BacklinkFilter,
} from "@/server/services/backlinks";
import { AppError } from "@/server/services/errors";
import { getProject } from "@/server/services/projects";

/** Downloads the backlinks table as a CSV file. Same filter as the page. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ agencySlug: string; projectId: string }> },
): Promise<Response> {
  const { agencySlug, projectId } = await params;
  const user = await getSessionUser();
  if (!user?.emailVerified) return new Response("Unauthorized", { status: 401 });
  const ctx = await loadTenantContext(user.id, agencySlug);
  if (!ctx) return new Response("Not found", { status: 404 });

  const asked = new URL(request.url).searchParams.get("filter");
  const filter: BacklinkFilter = BACKLINK_FILTERS.includes(asked as BacklinkFilter)
    ? (asked as BacklinkFilter)
    : "active";
  try {
    const [project, rows] = await Promise.all([
      getProject(ctx, projectId),
      listBacklinksForExport(ctx, projectId, filter),
    ]);
    const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
    const csv = toCsv(
      [
        "Source URL",
        "Source domain",
        "Target URL",
        "Anchor text",
        "Type",
        "Source rating",
        "First seen",
        "Last seen",
        "Lost on",
        "Suspicious",
        "Why suspicious",
      ],
      rows.map((r) => [
        r.sourceUrl,
        r.sourceDomain,
        r.targetUrl,
        r.anchor,
        r.dofollow ? "dofollow" : "nofollow",
        r.sourceRating,
        day(r.firstSeen),
        day(r.lastSeen),
        day(r.lostAt),
        r.suspicious ? "yes" : "no",
        r.suspiciousReasons.map((x) => REASON_LABELS[x]).join("; "),
      ]),
    );
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="backlinks-${project.domain}-${filter}-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof AppError)
      return new Response(error.message, { status: error.code === "NOT_FOUND" ? 404 : 403 });
    logger.error({ err: error }, "backlinks export failed");
    return new Response("Something went wrong", { status: 500 });
  }
}
