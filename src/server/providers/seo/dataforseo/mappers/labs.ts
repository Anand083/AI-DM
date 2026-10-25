import type { KeywordIdea, KeywordIntent, KeywordMetric, RankedKeyword } from "../../types";
import { arr, int, num, obj, str } from "./shared";

const INTENTS: KeywordIntent[] = [
  "informational",
  "commercial",
  "transactional",
  "navigational",
  "local",
];

/** The last 12 months of search counts, oldest first. */
export function mapTrend(monthly: unknown): number[] {
  const rows = arr(monthly)
    .map(obj)
    .map((m) => ({ y: int(m.year), m: int(m.month), v: int(m.search_volume) }))
    .sort((a, b) => a.y - b.y || a.m - b.m);
  return rows.slice(-12).map((r) => r.v);
}

/** `dataforseo_labs/google/keyword_ideas/live` to keyword ideas. */
export function mapKeywordIdeas(result: unknown): KeywordIdea[] {
  return arr(obj(result).items)
    .map(obj)
    .map((item) => {
      const info = obj(item.keyword_info);
      const intent = str(obj(item.search_intent_info).main_intent);
      return {
        keyword: str(item.keyword),
        volume: int(info.search_volume),
        cpcMicros: Math.round((num(info.cpc) ?? 0) * 1_000_000),
        difficulty: Math.max(
          0,
          Math.min(100, int(obj(item.keyword_properties).keyword_difficulty)),
        ),
        intent: (INTENTS as string[]).includes(intent)
          ? (intent as KeywordIntent)
          : "informational",
        trend: mapTrend(info.monthly_searches),
      };
    })
    .filter((i) => i.keyword !== "");
}

/**
 * Search volume results (`keywords_data/google_ads/search_volume/live`, a list of keywords) and
 * difficulty items (`bulk_keyword_difficulty/live`) to one metric per asked phrase.
 */
export function mapKeywordMetrics(
  asked: string[],
  volumes: unknown[],
  difficulty: unknown,
): KeywordMetric[] {
  const vol = new Map(volumes.map(obj).map((v) => [str(v.keyword).toLowerCase(), v]));
  const diff = new Map(
    arr(obj(difficulty).items)
      .map(obj)
      .map((d) => [str(d.keyword).toLowerCase(), num(d.keyword_difficulty)] as const),
  );
  return asked.map((keyword) => {
    const v = vol.get(keyword.toLowerCase());
    const d = diff.get(keyword.toLowerCase());
    const cpc = v ? num(v.cpc) : null;
    return {
      keyword,
      volume: v ? num(v.search_volume) : null,
      cpcMicros: cpc === null ? null : Math.round(cpc * 1_000_000),
      difficulty: d === undefined || d === null ? null : Math.max(0, Math.min(100, Math.round(d))),
      trend: v ? mapTrend(v.monthly_searches) : [],
    };
  });
}

/** `dataforseo_labs/google/ranked_keywords/live` to ranked keywords. */
export function mapRankedKeywords(result: unknown): RankedKeyword[] {
  return arr(obj(result).items)
    .map(obj)
    .map((item) => {
      const data = obj(item.keyword_data);
      const serp = obj(obj(item.ranked_serp_element).serp_item);
      return {
        keyword: str(data.keyword),
        position: int(serp.rank_group),
        volume: int(obj(data.keyword_info).search_volume),
        url: str(serp.url),
      };
    })
    .filter((k) => k.keyword !== "" && k.position > 0);
}
