export type SearchIntent =
  "informational" | "commercial" | "transactional" | "navigational" | "local";

export const INTENT_LABELS: Record<SearchIntent, string> = {
  informational: "Wants to learn",
  commercial: "Comparing options",
  transactional: "Ready to buy",
  navigational: "Looking for the brand",
  local: "Looking nearby",
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const hasWord = (text: string, words: readonly string[]) =>
  words.some((w) => new RegExp(`(^|\\s)${w}(\\s|$)`).test(text));

const LOCAL = ["near me", "nearby", "close to me", "open now", "in my area"];
const TRANSACTIONAL = [
  "buy",
  "price",
  "prices",
  "pricing",
  "cheap",
  "discount",
  "coupon",
  "order",
  "hire",
  "quote",
  "book",
  "booking",
  "for sale",
  "deal",
  "deals",
  "cost",
  "subscribe",
];
const COMMERCIAL = [
  "best",
  "top",
  "review",
  "reviews",
  "compare",
  "comparison",
  "vs",
  "versus",
  "alternative",
  "alternatives",
  "recommended",
  "rated",
];
const INFORMATIONAL = [
  "how",
  "what",
  "why",
  "when",
  "who",
  "which",
  "guide",
  "tutorial",
  "tips",
  "ideas",
  "examples",
  "meaning",
  "definition",
  "checklist",
  "learn",
];

/**
 * A rough guess of what the searcher wants, from the words of the phrase. It is a guide, not a
 * fact. `brandTerms` are words of the brand or domain (a phrase with one is "looking for the brand").
 */
export function classifyIntent(phrase: string, brandTerms: readonly string[] = []): SearchIntent {
  const text = norm(phrase);
  const brands = brandTerms.map(norm).filter((b) => b.length >= 3);
  if (brands.some((b) => text.includes(b))) return "navigational";
  if (LOCAL.some((p) => text.includes(p))) return "local";
  if (hasWord(text, TRANSACTIONAL)) return "transactional";
  if (hasWord(text, COMMERCIAL)) return "commercial";
  if (hasWord(text, INFORMATIONAL)) return "informational";
  return "informational";
}

const STOP = new Set([
  "a",
  "an",
  "the",
  "of",
  "for",
  "to",
  "in",
  "on",
  "and",
  "or",
  "with",
  "near",
  "me",
  "my",
  "is",
  "are",
  "do",
  "does",
  "how",
  "what",
  "best",
  "top",
  "vs",
  "your",
  "i",
  "can",
  "by",
]);

/** Words of a phrase without filler, with a simple plural cut so "shoe" and "shoes" match. */
export function significantWords(phrase: string): string[] {
  return norm(phrase)
    .split(" ")
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

export type KeywordCluster = { name: string; phrases: string[] };

/**
 * Groups phrases that are about the same thing: two phrases join when they share at least two
 * significant words, or the only significant word of the shorter one. A cluster is named after
 * its most common words. Biggest clusters first.
 */
export function clusterKeywords(phrases: readonly string[]): KeywordCluster[] {
  const unique = [...new Set(phrases)];
  const words = unique.map((p) => new Set(significantWords(p)));
  const parent = unique.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      const a = words[i]!;
      const b = words[j]!;
      if (a.size === 0 || b.size === 0) continue;
      let shared = 0;
      for (const w of a) if (b.has(w)) shared++;
      const smaller = Math.min(a.size, b.size);
      if (shared >= 2 || (shared >= 1 && smaller === 1)) parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, number[]>();
  unique.forEach((_, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), i]));
  const out: KeywordCluster[] = [];
  for (const members of groups.values()) {
    const counts = new Map<string, number>();
    for (const i of members) for (const w of words[i]!) counts.set(w, (counts.get(w) ?? 0) + 1);
    const top = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 2)
      .map(([w]) => w)
      .sort();
    out.push({
      name: top.length > 0 ? top.join(" ") : unique[members[0]!]!,
      phrases: members.map((i) => unique[i]!).sort(),
    });
  }
  return out.sort((a, b) => b.phrases.length - a.phrases.length || a.name.localeCompare(b.name));
}

