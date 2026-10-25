import type { TopResult } from "./competitors";

/** Big sites that rank for everything. They are not business rivals, so they are not suggested. */
export const GENERIC_DOMAINS = new Set([
  "wikipedia.org",
  "youtube.com",
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "pinterest.com",
  "reddit.com",
  "quora.com",
  "amazon.com",
  "ebay.com",
  "yelp.com",
  "tripadvisor.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "medium.com",
  "forbes.com",
  "nytimes.com",
  "healthline.com",
  "webmd.com",
  "mayoclinic.org",
  "yahoo.com",
  "google.com",
  "bing.com",
]);

const clean = (d: string) => d.toLowerCase().replace(/^www\./, "");

export type Suggestion = {
  domain: string;
  /** In how many of the project's checked keywords it is in the top 10. */
  keywords: number;
  /** Share of the checked keywords, in whole percent. */
  share: number;
  averagePosition: number;
};

/**
 * Websites that keep showing up in the top 10 of your keywords but are not tracked yet. A site
 * needs to appear for at least 3 keywords, or 20% of them when you track few. Big general sites
 * are left out.
 */
export function discoverCompetitors(
  tops: readonly (readonly TopResult[])[],
  ownDomain: string,
  known: readonly string[],
  limit = 8,
): Suggestion[] {
  const skip = new Set([clean(ownDomain), ...known.map(clean)]);
  const stats = new Map<string, { n: number; sum: number }>();
  const checked = tops.filter((t) => t.length > 0).length;
  for (const top of tops) {
    const seen = new Set<string>();
    for (const r of top) {
      const d = clean(r.domain);
      if (seen.has(d) || skip.has(d) || GENERIC_DOMAINS.has(d)) continue;
      if (r.position < 1 || r.position > 10) continue;
      seen.add(d);
      const s = stats.get(d) ?? { n: 0, sum: 0 };
      s.n++;
      s.sum += r.position;
      stats.set(d, s);
    }
  }
  const need = Math.max(2, Math.min(3, Math.ceil(checked * 0.2)));
  return [...stats.entries()]
    .filter(([, s]) => s.n >= need)
    .map(([domain, s]) => ({
      domain,
      keywords: s.n,
      share: checked === 0 ? 0 : Math.round((s.n / checked) * 100),
      averagePosition: Math.round((s.sum / s.n) * 10) / 10,
    }))
    .sort(
      (a, b) =>
        b.keywords - a.keywords ||
        a.averagePosition - b.averagePosition ||
        a.domain.localeCompare(b.domain),
    )
    .slice(0, limit);
}

export type RankCheckSample = { keywordId: string; date: string; topResults: readonly TopResult[] };
export type WeekPoint = {
  /** Last day of the week (YYYY-MM-DD). */
  weekEnd: string;
  /** Keywords with a check in the week. */
  keywords: number;
  byDomain: Record<string, { top10: number; averagePosition: number | null }>;
};

const DAY_MS = 86_400_000;
const dayNum = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / DAY_MS);

/**
 * How many keywords each website holds in the top 10, week by week. For every keyword the
 * newest check inside the week is used. `weekEnds` are the last days of the weeks, oldest first.
 */
export function competitorWeekly(
  checks: readonly RankCheckSample[],
  domains: readonly string[],
  weekEnds: readonly string[],
): WeekPoint[] {
  const wanted = domains.map(clean);
  return weekEnds.map((weekEnd) => {
    const end = dayNum(weekEnd);
    const latest = new Map<string, RankCheckSample>();
    for (const c of checks) {
      const d = dayNum(c.date);
      if (d > end || d <= end - 7) continue;
      const old = latest.get(c.keywordId);
      if (!old || c.date > old.date) latest.set(c.keywordId, c);
    }
    const byDomain: WeekPoint["byDomain"] = {};
    for (const d of wanted) {
      const positions: number[] = [];
      for (const c of latest.values()) {
        const hit = c.topResults.find((r) => clean(r.domain) === d);
        if (hit) positions.push(hit.position);
      }
      byDomain[d] = {
        top10: positions.length,
        averagePosition:
          positions.length === 0
            ? null
            : Math.round((positions.reduce((a, b) => a + b, 0) / positions.length) * 10) / 10,
      };
    }
    return { weekEnd, keywords: latest.size, byDomain };
  });
}

/** The last days of the last `weeks` weeks ending on `today`, oldest first. */
export function weekEnds(today: string, weeks: number): string[] {
  return Array.from({ length: weeks }, (_, i) => {
    const n = dayNum(today) - 7 * (weeks - 1 - i);
    return new Date(n * DAY_MS).toISOString().slice(0, 10);
  });
}

export const MOVE_MIN_GAIN = 3;
export const MOVE_MIN_PERCENT = 30;

