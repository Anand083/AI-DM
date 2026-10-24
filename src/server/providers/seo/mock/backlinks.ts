import { COMPETITOR_DOMAINS } from "@/data/competitor-domains";
import type { Backlink, BacklinkSummary, RankedKeyword } from "../types";
import { makeRng } from "./prng";
import { slugForUrl } from "./rankings";

export function buildBacklinkSummary(domain: string, now: Date): BacklinkSummary {
  const base = makeRng(domain, "backlinks");
  const totalBacklinks = Math.round(Math.exp(base.normal(7.5, 1.4)));
  const referringDomains = Math.max(1, Math.round(totalBacklinks * (0.08 + base.next() * 0.3)));
  const day = Math.floor(now.getTime() / 86_400_000);
  const daily = makeRng(domain, "backlinks-day", day);
  return {
    domain,
    totalBacklinks: totalBacklinks + daily.int(0, 5),
    referringDomains,
    dofollowPercent: Math.round(55 + base.next() * 35),
    newLast30Days: Math.round(totalBacklinks * (0.01 + base.next() * 0.04)),
    lostLast30Days: Math.round(totalBacklinks * (0.005 + base.next() * 0.03)),
    domainRating: base.int(5, 85),
  };
}

const ANCHORS = [
  "click here",
  "this article",
  "official site",
  "read more",
  "great resource",
  "our partner",
  "source",
  "learn more",
];

export function buildBacklink(domain: string, index: number, now: Date): Backlink {
  const rng = makeRng(domain, "backlink", index);
  const sourceDomain =
    index % 3 === 0 ? rng.pick(COMPETITOR_DOMAINS) : `blog${rng.int(1, 999)}.example`;
  const firstSeenDays = rng.int(1, 700);
  const lost = rng.chance(0.1);
  const lostDaysAgo = lost ? rng.int(0, Math.min(60, firstSeenDays)) : null;
  const day = (daysAgo: number) =>
    new Date(now.getTime() - daysAgo * 86_400_000).toISOString().slice(0, 10);
  return {
    sourceUrl: `https://${sourceDomain}/posts/${slugForUrl(`${rng.pick(ANCHORS)}-${index}`)}`,
    sourceDomain,
    targetUrl: `https://${domain}/${rng.chance(0.4) ? "" : slugForUrl(rng.pick(ANCHORS))}`,
    anchor: rng.pick(ANCHORS),
    dofollow: rng.chance(0.7),
    firstSeen: day(firstSeenDays),
    lastSeen: day(lostDaysAgo ?? 0),
    lostAt: lostDaysAgo === null ? null : day(lostDaysAgo),
    sourceRating: rng.int(1, 90),
  };
}

export function buildRankedKeywords(
  domain: string,
  locationCode: number,
  languageCode: string,
  limit: number,
): RankedKeyword[] {
  const name = domain.split(".")[0] ?? domain;
  const topics = [
    "services",
    "price",
    "near me",
    "reviews",
    "how to choose",
    "best",
    "guide",
    "cost",
    "tips",
    "online",
    "for beginners",
    "vs",
  ];
  const rng = makeRng(domain, locationCode, languageCode, "ranked");
  const rows: RankedKeyword[] = [];
  for (let i = 0; i < Math.max(0, limit); i++) {
    const topic = topics[i % topics.length]!;
    const keyword =
      i < topics.length
        ? `${name} ${topic}`
        : `${name} ${topic} ${Math.floor(i / topics.length) + 1}`;
    rows.push({
      keyword,
      position: Math.min(100, Math.max(1, Math.round(1 + rng.next() ** 1.7 * 99))),
      volume: Math.max(10, Math.round(Math.exp(rng.normal(6, 1.5)))),
      url: `https://${domain}/${slugForUrl(keyword)}`,
    });
  }
  return rows.sort((a, b) => a.position - b.position || b.volume - a.volume);
}
