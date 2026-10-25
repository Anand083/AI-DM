import type {
  AiEngine,
  BingRank,
  KeywordMetric,
  AiTopic,
  AiVisibilityResult,
  LlmMentionsSummary,
  ReviewSummary,
} from "../types";
import { makeRng } from "./prng";

export function buildAiVisibility(input: {
  prompt: string;
  brand: string;
  domain: string;
  engine: AiEngine;
  day: number;
}): AiVisibilityResult {
  const rng = makeRng(input.prompt, input.brand, input.engine, input.day, "ai");
  const brandMentioned = rng.chance(0.45);
  const domainCited = brandMentioned ? rng.chance(0.6) : rng.chance(0.08);
  const sentiment = brandMentioned
    ? rng.pick(["positive", "positive", "neutral", "negative"] as const)
    : null;
  const others = ["Northwind", "Contoso", "Fabrikam", "Acme Co"];
  const snippet = brandMentioned
    ? `For "${input.prompt}", popular options include ${rng.pick(others)}, ${input.brand} and ${rng.pick(others)}. ${input.brand} is often praised for its service.`
    : `For "${input.prompt}", popular options include ${rng.pick(others)}, ${rng.pick(others)} and ${rng.pick(others)}.`;
  return {
    engine: input.engine,
    prompt: input.prompt,
    brandMentioned,
    domainCited,
    mentionPosition: brandMentioned ? rng.int(1, 5) : null,
    sentiment,
    answerSnippet: snippet,
    citedUrls: domainCited
      ? [`https://${input.domain}/`]
      : [`https://${rng.pick(["wiki-facts", "reviewnation", "thedailyreview"])}.example/`],
  };
}

const WEEK_MS = 7 * 86_400_000;
const REVIEW_COMMENTS = [
  "Friendly staff and quick service.",
  "Good value, would come back.",
  "Took longer than expected, but the result was fine.",
  "Excellent. Highly recommend!",
  "Not what I hoped for.",
  "Clean, professional and on time.",
];
const REVIEW_RATINGS = [5, 5, 5, 4, 4, 3, 2, 1];

/**
 * A business's reviews. Five reviews never change. On top of them, one new review appears every
 * week (the last three weeks are shown), and the average rating moves a little from week to week,
 * so tracking over time has something to show.
 */
export function buildReviews(businessName: string, locationCode: number, now: Date): ReviewSummary {
  const base = makeRng(businessName, locationCode, "reviews");
  const week = Math.floor(now.getTime() / WEEK_MS);
  const stable = Array.from({ length: 5 }, (_, i) => {
    const r = makeRng(businessName, locationCode, "review", i);
    return {
      author: `Customer ${r.int(100, 999)}`,
      rating: r.pick(REVIEW_RATINGS),
      text: r.pick(REVIEW_COMMENTS),
      publishedAt: new Date(now.getTime() - r.int(1, 90) * 86_400_000).toISOString().slice(0, 10),
    };
  });
  const weekly = [0, 1, 2].map((back) => {
    const w = week - back;
    const r = makeRng(businessName, locationCode, "weekly-review", w);
    return {
      author: `Visitor ${r.int(1000, 9999)}`,
      rating: r.pick(REVIEW_RATINGS),
      text: r.pick(REVIEW_COMMENTS),
      publishedAt: new Date(w * WEEK_MS + r.int(0, 6) * 86_400_000).toISOString().slice(0, 10),
    };
  });
  const drift = (makeRng(businessName, locationCode, "rating-week", week).int(-2, 2) / 10) * 0.5;
  const rating = Math.min(5, Math.max(1, Math.round((3.2 + base.next() * 1.7 + drift) * 10) / 10));
  return {
    businessName,
    rating,
    reviewCount: Math.max(5, Math.round(Math.exp(base.normal(4.5, 1.2)))),
    recent: [...weekly, ...stable],
  };
}

const TOPIC_PATTERNS = [
  "best {seed}",
  "{seed} near me",
  "how to choose {seed}",
  "{seed} cost",
  "{seed} reviews",
  "is {seed} worth it",
  "{seed} vs alternatives",
  "top rated {seed}",
  "{seed} for small business",
  "affordable {seed}",
  "{seed} checklist",
  "{seed} tips",
];

/** Pretend AI search demand for topics around a seed. Biggest first. */
export function buildAiTopics(input: { seed: string; limit: number; day: number }): AiTopic[] {
  const seed = input.seed.trim().toLowerCase();
  return TOPIC_PATTERNS.slice(0, input.limit)
    .map((pattern) => {
      const topic = pattern.replace("{seed}", seed);
      const rng = makeRng(topic, "ai-topic", Math.floor(input.day / 30));
      return {
        topic,
        aiSearchVolume: rng.int(40, 4000),
        changePercent: rng.int(-30, 90),
      };
    })
    .sort((a, b) => b.aiSearchVolume - a.aiSearchVolume || a.topic.localeCompare(b.topic));
}

/** Pretend counts of AI answers that name a domain, for the two engines the real vendor covers. */
export function buildLlmMentions(input: { domain: string; day: number }): LlmMentionsSummary[] {
  return (["google_ai_overview", "chatgpt"] as const).map((engine) => {
    const rng = makeRng(input.domain, engine, "llm-mentions", Math.floor(input.day / 7));
    const questions = [
      `what is the best ${input.domain.split(".")[0]} alternative`,
      `is ${input.domain} legit`,
      `${input.domain.split(".")[0]} pricing`,
      `who are the top providers like ${input.domain.split(".")[0]}`,
    ];
    const top = questions.map((question) => ({ question, mentions: rng.int(1, 40) }));
    top.sort((a, b) => b.mentions - a.mentions || a.question.localeCompare(b.question));
    return {
      engine,
      mentions: top.reduce((sum, q) => sum + q.mentions, 0),
      aiSearchVolume: rng.int(200, 9000),
      topQuestions: top,
    };
  });
}

/** Pretend search numbers for exact phrases. Stable within a month. */
export function buildKeywordMetrics(input: { keywords: string[]; day: number }): KeywordMetric[] {
  const month = Math.floor(input.day / 30);
  return input.keywords.map((keyword) => {
    const rng = makeRng(keyword.toLowerCase(), "kw-metric", month);
    if (rng.chance(0.05))
      return { keyword, volume: null, cpcMicros: null, difficulty: null, trend: [] };
    const volume = Math.round(Math.exp(rng.normal(6.2, 1.6)));
    const season = rng.int(0, 11);
    const trend = Array.from({ length: 12 }, (_, i) =>
      Math.max(
        0,
        Math.round(
          volume *
            (1 + 0.35 * Math.cos(((i - season) / 12) * 2 * Math.PI)) *
            (0.9 + rng.next() * 0.2),
        ),
      ),
    );
    return {
      keyword,
      volume: Math.max(10, volume),
      cpcMicros: rng.int(100_000, 6_000_000),
      difficulty: rng.int(5, 95),
      trend,
    };
  });
}

/** Pretend Bing positions: Bing ranks a site a bit differently from Google. Stable within a week. */
export function buildBingRankings(input: {
  domain: string;
  keywords: string[];
  day: number;
}): BingRank[] {
  const week = Math.floor(input.day / 7);
  return input.keywords.map((keyword) => {
    const rng = makeRng(input.domain, keyword.toLowerCase(), "bing", week);
    if (rng.chance(0.35)) return { keyword, position: null, url: null };
    return {
      keyword,
      position: rng.int(1, 60),
      url: `https://${input.domain}/${keyword
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")}`,
    };
  });
}
