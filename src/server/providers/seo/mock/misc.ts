import type { AiEngine, AiVisibilityResult, ReviewSummary } from "../types";
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
