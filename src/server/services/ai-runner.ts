import type { Prisma } from "@prisma/client";
import { buildMentionLostAlert } from "@/lib/alert-rules";
import {
  competitorsMentioned,
  DEFAULT_ENGINES,
  engineLabel,
  isEngine,
  lostMentions,
} from "@/lib/ai-visibility";
import type { Db } from "@/server/db/client";
import type {
  AiEngine,
  AiTopic,
  AiVisibilityResult,
  LlmMentionsSummary,
} from "@/server/providers/seo/types";
import { createAlerts } from "./alert-store";
import { AppError } from "./errors";
import type { GatewayCaller, GatewayResult } from "./seo-gateway";

export type AiGateway = {
  checkAiVisibility(
    caller: GatewayCaller,
    input: { prompt: string; brand: string; domain: string; engine: AiEngine },
  ): Promise<GatewayResult<AiVisibilityResult>>;
  getAiTopicDemand(
    caller: GatewayCaller,
    input: { seed: string; locationCode: number; languageCode: string; limit: number },
  ): Promise<GatewayResult<AiTopic[]>>;
  getLlmMentions(
    caller: GatewayCaller,
    input: { domain: string; locationCode: number; languageCode: string },
  ): Promise<GatewayResult<LlmMentionsSummary[]>>;
};

export type AiRun = {
  projectId: string;
  agencyId: string;
  /** UTC day, YYYY-MM-DD. */
  date: string;
};

export type AiRunResult =
  | { status: "inactive" }
  | { status: "no-prompts" }
  | {
      status: "done" | "stopped";
      checked: number;
      skipped: number;
      /** Why the run stopped early, in plain words (plan limit or budget). */
      reason?: string;
      alerted: boolean;
      /** True when the day's market snapshot (topic demand and mentions) was saved by this run. */
      marketSaved: boolean;
    };

const day = (value: string) => new Date(`${value}T00:00:00Z`);

/**
 * Asks every engine about every prompt of a project for one day and saves the answers.
 * A pair that already has an answer for the day is skipped, so running twice does nothing new.
 * When the plan limit or the provider budget is reached the run stops and keeps what it has.
 */
