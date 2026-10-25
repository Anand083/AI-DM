import { engineLabel } from "./ai-visibility";

/** The facts of one saved AI answer that the analysis needs. */
export type CheckRow = {
  promptId: string;
  engine: string;
  /** UTC day, YYYY-MM-DD. */
  checkedOn: string;
  brandMentioned: boolean;
  domainCited: boolean;
  mentionPosition: number | null;
  sentiment: string | null;
  citedUrls: readonly string[];
  /** Competitor domains the answer names or links to. */
  competitorsMentioned: readonly string[];
};

export const METHOD_NOTE =
  "AI visibility is an estimate. We ask each question once a week and read the answer. AI answers change from one ask to the next, so small moves are noise. A few questions give a rough picture, not a ranking.";

export const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

const isOwn = (host: string, own: string) => host === own || host.endsWith(`.${own}`);

export type CitationRow = {
  domain: string;
  count: number;
  /** Share of all citations, in whole percent. */
  share: number;
  kind: "you" | "competitor" | "other";
};

/** Which websites AI answers link to, most cited first (top 10). */
export function citationDomains(
  checks: readonly CheckRow[],
  ownDomain: string,
  rivalDomains: readonly string[],
): CitationRow[] {
  const own = ownDomain.toLowerCase().replace(/^www\./, "");
  const rivals = new Set(rivalDomains.map((d) => d.toLowerCase().replace(/^www\./, "")));
  const counts = new Map<string, number>();
  let total = 0;
  for (const c of checks) {
    for (const url of c.citedUrls) {
      const host = hostOf(url);
      if (!host) continue;
      counts.set(host, (counts.get(host) ?? 0) + 1);
      total++;
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([domain, count]) => ({
      domain,
      count,
      share: Math.round((count / total) * 100),
      kind: isOwn(domain, own) ? "you" : rivals.has(domain) ? "competitor" : "other",
    }));
}

export type CompetitorRow = { domain: string; answers: number; rate: number };

/** How many answers name the brand and each competitor, out of all answers in the run. */
export function competitorComparison(
  checks: readonly CheckRow[],
  rivalDomains: readonly string[],
): { total: number; brand: { answers: number; rate: number }; rivals: CompetitorRow[] } {
  const total = checks.length;
  const rate = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 100));
  const brandAnswers = checks.filter((c) => c.brandMentioned).length;
  const rivals = rivalDomains
    .map((domain) => {
      const answers = checks.filter((c) => c.competitorsMentioned.includes(domain)).length;
      return { domain, answers, rate: rate(answers) };
    })
    .sort((a, b) => b.answers - a.answers || a.domain.localeCompare(b.domain));
  return { total, brand: { answers: brandAnswers, rate: rate(brandAnswers) }, rivals };
}

export type TrendPoint = { date: string; rate: number; total: number };
export type Trend = {
  key: string;
  points: TrendPoint[];
  /** Latest rate minus the first rate, in percentage points. Null with fewer than 2 runs. */
  change: number | null;
};

