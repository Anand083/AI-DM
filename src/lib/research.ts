import type { KeywordIdea, KeywordIntent } from "@/server/providers/seo/types";

export const INTENTS: readonly KeywordIntent[] = [
  "informational",
  "commercial",
  "transactional",
  "navigational",
  "local",
];

export const INTENT_LABEL: Record<KeywordIntent, string> = {
  informational: "Learn",
  commercial: "Compare",
  transactional: "Buy",
  navigational: "Find a site",
  local: "Near me",
};

export const IDEA_SORTS = ["volume", "difficulty", "cpc", "keyword"] as const;
export type IdeaSort = (typeof IDEA_SORTS)[number];

export type IdeaFilter = {
  intent?: KeywordIntent;
  minVolume?: number;
  maxDifficulty?: number;
  sort?: IdeaSort;
  dir?: "asc" | "desc";
};

/** Filters and sorts research results. Volume sorts high to low by default. */
export function filterIdeas(ideas: KeywordIdea[], filter: IdeaFilter): KeywordIdea[] {
  const sort = filter.sort ?? "volume";
  const descDefault = sort === "volume" || sort === "cpc";
  const dir = filter.dir ?? (descDefault ? "desc" : "asc");
  const value = (i: KeywordIdea): number | string =>
    sort === "volume"
      ? i.volume
      : sort === "difficulty"
        ? i.difficulty
        : sort === "cpc"
          ? i.cpcMicros
          : i.keyword;

  return ideas
    .filter((i) => !filter.intent || i.intent === filter.intent)
    .filter((i) => filter.minVolume === undefined || i.volume >= filter.minVolume)
    .filter((i) => filter.maxDifficulty === undefined || i.difficulty <= filter.maxDifficulty)
    .sort((a, b) => {
      const x = value(a);
      const y = value(b);
      const cmp =
        typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number);
      return (dir === "asc" ? cmp : -cmp) || a.keyword.localeCompare(b.keyword);
    });
}

/** Cost per click in micro-dollars as "$1.25". */
export function formatCpc(cpcMicros: number): string {
  return `$${(cpcMicros / 1_000_000).toFixed(2)}`;
}

/** How hard a keyword is, in words. */
export function difficultyLabel(difficulty: number): "Easy" | "Medium" | "Hard" {
  return difficulty < 34 ? "Easy" : difficulty < 67 ? "Medium" : "Hard";
}

/** SVG points ("x,y x,y ...") for a small line chart of the 12 month trend. */
export function sparklinePoints(values: number[], width = 80, height = 24): string {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  return values
    .map(
      (v, i) =>
        `${(i * step).toFixed(1)},${(height - ((v - min) / range) * (height - 2) - 1).toFixed(1)}`,
    )
    .join(" ");
}