/** Share of searchers who click a result at this position (a common rough curve). */
export function clickShare(position: number): number {
  if (position <= 1) return 0.3;
  if (position === 2) return 0.15;
  if (position === 3) return 0.1;
  if (position === 4) return 0.07;
  if (position === 5) return 0.05;
  if (position <= 10) return 0.03 - (position - 6) * 0.003;
  if (position <= 20) return 0.008;
  return 0.002;
}

/**
 * 0 to 100: how much extra traffic moving to position 3 could bring, made smaller for hard
 * keywords. Null when the position or the search volume is not known, or the page is in the
 * top 3 already (nothing to gain).
 */
export function opportunityScore(input: {
  position: number | null;
  volume: number | null;
  difficulty: number | null;
}): number | null {
  const { position, volume } = input;
  if (position === null || volume === null || position <= 3 || volume <= 0) return null;
  const extra = volume * (clickShare(3) - clickShare(position));
  const reach = 1 - Math.min(100, Math.max(0, input.difficulty ?? 50)) / 150;
  const score = (100 * Math.log10(1 + extra * reach)) / Math.log10(1 + 3000);
  return Math.max(0, Math.min(100, Math.round(score)));
}

export type CannibalRow = {
  phrase: string;
  position: number | null;
  currentUrl: string | null;
  /** Ranking addresses from the last checks, oldest first (null when not ranking). */
  urlHistory: readonly (string | null)[];
};

export type CannibalFinding =
  | { kind: "flip"; phrase: string; urls: string[]; changes: number }
  | { kind: "competing"; cluster: string; pages: { url: string; phrases: string[] }[] };

/**
 * Pages that compete with each other. "flip": the page Google shows for one phrase keeps changing
 * between two or more of your pages. "competing": phrases about the same thing rank with different
 * pages (both in the top 30).
 */
export function findCannibalization(rows: readonly CannibalRow[]): CannibalFinding[] {
  const out: CannibalFinding[] = [];
  for (const row of rows) {
    const seen = row.urlHistory.filter((u): u is string => u !== null);
    const urls = [...new Set(seen)];
    let changes = 0;
    for (let i = 1; i < seen.length; i++) if (seen[i] !== seen[i - 1]) changes++;
    if (urls.length >= 2 && changes >= 2) {
      out.push({ kind: "flip", phrase: row.phrase, urls: urls.sort(), changes });
    }
  }
  const byPhrase = new Map(rows.map((r) => [r.phrase, r]));
  for (const cluster of clusterKeywords(rows.map((r) => r.phrase))) {
    const pages = new Map<string, string[]>();
    for (const phrase of cluster.phrases) {
      const r = byPhrase.get(phrase)!;
      if (r.currentUrl && r.position !== null && r.position <= 30) {
        pages.set(r.currentUrl, [...(pages.get(r.currentUrl) ?? []), phrase]);
      }
    }
    if (pages.size >= 2) {
      out.push({
        kind: "competing",
        cluster: cluster.name,
        pages: [...pages.entries()]
          .map(([url, phrases]) => ({ url, phrases: phrases.sort() }))
          .sort((a, b) => b.phrases.length - a.phrases.length || a.url.localeCompare(b.url)),
      });
    }
  }
  return out.sort((a, b) =>
    a.kind === b.kind
      ? (a.kind === "flip" ? a.phrase : a.cluster).localeCompare(
          b.kind === "flip" ? b.phrase : b.cluster,
        )
      : a.kind === "flip"
        ? -1
        : 1,
  );
}

export type PageMapRow = {
  url: string;
  keywords: number;
  averagePosition: number | null;
  /** Keywords aimed at this page that rank with another page. */
  mismatched: number;
};

