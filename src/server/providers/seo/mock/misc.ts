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

export function buildReviews(businessName: string, locationCode: number, now: Date): ReviewSummary {
  const base = makeRng(businessName, locationCode, "reviews");
  const comments = [
    "Friendly staff and quick service.",
    "Good value, would come back.",
    "Took longer than expected, but the result was fine.",
    "Excellent. Highly recommend!",
    "Not what I hoped for.",
    "Clean, professional and on time.",
  ];
  const recent = Array.from({ length: 5 }, (_, i) => {
    const r = makeRng(businessName, locationCode, "review", i);
    return {
      author: `Customer ${r.int(100, 999)}`,
      rating: r.pick([5, 5, 5, 4, 4, 3, 2, 1]),
      text: r.pick(comments),
      publishedAt: new Date(now.getTime() - r.int(1, 90) * 86_400_000).toISOString().slice(0, 10),
    };
  });
  return {
    businessName,
    rating: Math.round((3.2 + base.next() * 1.7) * 10) / 10,
    reviewCount: Math.max(5, Math.round(Math.exp(base.normal(4.5, 1.2)))),
    recent,
  };
}