/**
 * A competitor moved up if it holds clearly more top 10 places than the week before: at least 3
 * more and at least 30% more (any rise from nothing counts if it is 3 or more). Both weeks need
 * the same kind of coverage, so weeks with fewer than 5 keywords are ignored.
 */
export function detectCompetitorMove(
  before: WeekPoint | undefined,
  now: WeekPoint | undefined,
  domain: string,
): { from: number; to: number } | null {
  const d = clean(domain);
  if (!before || !now || before.keywords < 5 || now.keywords < 5) return null;
  const from = before.byDomain[d]?.top10 ?? 0;
  const to = now.byDomain[d]?.top10 ?? 0;
  const gain = to - from;
  if (gain < MOVE_MIN_GAIN) return null;
  if (from > 0 && (gain / from) * 100 < MOVE_MIN_PERCENT) return null;
  return { from, to };
}

export type LinkRow = { sourceDomain: string; rating: number };
export type LinkGapRow = {
  sourceDomain: string;
  rating: number;
  /** Which competitors this website links to. */
  competitors: string[];
};

/**
 * Websites that link to your competitors but not to you, strongest first: the ones that link to
 * more competitors, then the ones with the higher rating. These are the easiest places to ask for a link.
 */
export function linkGap(
  ours: ReadonlySet<string>,
  theirs: readonly { domain: string; links: readonly LinkRow[] }[],
  limit = 50,
): LinkGapRow[] {
  const mine = new Set([...ours].map(clean));
  const map = new Map<string, LinkGapRow>();
  for (const c of theirs) {
    for (const l of c.links) {
      const src = clean(l.sourceDomain);
      if (mine.has(src) || src === clean(c.domain)) continue;
      const row = map.get(src) ?? { sourceDomain: src, rating: l.rating, competitors: [] };
      row.rating = Math.max(row.rating, l.rating);
      if (!row.competitors.includes(c.domain)) row.competitors.push(c.domain);
      map.set(src, row);
    }
  }
  return [...map.values()]
    .map((r) => ({ ...r, competitors: [...r.competitors].sort() }))
    .sort(
      (a, b) =>
        b.competitors.length - a.competitors.length ||
        b.rating - a.rating ||
        a.sourceDomain.localeCompare(b.sourceDomain),
    )
    .slice(0, limit);
}

export type AnchorKind = "branded" | "exact" | "partial" | "generic" | "url" | "empty" | "other";

export const ANCHOR_LABELS: Record<AnchorKind, string> = {
  branded: "Brand name",
  exact: "Exact keyword",
  partial: "Contains a keyword",
  generic: "Generic words (click here)",
  url: "Web address",
  empty: "No text (image)",
  other: "Other",
};

const GENERIC = new Set([
  "click here",
  "here",
  "read more",
  "learn more",
  "more",
  "this",
  "this site",
  "this website",
  "website",
  "link",
  "visit",
  "visit site",
  "source",
  "check it out",
  "go",
  "see more",
  "homepage",
  "home",
]);

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** What kind of text a link uses. Brand terms are the brand and domain words. */
export function classifyAnchor(
  anchor: string,
  brandTerms: readonly string[],
  keywords: readonly string[],
): AnchorKind {
  const a = norm(anchor);
  if (a === "") return "empty";
  if (
    /^(https?:\/\/|www\.)/.test(anchor.trim().toLowerCase()) ||
    /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/.test(a)
  ) {
    return "url";
  }
  if (GENERIC.has(a)) return "generic";
  const brands = brandTerms.map(norm).filter((b) => b.length >= 3);
  if (brands.some((b) => a.includes(b))) return "branded";
  const phrases = keywords.map(norm).filter(Boolean);
  if (phrases.includes(a)) return "exact";
  const words = new Set(a.split(" "));
  if (
    phrases.some((p) => {
      const pw = p.split(" ").filter((w) => w.length > 2);
      return pw.length > 0 && pw.every((w) => words.has(w));
    })
  ) {
    return "partial";
  }
  return "other";
}

export type AnchorRow = { kind: AnchorKind; count: number; percent: number };

/** Share of links by anchor type, biggest first. Warns when exact keywords are over-used. */
export function anchorDistribution(
  anchors: readonly string[],
  brandTerms: readonly string[],
  keywords: readonly string[],
): { total: number; rows: AnchorRow[]; overOptimised: boolean } {
  const counts = new Map<AnchorKind, number>();
  for (const a of anchors) {
    const kind = classifyAnchor(a, brandTerms, keywords);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const total = anchors.length;
  const rows = [...counts.entries()]
    .map(([kind, count]) => ({ kind, count, percent: Math.round((count / total) * 100) }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
  const exact = counts.get("exact") ?? 0;
  return { total, rows, overOptimised: total >= 20 && exact / total > 0.3 };
}