/** Mention rate by run day for each key (an engine or a prompt). Runs are oldest first. */
export function trendBy(checks: readonly CheckRow[], keyOf: (c: CheckRow) => string): Trend[] {
  const groups = new Map<string, Map<string, { total: number; mentioned: number }>>();
  for (const c of checks) {
    const key = keyOf(c);
    const days = groups.get(key) ?? new Map();
    const day = days.get(c.checkedOn) ?? { total: 0, mentioned: 0 };
    day.total++;
    if (c.brandMentioned) day.mentioned++;
    days.set(c.checkedOn, day);
    groups.set(key, days);
  }
  return [...groups.entries()]
    .map(([key, days]) => {
      const points = [...days.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, v]) => ({
          date,
          total: v.total,
          rate: Math.round((v.mentioned / v.total) * 100),
        }));
      return {
        key,
        points,
        change: points.length < 2 ? null : points[points.length - 1]!.rate - points[0]!.rate,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

export const STALE_AFTER_DAYS = 14;

export type Coverage = {
  expected: number;
  actual: number;
  /** Share of the expected answers we have, in whole percent. */
  percent: number;
  ageDays: number | null;
  stale: boolean;
  sample: boolean;
  label: string;
};

const dayNumber = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86_400_000);

/** How complete and how fresh the latest run is, and whether it is sample data. */
export function describeCoverage(input: {
  prompts: number;
  engines: number;
  latestOn: string | null;
  latestCount: number;
  today: string;
  sample: boolean;
}): Coverage {
  const expected = input.prompts * input.engines;
  const ageDays = input.latestOn ? dayNumber(input.today) - dayNumber(input.latestOn) : null;
  const percent =
    expected === 0 ? 0 : Math.min(100, Math.round((input.latestCount / expected) * 100));
  const stale = ageDays === null || ageDays > STALE_AFTER_DAYS;
  const parts: string[] = [];
  if (input.latestOn === null) parts.push("No check yet");
  else {
    parts.push(`${input.latestCount} of ${expected} answers`);
    parts.push(
      ageDays === 0 ? "checked today" : `checked ${ageDays} ${ageDays === 1 ? "day" : "days"} ago`,
    );
    if (stale) parts.push("out of date");
  }
  parts.push(input.sample ? "sample data" : "real data");
  return {
    expected,
    actual: input.latestCount,
    percent,
    ageDays,
    stale,
    sample: input.sample,
    label: parts.join(", "),
  };
}

export type Recommendation = {
  id: string;
  title: string;
  /** The numbers behind the advice. */
  evidence: string;
  action: string;
  confidence: "high" | "medium" | "low";
};

const confidenceFor = (n: number): Recommendation["confidence"] =>
  n >= 10 ? "high" : n >= 4 ? "medium" : "low";
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Advice that comes from the saved answers. Every item shows the numbers it is based on and how
 * sure we are (fewer answers means lower confidence). Nothing here changes anything by itself.
 */
export function buildRecommendations(input: {
  latest: readonly CheckRow[];
  promptText: ReadonlyMap<string, string>;
  rivals: CompetitorRow[];
  brandAnswers: number;
  topics: readonly { topic: string; aiSearchVolume: number; changePercent: number }[];
}): Recommendation[] {
  const out: Recommendation[] = [];
  const { latest } = input;
  if (latest.length === 0) return out;

  // 1. Questions where the brand is never named.
  const byPrompt = new Map<string, CheckRow[]>();
  for (const c of latest) byPrompt.set(c.promptId, [...(byPrompt.get(c.promptId) ?? []), c]);
  for (const [promptId, rows] of byPrompt) {
    if (rows.length >= 2 && rows.every((r) => !r.brandMentioned)) {
      const text = input.promptText.get(promptId) ?? "this question";
      out.push({
        id: `prompt-gap:${promptId}`,
        title: `Get named for "${text}"`,
        evidence: `The brand was not named in any of ${plural(rows.length, "answer", "answers")} to this question.`,
        action:
          "Publish or improve a page that answers this question clearly, with facts, prices and a short summary near the top.",
        confidence: confidenceFor(rows.length * 2),
      });
    }
  }

  // 2. A competitor named more often than the brand.
  const lead = input.rivals.find((r) => r.answers >= 3 && r.answers > input.brandAnswers);
  if (lead) {
    out.push({
      id: `competitor-ahead:${lead.domain}`,
      title: `${lead.domain} is named more often than you`,
      evidence: `${lead.domain} appears in ${lead.answers} of ${latest.length} answers, the brand in ${input.brandAnswers}.`,
      action: `Look at the pages AI links to for ${lead.domain} and cover the same questions better.`,
      confidence: confidenceFor(latest.length),
    });
  }

  // 3. One engine far behind the others.
  const engines = new Map<string, { total: number; mentioned: number }>();
  for (const c of latest) {
    const e = engines.get(c.engine) ?? { total: 0, mentioned: 0 };
    e.total++;
    if (c.brandMentioned) e.mentioned++;
    engines.set(c.engine, e);
  }
  const rated = [...engines.entries()].map(([engine, v]) => ({
    engine,
    total: v.total,
    rate: Math.round((v.mentioned / v.total) * 100),
  }));
  if (rated.length >= 2) {
    const best = rated.reduce((a, b) => (b.rate > a.rate ? b : a));
    const worst = rated.reduce((a, b) => (b.rate < a.rate ? b : a));
    if (best.rate >= 50 && worst.rate <= best.rate / 2) {
      out.push({
        id: `engine-gap:${worst.engine}`,
        title: `Weak on ${engineLabel(worst.engine)}`,
        evidence: `Named in ${worst.rate}% of ${engineLabel(worst.engine)} answers against ${best.rate}% on ${engineLabel(best.engine)}.`,
        action: `Check which sources ${engineLabel(worst.engine)} trusts for this topic and get listed or mentioned there.`,
        confidence: confidenceFor(Math.min(worst.total, best.total)),
      });
    }
  }

  // 4. Named but not linked.
  const mentioned = latest.filter((c) => c.brandMentioned);
  const cited = mentioned.filter((c) => c.domainCited).length;
  if (mentioned.length >= 3 && cited / mentioned.length < 0.4) {
    out.push({
      id: "mentioned-not-cited",
      title: "Named, but the site is rarely linked",
      evidence: `The brand is named in ${mentioned.length} answers but the site is linked in only ${cited}.`,
      action:
        "Make the key pages easy to cite: a clear title, one main fact per page, and a short summary that answers the question.",
      confidence: confidenceFor(mentioned.length),
    });
  }

  // 5. Negative wording.
  const negative = mentioned.filter((c) => c.sentiment === "negative").length;
  if (negative >= 2) {
    out.push({
      id: "negative-sentiment",
      title: "Some answers describe the brand badly",
      evidence: `${plural(negative, "answer", "answers")} out of ${mentioned.length} that name the brand sound negative.`,
      action: "Read these answers on the Answers list and fix the facts or reviews they rely on.",
      confidence: confidenceFor(mentioned.length),
    });
  }

  // 6. A rising topic. This number is the vendor's estimate, so confidence stays low.
  const hot = [...input.topics]
    .filter((t) => t.changePercent >= 25 && t.aiSearchVolume >= 500)
    .sort((a, b) => b.aiSearchVolume - a.aiSearchVolume || a.topic.localeCompare(b.topic))[0];
  if (hot) {
    out.push({
      id: `rising-topic:${hot.topic}`,
      title: `Cover the rising topic "${hot.topic}"`,
      evidence: `About ${hot.aiSearchVolume.toLocaleString("en-US")} AI searches a month, up ${hot.changePercent}% in 3 months (a vendor estimate).`,
      action:
        "Add a question about this topic to your tracked questions and publish a page for it.",
      confidence: "low",
    });
  }

  const order = { high: 0, medium: 1, low: 2 } as const;
  return out.sort((a, b) => order[a.confidence] - order[b.confidence] || a.id.localeCompare(b.id));
}