/** Which keywords are aimed at which page, and where Google shows another page instead. */
export function buildPageMap(
  rows: readonly {
    targetUrl: string | null;
    currentUrl: string | null;
    position: number | null;
  }[],
): { pages: PageMapRow[]; unmapped: number } {
  const map = new Map<string, { n: number; positions: number[]; mismatched: number }>();
  let unmapped = 0;
  for (const r of rows) {
    if (!r.targetUrl) {
      unmapped++;
      continue;
    }
    const e = map.get(r.targetUrl) ?? { n: 0, positions: [], mismatched: 0 };
    e.n++;
    if (r.position !== null) e.positions.push(r.position);
    if (r.currentUrl && r.currentUrl !== r.targetUrl) e.mismatched++;
    map.set(r.targetUrl, e);
  }
  const pages = [...map.entries()]
    .map(([url, e]) => ({
      url,
      keywords: e.n,
      averagePosition:
        e.positions.length === 0
          ? null
          : Math.round((e.positions.reduce((a, b) => a + b, 0) / e.positions.length) * 10) / 10,
      mismatched: e.mismatched,
    }))
    .sort((a, b) => b.keywords - a.keywords || a.url.localeCompare(b.url));
  return { pages, unmapped };
}

export type ChangeReason = {
  text: string;
  evidence: string;
  confidence: "high" | "medium" | "low";
};

/**
 * Likely reasons for a big move of one keyword, each with the evidence. These are leads to check,
 * not proof. With no lead the answer says so.
 */
export function explainRankChange(input: {
  from: number | null;
  to: number | null;
  urlBefore: string | null;
  urlAfter: string | null;
  featuresBefore: readonly string[];
  featuresAfter: readonly string[];
  /** Timeline notes near the date of the change. */
  notes: readonly { on: string; kind: string; title: string }[];
  /** How many of the project's keywords moved up, down, and how many were checked. */
  siteWide: { up: number; down: number; total: number };
  criticalIssueOnPage: boolean;
}): ChangeReason[] {
  const dropped = (input.to ?? 101) > (input.from ?? 101);
  const out: ChangeReason[] = [];
  if (input.urlBefore && input.urlAfter && input.urlBefore !== input.urlAfter) {
    out.push({
      text: "Google now shows a different page of your site",
      evidence: `It was ${input.urlBefore} and is now ${input.urlAfter}.`,
      confidence: "high",
    });
  }
  const added = input.featuresAfter.filter((f) => !input.featuresBefore.includes(f));
  if (added.length > 0 && dropped) {
    out.push({
      text: "New elements appeared above the results",
      evidence: `Added: ${added.join(", ")}.`,
      confidence: "medium",
    });
  }
  for (const n of input.notes) {
    out.push({
      text:
        n.kind === "ALGORITHM"
          ? "A Google update happened around then"
          : "A change was noted around then",
      evidence: `${n.on}: ${n.title}`,
      confidence: n.kind === "ALGORITHM" ? "medium" : "low",
    });
  }
  const { up, down, total } = input.siteWide;
  const same = dropped ? down : up;
  if (total >= 5 && same / total >= 0.6) {
    out.push({
      text: "Most of your keywords moved the same way",
      evidence: `${same} of ${total} keywords moved ${dropped ? "down" : "up"}. That points to a site-wide cause, such as an update or a technical change.`,
      confidence: "medium",
    });
  }
  if (dropped && input.criticalIssueOnPage) {
    out.push({
      text: "The page has a critical problem in the latest audit",
      evidence: "Open the latest audit and check this page first.",
      confidence: "medium",
    });
  }
  if (out.length === 0) {
    out.push({
      text: "No clear cause found",
      evidence: "Nothing in your data explains the move. Competitors may have changed their pages.",
      confidence: "low",
    });
  }
  const order = { high: 0, medium: 1, low: 2 } as const;
  return out.sort((a, b) => order[a.confidence] - order[b.confidence]);
}
