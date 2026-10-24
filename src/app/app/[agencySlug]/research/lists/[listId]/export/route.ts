import { toCsv } from "@/lib/csv";
import { formatCpc } from "@/lib/research";
import { getSessionUser } from "@/server/auth/session";
import { loadTenantContext } from "@/server/auth/tenant-context";
import { AppError } from "@/server/services/errors";
import { getKeywordList, listKeywordListItemsForExport } from "@/server/services/research";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ agencySlug: string; listId: string }> },
): Promise<Response> {
  const { agencySlug, listId } = await params;
  const user = await getSessionUser();
  if (!user?.emailVerified) return new Response("Unauthorized", { status: 401 });
  const ctx = await loadTenantContext(user.id, agencySlug);
  if (!ctx) return new Response("Not found", { status: 404 });
  try {
    const [list, rows] = await Promise.all([
      getKeywordList(ctx, listId),
      listKeywordListItemsForExport(ctx, listId),
    ]);
    const csv = toCsv(
      ["Keyword", "Searches a month", "Cost per click", "Difficulty", "Intent"],
      rows.map((r) => [r.phrase, r.volume, formatCpc(r.cpcMicros), r.difficulty, r.intent]),
    );
    const name = list.name.replace(/[^A-Za-z0-9-_]+/g, "-").slice(0, 60) || "list";
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof AppError)
      return new Response(error.message, { status: error.code === "NOT_FOUND" ? 404 : 403 });
    throw error;
  }
}
