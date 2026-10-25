import { toCsv } from "@/lib/csv";
import { FLAG_LABELS } from "@/lib/content";
import { getSessionUser } from "@/server/auth/session";
import { loadTenantContext } from "@/server/auth/tenant-context";
import { logger } from "@/server/logger";
import { listContentForExport } from "@/server/services/content";
import { AppError } from "@/server/services/errors";
import { getProject } from "@/server/services/projects";

/** Downloads the content inventory (the pages of the latest audit) as a CSV file. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ agencySlug: string; projectId: string }> },
): Promise<Response> {
  const { agencySlug, projectId } = await params;
  const user = await getSessionUser();
  if (!user?.emailVerified) return new Response("Unauthorized", { status: 401 });
  const ctx = await loadTenantContext(user.id, agencySlug);
  if (!ctx) return new Response("Not found", { status: 404 });
  try {
    const [project, rows] = await Promise.all([
      getProject(ctx, projectId),
      listContentForExport(ctx, projectId),
    ]);
    const csv = toCsv(
      [
        "Page",
        "Title",
        "Status",
        "Words",
        "Problems",
        "Internal links",
        "Last updated",
        "Clicks (28 days)",
        "Clicks (28 days before)",
        "Keywords",
        "Needs attention",
      ],
      rows.map((r) => [
        r.url,
        r.title,
        r.statusCode,
        r.wordCount,
        r.issueCount,
        r.inlinks,
        r.lastModified,
        r.clicks,
        r.clicksBefore,
        r.keywords.join("; "),
        r.flags.map((f) => FLAG_LABELS[f]).join("; "),
      ]),
    );
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="content-${project.domain}-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof AppError)
      return new Response(error.message, { status: error.code === "NOT_FOUND" ? 404 : 403 });
    logger.error({ err: error }, "content export failed");
    return new Response("Something went wrong", { status: 500 });
  }
}
