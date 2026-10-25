import { toCsv } from "@/lib/csv";
import { getSessionUser } from "@/server/auth/session";
import { loadTenantContext } from "@/server/auth/tenant-context";
import { logger } from "@/server/logger";
import { AppError } from "@/server/services/errors";
import { listPerformance } from "@/server/services/performance";

const PAGE = 100;
const MAX_PAGES = 5;

/** Downloads the performance table as a CSV file (the first 500 projects). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ agencySlug: string }> },
): Promise<Response> {
  const { agencySlug } = await params;
  const user = await getSessionUser();
  if (!user?.emailVerified) return new Response("Unauthorized", { status: 401 });
  const ctx = await loadTenantContext(user.id, agencySlug);
  if (!ctx) return new Response("Not found", { status: 404 });
  try {
    const all = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { rows, total } = await listPerformance(ctx, { page, pageSize: PAGE });
      all.push(...rows);
      if (all.length >= total) break;
    }
    const cell = (n: number | null) => (n === null ? "" : n);
    const csv = toCsv(
      [
        "Client",
        "Project",
        "Keywords",
        "Average position",
        "Top 10",
        "Health score",
        "Clicks (28 days)",
        "Open tasks",
        "Late tasks",
        "Goals",
        "Goals reached",
      ],
      all.map((r) => [
        r.clientName,
        r.projectName,
        r.keywords,
        cell(r.averagePosition),
        r.top10,
        cell(r.healthScore),
        cell(r.clicks28d),
        r.openTasks,
        r.overdueTasks,
        r.goals,
        r.goalsReached,
      ]),
    );
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="performance-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof AppError)
      return new Response(error.message, { status: error.code === "NOT_FOUND" ? 404 : 403 });
    logger.error({ err: error }, "performance export failed");
    return new Response("Something went wrong", { status: 500 });
  }
}
