import type { RankPriority, SeoOperation } from "./types";

/**
 * Estimated provider cost in micro-dollars (1,000,000 = $1).
 * These are PLACEHOLDERS. Check every value against the DataForSEO pricing page
 * (https://dataforseo.com/pricing) before go-live. Real calls save the actual cost
 * the API reports, so these only matter for the mock and for budget checks.
 */
export const UNIT_COST_MICROS = {
  /** per keyword, standard queue */
  rankingStandard: 600,
  /** per keyword, live */
  rankingLive: 2000,
  /** per keyword ideas request */
  keywordIdeas: 10_000,
  /** per crawled page */
  auditPage: 250,
  /** per backlink summary request */
  backlinkSummary: 20_000,
  /** per backlinks request, plus per row */
  backlinks: 20_000,
  backlinkRow: 30,
  /** per ranked keywords request, plus per row */
  rankedKeywords: 10_000,
  rankedKeywordRow: 100,
  /** per AI visibility check */
  aiVisibility: 10_000,
  /** per AI topic demand request */
  aiTopics: 8000,
  /** per LLM mentions request */
  llmMentions: 12_000,
  /** per reviews request */
  reviews: 1500,
} as const;

export function estimateCostMicros(
  op: SeoOperation,
  units: number,
  priority: RankPriority = "standard",
): number {
  const n = Math.max(0, Math.ceil(units));
  switch (op) {
    case "rankings":
      return (
        n * (priority === "live" ? UNIT_COST_MICROS.rankingLive : UNIT_COST_MICROS.rankingStandard)
      );
    case "keyword_ideas":
      return UNIT_COST_MICROS.keywordIdeas;
    case "audit_page":
      return n * UNIT_COST_MICROS.auditPage;
    case "backlink_summary":
      return UNIT_COST_MICROS.backlinkSummary;
    case "backlinks":
      return UNIT_COST_MICROS.backlinks + n * UNIT_COST_MICROS.backlinkRow;
    case "ranked_keywords":
      return UNIT_COST_MICROS.rankedKeywords + n * UNIT_COST_MICROS.rankedKeywordRow;
    case "ai_visibility":
      return n * UNIT_COST_MICROS.aiVisibility;
    case "ai_topics":
      return UNIT_COST_MICROS.aiTopics;
    case "llm_mentions":
      return UNIT_COST_MICROS.llmMentions;
    case "reviews":
      return UNIT_COST_MICROS.reviews;
  }
}
