import { COMPETITOR_DOMAINS } from "@/data/competitor-domains";
import type { RankResult, SearchDevice, SerpFeature, SerpResult } from "../types";
import { makeRng } from "./prng";

/** How long a big drop lasts, in days, before the keyword recovers. */
const DROP_DAYS = 7;
/** How many days of small ups and downs add up to the current wobble. */
const WALK_DAYS = 14;

export type RankKey = {
  domain: string;
  keyword: string;
  locationCode: number;
  languageCode: string;
  device: SearchDevice;
};

const keyString = (k: RankKey) =>
  `${k.domain}|${k.keyword}|${k.locationCode}|${k.languageCode}|${k.device}`;

/**
 * The position a keyword settles around. It never changes for the same domain and keyword.
 * 15% of keywords sit in 1 to 3, 25% in 4 to 10, 25% in 11 to 30, 20% in 31 to 100,
 * and 15% are not in the top 100.
 */
export function baseRank(key: RankKey): number | null {
  const rng = makeRng(keyString(key), "base");
  const u = rng.next();
  if (u < 0.15) return rng.int(1, 3);
  if (u < 0.4) return rng.int(4, 10);
  if (u < 0.65) return rng.int(11, 30);
  if (u < 0.85) return rng.int(31, 100);
  return null;
}

/** Small daily step: mostly 0, sometimes 1 or 2 up or down. */
function dailyStep(key: RankKey, day: number): number {
  const rng = makeRng(keyString(key), "step", day);
  const u = rng.next();
  if (u < 0.55) return 0;
  if (u < 0.75) return 1;
  if (u < 0.95) return -1;
  return rng.chance(0.5) ? 2 : -2;
}

/** About 2% of keywords drop 10 to 25 positions on a given day. */
function dropOnDay(key: RankKey, day: number): number {
  const rng = makeRng(keyString(key), "drop", day);
  return rng.chance(0.02) ? rng.int(10, 25) : 0;
}

/** Position on a given day (days since 1970), or null when not in the top 100. */
export function rankOnDay(key: RankKey, day: number): number | null {
  const base = baseRank(key);
  if (base === null) {
    // Keywords that do not rank sometimes show up deep in the results for a day.
    const rng = makeRng(keyString(key), "appear", day);
    return rng.chance(0.05) ? rng.int(70, 100) : null;
  }
  let walk = 0;
  for (let d = day - WALK_DAYS + 1; d <= day; d++) walk += dailyStep(key, d);
  let drop = 0;
  for (let d = day - DROP_DAYS + 1; d <= day; d++) drop += dropOnDay(key, d);
  const position = Math.max(1, base + walk + drop);
  return position > 100 ? null : position;
}

const FEATURES: readonly SerpFeature[] = [
  "featured_snippet",
  "people_also_ask",
  "local_pack",
  "image_pack",
  "video",
  "sitelinks",
  "knowledge_panel",
];

function titleCase(text: string): string {
  return text.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

export function slugForUrl(keyword: string): string {
  return keyword
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function buildRankResult(key: RankKey, day: number): RankResult {
  const position = rankOnDay(key, day);
  const rng = makeRng(key.keyword, key.locationCode, key.languageCode, "serp", day);

  // Which competitor domains fill the page. The same keyword gives a similar page each day.
  const stable = makeRng(key.keyword, key.locationCode, key.languageCode, "serp-stable");
  const pool = [...COMPETITOR_DOMAINS].filter((d) => d !== key.domain);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = stable.int(0, i);
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const slug = slugForUrl(key.keyword);
  const rankingUrl = position === null ? null : `https://${key.domain}/${slug}`;

  const topResults: SerpResult[] = [];
  let competitor = 0;
  for (let p = 1; p <= 10; p++) {
    if (position === p) {
      topResults.push({
        position: p,
        domain: key.domain,
        url: rankingUrl!,
        title: `${titleCase(key.keyword)} | ${key.domain}`,
      });
    } else {
      // On busy days two neighbours swap places, so the page is not frozen.
      const domain = pool[(competitor++ + (rng.chance(0.1) ? 1 : 0)) % pool.length]!;
      topResults.push({
        position: p,
        domain,
        url: `https://${domain}/${slug}`,
        title: `${titleCase(key.keyword)} - ${domain}`,
      });
    }
  }
  // If swaps repeated a domain, make every competitor unique again.
  const seen = new Set<string>([key.domain]);
  for (const r of topResults) {
    if (r.domain === key.domain) continue;
    let domain = r.domain;
    let i = 0;
    while (seen.has(domain)) domain = pool[(pool.indexOf(r.domain) + ++i) % pool.length]!;
    seen.add(domain);
    r.domain = domain;
    r.url = `https://${domain}/${slug}`;
    r.title = `${titleCase(key.keyword)} - ${domain}`;
  }

  const featureRng = makeRng(key.keyword, "features");
  const serpFeatures = FEATURES.filter(() => featureRng.chance(0.25));
  return { keyword: key.keyword, position, rankingUrl, serpFeatures, topResults };
}
