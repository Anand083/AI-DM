import { toCsv } from "@/lib/csv";
import { filterIdeas, formatCpc, IDEA_SORTS, INTENTS, type IdeaSort } from "@/lib/research";
import { getSessionUser } from "@/server/auth/session";
import { loadTenantContext } from "@/server/auth/tenant-context";
import { AppError } from "@/server/services/errors";
import { searchKeywordIdeas } from "@/server/services/research";
import type { KeywordIntent } from "@/server/providers/seo/types";

const num = (v: string | null) =>
  v !== null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined;

/** Downloads the research results as CSV. The search is repeated, so it comes from saved results and is free. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ agencySlug: string }> },
): Promise<Response> {
  const { agencySlug } = await params;
  const user = await getSessionUser();
  if (!user?.emailVerified) return new Response("Unauthorized", { status: 401 });
  const ctx = await loadTenantContext(user.id, agencySlug);
  if (!ctx) return new Response("Not found", { status: 404 });

  const q = new URL(request.url).searchParams;
  try {
    const { ideas } = await searchKeywordIdeas(ctx, {
      seed: q.get("q") ?? "",
      locationCode: num(q.get("loc")) ?? 2840,
      languageCode: q.get("lang") ?? "en",
    });
    const intent = q.get("intent") as KeywordIntent | null;
    const sort = q.get("sort") as IdeaSort | null;
    const rows = filterIdeas(ideas, {
      intent: intent && INTENTS.includes(intent) ? intent : undefined,
      minVolume: num(q.get("minVolume")),
      maxDifficulty: num(q.get("maxDifficulty")),
      sort: sort && IDEA_SORTS.includes(sort) ? sort : "volume",
      dir: q.get("dir") === "asc" ? "asc" : q.get("dir") === "desc" ? "desc" : undefined,
    });
    const csv = toCsv(
      ["Keyword", "Searches a month", "Cost per click", "Difficulty", "Intent"],
      rows.map((r) => [r.keyword, r.volume, formatCpc(r.cpcMicros), r.difficulty, r.intent]),
    );
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="keyword-research.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof AppError)
      return new Response(error.message, {
        status: error.code === "NOT_FOUND" ? 404 : error.code === "VALIDATION" ? 400 : 403,
      });
    throw error;
  }
}
