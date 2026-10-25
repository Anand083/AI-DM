import type { RankResult, SerpFeature, SerpResult } from "../../types";
import { arr, int, obj, sameSite, str, type Json } from "./shared";

const FEATURE_BY_TYPE: Record<string, SerpFeature> = {
  featured_snippet: "featured_snippet",
  people_also_ask: "people_also_ask",
  local_pack: "local_pack",
  images: "image_pack",
  video: "video",
  knowledge_graph: "knowledge_panel",
};

/** One keyword's `serp/.../live/advanced` result to our rank result. */
export function mapSerpResult(keyword: string, domain: string, result: unknown): RankResult {
  const items = arr(obj(result).items).map(obj);
  const organic = items.filter((i) => i.type === "organic");
  const features = new Set<SerpFeature>();
  for (const item of items) {
    const f = FEATURE_BY_TYPE[str(item.type)];
    if (f) features.add(f);
  }
  const mine = organic.find((i) => sameSite(str(i.domain), domain));
  if (mine && arr(mine.links).length > 0) features.add("sitelinks");
  const topResults: SerpResult[] = organic.slice(0, 10).map((i: Json, index) => ({
    position: int(i.rank_group, index + 1),
    domain: str(i.domain),
    url: str(i.url),
    title: str(i.title),
  }));
  return {
    keyword,
    position: mine ? int(mine.rank_group, 0) || null : null,
    rankingUrl: mine ? str(mine.url) || null : null,
    serpFeatures: [...features],
    topResults,
  };
}

/** Bing results have only organic items; this reads the position of a domain. */
export function mapBingRank(keyword: string, domain: string, result: unknown) {
  const mine = arr(obj(result).items)
    .map(obj)
    .find((i) => i.type === "organic" && sameSite(str(i.domain), domain));
  return {
    keyword,
    position: mine ? int(mine.rank_group, 0) || null : null,
    url: mine ? str(mine.url) || null : null,
  };
}
