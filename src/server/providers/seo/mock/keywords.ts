import type { KeywordIdea, KeywordIntent } from "../types";
import { makeRng } from "./prng";

type Modifier = { text: string; position: "before" | "after"; intent: KeywordIntent };

function modifiers(year: number): Modifier[] {
  return [
    { text: "best", position: "before", intent: "commercial" },
    { text: "near me", position: "after", intent: "local" },
    { text: "price", position: "after", intent: "transactional" },
    { text: "how to", position: "before", intent: "informational" },
    { text: "vs", position: "after", intent: "commercial" },
    { text: "for beginners", position: "after", intent: "informational" },
    { text: "review", position: "after", intent: "commercial" },
    { text: "cheap", position: "before", intent: "transactional" },
    { text: String(year), position: "after", intent: "informational" },
    { text: "services", position: "after", intent: "commercial" },
    { text: "cost", position: "after", intent: "transactional" },
    { text: "guide", position: "after", intent: "informational" },
    { text: "tips", position: "after", intent: "informational" },
    { text: "online", position: "after", intent: "transactional" },
    { text: "free", position: "before", intent: "transactional" },
    { text: "top", position: "before", intent: "commercial" },
    { text: "alternatives", position: "after", intent: "commercial" },
    { text: "checklist", position: "after", intent: "informational" },
  ];
}

function buildIdea(
  keyword: string,
  intent: KeywordIntent,
  locationCode: number,
  languageCode: string,
  day: number,
): KeywordIdea {
  // Volume, price and difficulty are fixed for a keyword; only a small daily wobble changes.
  const base = makeRng(keyword, locationCode, languageCode, "idea");
  const volumeBase = Math.min(100_000, Math.max(10, Math.round(Math.exp(base.normal(6.2, 1.6)))));
  const wobble = 1 + (makeRng(keyword, locationCode, "wobble", day).next() - 0.5) * 0.06;
  const volume = Math.min(100_000, Math.max(10, Math.round(volumeBase * wobble)));
  const cpcMicros = Math.round(100_000 + base.next() ** 2 * 14_900_000);
  const difficulty = base.int(0, 100);

  const season = base.next() * Math.PI * 2;
  const amplitude = 0.1 + base.next() * 0.3;
  const trend = Array.from({ length: 12 }, (_, month) => {
    const factor =
      1 + amplitude * Math.sin(season + (month / 12) * Math.PI * 2) + (base.next() - 0.5) * 0.1;
    return Math.max(10, Math.round(volume * factor));
  });
  return { keyword, volume, cpcMicros, difficulty, intent, trend };
}

export function buildKeywordIdeas(
  seed: string,
  locationCode: number,
  languageCode: string,
  limit: number,
  now: Date,
): KeywordIdea[] {
  const clean = seed.trim().toLowerCase().replace(/\s+/g, " ");
  const day = Math.floor(now.getTime() / 86_400_000);
  const year = now.getUTCFullYear();

  const candidates: { keyword: string; intent: KeywordIntent }[] = [
    { keyword: clean, intent: "commercial" },
  ];
  for (const m of modifiers(year)) {
    candidates.push({
      keyword: m.position === "before" ? `${m.text} ${clean}` : `${clean} ${m.text}`,
      intent: m.intent,
    });
  }
  // Mix the order a little so different seeds do not look identical, but keep the seed first.
  const rng = makeRng(clean, "order");
  const rest = candidates.slice(1);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  return [candidates[0]!, ...rest]
    .slice(0, Math.max(0, limit))
    .map((c) => buildIdea(c.keyword, c.intent, locationCode, languageCode, day));
}
