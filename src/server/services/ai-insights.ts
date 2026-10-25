import "server-only";
import {
  buildRecommendations,
  citationDomains,
  competitorComparison,
  describeCoverage,
  trendBy,
  type CheckRow,
} from "@/lib/ai-insights";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import type { AiTopic, LlmMentionsSummary } from "@/server/providers/seo/types";
import { ForbiddenError } from "./errors";
import { getAiSettings } from "./ai-visibility";
import { getProject } from "./projects";

const RUNS = 8;
const day = (d: Date) => d.toISOString().slice(0, 10);

function requireView(ctx: TenantContext): void {
  if (ctx.role === "CLIENT" || !can(ctx.role, "data.view")) throw new ForbiddenError();
}

/**
 * Everything the AI visibility page shows beyond the plain mention rate: which websites AI
 * links to, how competitors compare, trends by engine and question, topic demand, coverage and
 * freshness, and advice with the numbers behind it. All of it reads saved answers (no provider call).
 */
export async function getAiInsights(ctx: TenantContext, projectId: string, today = new Date()) {
  requireView(ctx);
  const project = await getProject(ctx, projectId);
  const base = { agencyId: ctx.agencyId, projectId };
  const days = await db.aiVisibilityCheck.findMany({
    where: base,
    select: { checkedOn: true },
    distinct: ["checkedOn"],
    orderBy: { checkedOn: "desc" },
    take: RUNS,
  });
  const [settings, prompts, rivals, market] = await Promise.all([
    getAiSettings(ctx, projectId),
    db.aiPrompt.findMany({
      where: base,
      select: { id: true, text: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 20,
    }),
    db.competitor.findMany({
      where: base,
      select: { domain: true },
      orderBy: { domain: "asc" },
      take: 20,
    }),
    db.aiMarketSnapshot.findFirst({
      where: base,
      select: { takenOn: true, topics: true, mentions: true, provider: true },
      orderBy: { takenOn: "desc" },
    }),
  ]);
  const rows =
    days.length === 0
      ? []
      : await db.aiVisibilityCheck.findMany({
          where: { ...base, checkedOn: { in: days.map((d) => d.checkedOn) } },
          select: {
            promptId: true,
            engine: true,
            checkedOn: true,
            brandMentioned: true,
            domainCited: true,
            mentionPosition: true,
            sentiment: true,
            citedUrls: true,
            competitorsMentioned: true,
            provider: true,
          },
          take: RUNS * 500,
        });
  const checks: CheckRow[] = rows.map((r) => ({ ...r, checkedOn: day(r.checkedOn) }));
  const latestOn = days[0] ? day(days[0].checkedOn) : null;
  const latest = checks.filter((c) => c.checkedOn === latestOn);
  const rivalDomains = rivals.map((r) => r.domain);
  const promptText = new Map(prompts.map((p) => [p.id, p.text]));
  const comparison = competitorComparison(latest, rivalDomains);
  const topics = (market?.topics ?? []) as unknown as AiTopic[];
  const mentions = (market?.mentions ?? []) as unknown as LlmMentionsSummary[];
  const sample = rows.length === 0 ? true : rows.some((r) => r.provider === "mock");

  return {
    latestOn,
    coverage: describeCoverage({
      prompts: prompts.length,
      engines: settings.engines.length,
      latestOn,
      latestCount: latest.length,
      today: day(today),
      sample,
    }),
    citations: citationDomains(latest, project.domain, rivalDomains),
    comparison,
    engineTrends: trendBy(checks, (c) => c.engine),
    promptTrends: trendBy(checks, (c) => c.promptId).map((t) => ({
      ...t,
      key: promptText.get(t.key) ?? "A removed question",
    })),
    market: market
      ? {
          takenOn: day(market.takenOn),
          sample: market.provider === "mock",
          topics,
          mentions,
        }
      : null,
    recommendations: buildRecommendations({
      latest,
      promptText,
      rivals: comparison.rivals,
      brandAnswers: comparison.brand.answers,
      topics,
    }),
  };
}
