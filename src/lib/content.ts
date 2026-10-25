const DAY_MS = 86_400_000;
const dayNum = (d: string) => Math.floor(Date.parse(`${d.slice(0, 10)}T00:00:00Z`) / DAY_MS);

export type Freshness = "fresh" | "aging" | "stale" | "unknown";

export const FRESHNESS_LABELS: Record<Freshness, string> = {
  fresh: "Updated in the last 6 months",
  aging: "Updated 6 to 12 months ago",
  stale: "Not updated for over a year",
  unknown: "Update date unknown",
};

/** How old a page is, from its last update day. */
export function freshness(lastModified: string | null, today: string): Freshness {
  if (!lastModified) return "unknown";
  const age = dayNum(today) - dayNum(lastModified);
  if (age < 0) return "fresh";
  return age <= 183 ? "fresh" : age <= 365 ? "aging" : "stale";
}

export type PageTraffic = {
  clicks: number;
  impressions: number;
  /** Same two numbers for the 28 days before. Null when the page was not in that list. */
  clicksBefore: number | null;
  impressionsBefore: number | null;
};

export const DECAY_MIN_CLICKS_BEFORE = 30;
export const DECAY_MIN_PERCENT = 30;

/**
 * A page is losing traffic when its clicks fell by at least 30% against the 28 days before and it
 * had at least 30 clicks then (small numbers jump around by chance). A page that dropped out of
 * the list altogether counts as having no clicks now.
 */
export function detectDecay(t: PageTraffic): { percent: number; lost: number } | null {
  if (t.clicksBefore === null || t.clicksBefore < DECAY_MIN_CLICKS_BEFORE) return null;
  if (t.clicks >= t.clicksBefore) return null;
  const percent = Math.round(((t.clicksBefore - t.clicks) / t.clicksBefore) * 100);
  return percent >= DECAY_MIN_PERCENT ? { percent, lost: t.clicksBefore - t.clicks } : null;
}

export type ContentFlag = "decaying" | "stale" | "thin" | "duplicate";

export const FLAG_LABELS: Record<ContentFlag, string> = {
  decaying: "Losing traffic",
  stale: "Out of date",
  thin: "Thin content",
  duplicate: "Duplicate content",
};

/** The reasons a page needs attention, in the order people should look at them. */
export function contentFlags(input: {
  traffic: PageTraffic | null;
  freshness: Freshness;
  thin: boolean;
  duplicate: boolean;
}): ContentFlag[] {
  const flags: ContentFlag[] = [];
  if (input.traffic && detectDecay(input.traffic)) flags.push("decaying");
  if (input.freshness === "stale") flags.push("stale");
  if (input.thin) flags.push("thin");
  if (input.duplicate) flags.push("duplicate");
  return flags;
}

export type LinkPage = {
  url: string;
  title: string | null;
  /** Internal links pointing to this page. */
  inlinks: number | null;
  /** Tracked keywords this page ranks for or is aimed at. */
  keywords: readonly string[];
  /** Keywords outside the top 3 but on a page that could grow (position 4 to 20). */
  growing: boolean;
};

export type LinkSuggestion = {
  target: string;
  inlinks: number;
  /** Pages to put a link on, strongest first. */
  from: { url: string; title: string | null }[];
  keyword: string;
};

const STOP = new Set(["the", "and", "for", "with", "your", "from", "near", "best", "how", "what"]);
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));

/**
 * Pages that could grow but get few internal links, with the pages that are best placed to link
 * to them: pages on the same topic (their title shares a word with the target's keyword) that
 * already get more links themselves. A target needs at most 2 internal links to be suggested.
 */
export function suggestInternalLinks(pages: readonly LinkPage[], limit = 15): LinkSuggestion[] {
  const known = pages.filter((p) => p.inlinks !== null);
  const out: LinkSuggestion[] = [];
  for (const target of known) {
    if (!target.growing || target.keywords.length === 0 || (target.inlinks ?? 0) > 2) continue;
    const keyword = target.keywords[0]!;
    const topic = new Set(words(keyword));
    const from = known
      .filter((p) => p.url !== target.url && (p.inlinks ?? 0) > (target.inlinks ?? 0) + 1)
      .map((p) => ({
        p,
        shared: words(p.title ?? "").filter((w) => topic.has(w)).length,
      }))
      .filter((x) => x.shared > 0)
      .sort(
        (a, b) =>
          b.shared - a.shared ||
          (b.p.inlinks ?? 0) - (a.p.inlinks ?? 0) ||
          a.p.url.localeCompare(b.p.url),
      )
      .slice(0, 3)
      .map((x) => ({ url: x.p.url, title: x.p.title }));
    if (from.length > 0)
      out.push({ target: target.url, inlinks: target.inlinks ?? 0, from, keyword });
  }
  return out
    .sort((a, b) => a.inlinks - b.inlinks || a.target.localeCompare(b.target))
    .slice(0, limit);
}

export const COMPARE_MIN_DAYS = 14;
export const COMPARE_FULL_DAYS = 28;

export type Baseline = { clicks: number; impressions: number; positionTenths: number | null };
export type Current = { clicks: number; impressions: number; positionTenths: number | null };

export type BeforeAfter =
  | { ready: false; daysSince: number; daysLeft: number }
  | {
      ready: true;
      daysSince: number;
      /** True when fewer than 28 days have passed, so the "after" window is not complete yet. */
      partial: boolean;
      clicksChange: number | null;
      impressionsChange: number | null;
      /** Positive means the average position got better (lower number). */
      positionChangeTenths: number | null;
      verdict: "better" | "worse" | "same";
    };

const pct = (now: number, before: number) =>
  before === 0 ? null : Math.round(((now - before) / before) * 100);

/**
 * Compares a page's 28 days before an update with its latest 28 days. Nothing is said before 14
 * days have passed, because Google needs time to react. Between 14 and 28 days the answer is
 * marked partial.
 */
export function compareBeforeAfter(
  baseline: Baseline,
  current: Current | null,
  updatedOn: string,
  today: string,
): BeforeAfter {
  const daysSince = dayNum(today) - dayNum(updatedOn);
  if (daysSince < COMPARE_MIN_DAYS) {
    return {
      ready: false,
      daysSince: Math.max(0, daysSince),
      daysLeft: COMPARE_MIN_DAYS - Math.max(0, daysSince),
    };
  }
  const now = current ?? { clicks: 0, impressions: 0, positionTenths: null };
  const clicksChange = pct(now.clicks, baseline.clicks);
  const impressionsChange = pct(now.impressions, baseline.impressions);
  const positionChangeTenths =
    baseline.positionTenths !== null && now.positionTenths !== null
      ? baseline.positionTenths - now.positionTenths
      : null;
  const verdict =
    clicksChange === null
      ? now.clicks > 0
        ? "better"
        : "same"
      : clicksChange >= 10
        ? "better"
        : clicksChange <= -10
          ? "worse"
          : "same";
  return {
    ready: true,
    daysSince,
    partial: daysSince < COMPARE_FULL_DAYS,
    clicksChange,
    impressionsChange,
    positionChangeTenths,
    verdict,
  };
}
