import type { AiEngine } from "@/server/providers/seo/types";

export const AI_ENGINES: readonly { key: AiEngine; label: string }[] = [
  { key: "chatgpt", label: "ChatGPT" },
  { key: "gemini", label: "Gemini" },
  { key: "perplexity", label: "Perplexity" },
  { key: "claude", label: "Claude" },
  { key: "google_ai_overview", label: "Google AI Overview" },
];

/** Used until the agency picks engines. Every extra engine multiplies the checks a month. */
export const DEFAULT_ENGINES: readonly AiEngine[] = ["chatgpt", "gemini", "perplexity"];

/** Most prompts one project can have. */
export const MAX_AI_PROMPTS = 20;

/** Sorts [engine, value] pairs in the fixed order of the engine list, so screens and reports never shuffle. */
export function sortByEngine<T>(entries: [string, T][]): [string, T][] {
  const order = (key: string) => {
    const i = AI_ENGINES.findIndex((e) => e.key === key);
    return i === -1 ? AI_ENGINES.length : i;
  };
  return [...entries].sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]));
}

export const engineLabel = (key: string) => AI_ENGINES.find((e) => e.key === key)?.label ?? key;
export const isEngine = (key: string): key is AiEngine => AI_ENGINES.some((e) => e.key === key);

const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

/**
 * Which competitors an AI answer names or links to. A competitor counts when its site is one of
 * the cited links, or when the first part of its domain (4 or more letters, ignoring spaces and
 * dashes) appears in the answer text. Returns the competitor domains.
 */
export function competitorsMentioned(
  answer: { answerSnippet: string; citedUrls: readonly string[] },
  competitorDomains: readonly string[],
): string[] {
  const text = squash(answer.answerSnippet);
  const hosts = new Set(answer.citedUrls.map(hostOf));
  return competitorDomains.filter((domain) => {
    if (hosts.has(domain)) return true;
    const name = squash(domain.split(".")[0] ?? "");
    return name.length >= 4 && text.includes(name);
  });
}

export type CheckFacts = {
  engine: string;
  brandMentioned: boolean;
  domainCited: boolean;
  mentionPosition: number | null;
  competitorsMentioned: readonly string[];
};

export type RunSummary = {
  total: number;
  mentioned: number;
  /** Whole percent of checks that name the brand. */
  mentionRate: number;
  cited: number;
  citedRate: number;
  /** Average place of the brand when it is named. Null when it never is. */
  averagePosition: number | null;
  /** The brand's share of all brand and competitor mentions, in whole percent. Null without any mention. */
  shareOfVoice: number | null;
  competitorMentions: Record<string, number>;
  byEngine: Record<string, { total: number; mentioned: number; mentionRate: number }>;
};

const percent = (part: number, whole: number) =>
  whole === 0 ? 0 : Math.round((part / whole) * 100);

export function summarizeChecks(checks: readonly CheckFacts[]): RunSummary {
  const competitorMentions: Record<string, number> = {};
  const byEngine: RunSummary["byEngine"] = {};
  let mentioned = 0;
  let cited = 0;
  let positionSum = 0;
  let positioned = 0;
  for (const c of checks) {
    if (c.brandMentioned) mentioned++;
    if (c.domainCited) cited++;
    if (c.brandMentioned && c.mentionPosition !== null) {
      positionSum += c.mentionPosition;
      positioned++;
    }
    for (const domain of c.competitorsMentioned) {
      competitorMentions[domain] = (competitorMentions[domain] ?? 0) + 1;
    }
    const e = (byEngine[c.engine] ??= { total: 0, mentioned: 0, mentionRate: 0 });
    e.total++;
    if (c.brandMentioned) e.mentioned++;
  }
  for (const e of Object.values(byEngine)) e.mentionRate = percent(e.mentioned, e.total);
  const rivalTotal = Object.values(competitorMentions).reduce((a, b) => a + b, 0);
  return {
    total: checks.length,
    mentioned,
    mentionRate: percent(mentioned, checks.length),
    cited,
    citedRate: percent(cited, checks.length),
    averagePosition: positioned === 0 ? null : Math.round((positionSum / positioned) * 10) / 10,
    shareOfVoice: mentioned + rivalTotal === 0 ? null : percent(mentioned, mentioned + rivalTotal),
    competitorMentions,
    byEngine,
  };
}

export type KeyedMention = { promptId: string; engine: string; brandMentioned: boolean };

/** Prompt and engine pairs where the brand was named last time and is not named now. */
export function lostMentions(
  previous: readonly KeyedMention[],
  current: readonly KeyedMention[],
): { promptId: string; engine: string }[] {
  const before = new Set(
    previous.filter((p) => p.brandMentioned).map((p) => `${p.promptId}|${p.engine}`),
  );
  return current
    .filter((c) => !c.brandMentioned && before.has(`${c.promptId}|${c.engine}`))
    .map((c) => ({ promptId: c.promptId, engine: c.engine }));
}
