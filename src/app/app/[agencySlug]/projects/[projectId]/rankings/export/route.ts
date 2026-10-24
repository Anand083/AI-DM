import { toCsv } from "@/lib/csv";
import { formatChange, formatPosition } from "@/lib/rank-math";
import { getSessionUser } from "@/server/auth/session";
import { loadTenantContext } from "@/server/auth/tenant-context";
import { AppError } from "@/server/services/errors";
import { SORTS, listRankingsForExport, type RankingSort } from "@/server/services/keywords";
import { getProject } from "@/server/services/projects";
import { logger } from "@/server/logger";

/** Downloads the rankings table as a CSV file. Same filters as the page. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ agencySlug: string; projectId: string }> },
): Promise<Response> {
  const { agencySlug, projectId } = await params;
  const user = await getSessionUser();
  if (!user?.emailVerified) return new Response("Unauthorized", { status: 401 });
  const ctx = await loadTenantContext(user.id, agencySlug);
  if (!ctx) return new Response("Not found", { status: 404 });

  const q = new URL(request.url).searchParams;
  const sort = q.get("sort");
  try {
    const [project, rows] = await Promise.all([
      getProject(ctx, projectId),
      listRankingsForExport(ctx, projectId, {
        q: q.get("q") ?? undefined,
        tag: q.get("tag") ?? undefined,
        bucket: (q.get("bucket") as never) ?? undefined,
        sort: SORTS.includes(sort as RankingSort) ? (sort as RankingSort) : undefined,
        dir: q.get("dir") === "desc" ? "desc" : "asc",
      }),
    ]);
    const csv = toCsv(
      [
        "Keyword",
        "Position",
        "Change (1 day)",
        "Change (7 days)",
        "Change (30 days)",
        "Best position",
        "Ranking URL",
        "SERP features",
        "Tags",
        "Last checked",
      ],
      rows.map((r) => [
        r.phrase,
        r.lastCheckedOn ? formatPosition(r.currentPosition) : "Not checked",
        r.changeDay === null ? "" : formatChange(r.changeDay),
        r.changeWeek === null ? "" : formatChange(r.changeWeek),
        r.changeMonth === null ? "" : formatChange(r.changeMonth),
        r.bestPosition ?? "",
        r.currentUrl ?? "",
        r.currentFeatures.join("; "),
        r.tags.join("; "),
        r.lastCheckedOn ? r.lastCheckedOn.toISOString().slice(0, 10) : "",
      ]),
    );
    const day = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="rankings-${project.domain}-${day}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof AppError)
      return new Response(error.message, { status: error.code === "NOT_FOUND" ? 404 : 403 });
    logger.error({ err: error }, "rankings export failed");
    return new Response("Something went wrong", { status: 500 });
  }
}