export async function runAiVisibility(
  deps: { db: Db; gateway: AiGateway },
  run: AiRun,
): Promise<AiRunResult> {
  const { db, gateway } = deps;
  const project = await db.project.findFirst({
    where: {
      id: run.projectId,
      agencyId: run.agencyId,
      deletedAt: null,
      client: { deletedAt: null, status: "ACTIVE" },
    },
    select: {
      id: true,
      name: true,
      domain: true,
      locationCode: true,
      languageCode: true,
      client: { select: { name: true } },
    },
  });
  if (!project) return { status: "inactive" };

  const prompts = await db.aiPrompt.findMany({
    where: { agencyId: run.agencyId, projectId: project.id },
    select: { id: true, text: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 50,
  });
  if (prompts.length === 0) return { status: "no-prompts" };

  const setting = await db.aiSetting.findFirst({
    where: { agencyId: run.agencyId, projectId: project.id },
    select: { brandName: true, engines: true },
  });
  const brand = setting?.brandName || project.client.name;
  const engines = (setting?.engines.length ? setting.engines : [...DEFAULT_ENGINES]).filter(
    isEngine,
  );

  const rivals = (
    await db.competitor.findMany({
      where: { agencyId: run.agencyId, projectId: project.id },
      select: { domain: true },
      take: 20,
    })
  ).map((c) => c.domain);

  const checkedOn = day(run.date);
  const done = await db.aiVisibilityCheck.findMany({
    where: { agencyId: run.agencyId, projectId: project.id, checkedOn },
    select: { promptId: true, engine: true },
    take: 1000,
  });
  const doneKeys = new Set(done.map((d) => `${d.promptId}|${d.engine}`));

  // The run before this one, for "no longer mentioned".
  const lastDay = await db.aiVisibilityCheck.findFirst({
    where: { agencyId: run.agencyId, projectId: project.id, checkedOn: { lt: checkedOn } },
    select: { checkedOn: true },
    orderBy: { checkedOn: "desc" },
  });
  const previous = lastDay
    ? await db.aiVisibilityCheck.findMany({
        where: { agencyId: run.agencyId, projectId: project.id, checkedOn: lastDay.checkedOn },
        select: { promptId: true, engine: true, brandMentioned: true },
        take: 1000,
      })
    : [];

  const caller = { agencyId: run.agencyId, projectId: project.id };
  const fresh: { promptId: string; engine: string; brandMentioned: boolean }[] = [];
  let checked = 0;
  let skipped = 0;
  let reason: string | undefined;

  outer: for (const prompt of prompts) {
    for (const engine of engines) {
      if (doneKeys.has(`${prompt.id}|${engine}`)) {
        skipped++;
        continue;
      }
      let result: GatewayResult<AiVisibilityResult>;
      try {
        result = await gateway.checkAiVisibility(caller, {
          prompt: prompt.text,
          brand,
          domain: project.domain,
          engine,
        });
      } catch (error) {
        // Plan limit or budget pause: keep what we have and stop.
        if (error instanceof AppError) {
          reason = error.message;
          break outer;
        }
        throw error;
      }
      const r = result.data;
      await db.aiVisibilityCheck.createMany({
        data: [
          {
            agencyId: run.agencyId,
            projectId: project.id,
            promptId: prompt.id,
            engine,
            checkedOn,
            brandMentioned: r.brandMentioned,
            domainCited: r.domainCited,
            mentionPosition: r.mentionPosition,
            sentiment: r.sentiment,
            snippet: r.answerSnippet.slice(0, 1000),
            citedUrls: r.citedUrls.slice(0, 10),
            competitorsMentioned: competitorsMentioned(r, rivals),
            provider: result.provider,
          },
        ],
        skipDuplicates: true,
      });
      fresh.push({ promptId: prompt.id, engine, brandMentioned: r.brandMentioned });
      checked++;
    }
  }

  let marketSaved = false;
  if (!reason) {
    const haveMarket = await db.aiMarketSnapshot.findFirst({
      where: { agencyId: run.agencyId, projectId: project.id, takenOn: checkedOn },
      select: { id: true },
    });
    if (!haveMarket) {
      try {
        const topics = await gateway.getAiTopicDemand(caller, {
          seed: brand,
          locationCode: project.locationCode,
          languageCode: project.languageCode,
          limit: 12,
        });
        const mentions = await gateway.getLlmMentions(caller, {
          domain: project.domain,
          locationCode: project.locationCode,
          languageCode: project.languageCode,
        });
        const saved = await db.aiMarketSnapshot.createMany({
          data: [
            {
              agencyId: run.agencyId,
              projectId: project.id,
              takenOn: checkedOn,
              topics: topics.data as unknown as Prisma.InputJsonValue,
              mentions: mentions.data as unknown as Prisma.InputJsonValue,
              provider: mentions.provider,
            },
          ],
          skipDuplicates: true,
        });
        marketSaved = saved.count > 0;
      } catch (error) {
        // Plan limit or budget pause: the answers above are kept, the market view waits.
        if (!(error instanceof AppError)) throw error;
        reason = error.message;
      }
    }
  }

  let alerted = false;
  const lost = lostMentions(previous, fresh);
  if (lost.length > 0) {
    const names = new Map(prompts.map((p) => [p.id, p.text]));
    const draft = buildMentionLostAlert({
      projectId: project.id,
      projectName: project.name,
      date: run.date,
      lost: lost.map((l) => `"${names.get(l.promptId) ?? "A prompt"}" on ${engineLabel(l.engine)}`),
    });
    if (draft) alerted = (await createAlerts(db, run.agencyId, [draft])) > 0;
  }
  return { status: reason ? "stopped" : "done", checked, skipped, reason, alerted, marketSaved };
}
