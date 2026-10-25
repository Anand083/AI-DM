import "server-only";
import { assertFeatureAvailable } from "./feature-status";
import { z } from "zod";
import {
  AI_ENGINES,
  DEFAULT_ENGINES,
  isEngine,
  MAX_AI_PROMPTS,
  summarizeChecks,
  type RunSummary,
} from "@/lib/ai-visibility";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { enqueueAiCheck } from "@/server/jobs/enqueue";
import { logActivity } from "./activity";
import {
  ConflictError,
  ForbiddenError,
  LimitExceededError,
  NotFoundError,
  ValidationError,
} from "./errors";
import { paging, type Page } from "./paging";
import { getProject } from "./projects";
import { parseInput } from "./validation";

const HISTORY_RUNS = 12;
const day = (d: Date) => d.toISOString().slice(0, 10);

function requireView(ctx: TenantContext): void {
  if (ctx.role === "CLIENT" || !can(ctx.role, "data.view")) throw new ForbiddenError();
}
function requireEdit(ctx: TenantContext): void {
  if (!can(ctx.role, "content.edit")) throw new ForbiddenError();
}

export const promptSchema = z.object({
  text: z
    .string()
    .trim()
    .min(5, "Write the question in at least 5 characters.")
    .max(200, "Keep the question under 200 characters."),
});

export const settingsSchema = z.object({
  brandName: z
    .string()
    .trim()
    .min(1, "Enter the brand name.")
    .max(80, "Keep the name under 80 characters."),
  engines: z
    .array(z.string())
    .min(1, "Pick at least one AI engine.")
    .max(AI_ENGINES.length)
    .refine((list) => list.every(isEngine), "Unknown AI engine."),
});

export async function getAiSettings(ctx: TenantContext, projectId: string) {
  requireView(ctx);
  const project = await getProject(ctx, projectId);
  const row = await db.aiSetting.findFirst({
    where: { agencyId: ctx.agencyId, projectId },
    select: { brandName: true, engines: true },
  });
  return {
    brandName: row?.brandName ?? project.client.name,
    engines: row?.engines.length ? row.engines : [...DEFAULT_ENGINES],
    saved: row !== null,
  };
}

export async function saveAiSettings(ctx: TenantContext, projectId: string, raw: unknown) {
  requireEdit(ctx);
  const input = parseInput(settingsSchema, raw);
  await getProject(ctx, projectId);
  const existing = await db.aiSetting.findFirst({
    where: { agencyId: ctx.agencyId, projectId },
    select: { id: true },
  });
  if (existing) {
    await db.aiSetting.updateMany({
      where: { id: existing.id, agencyId: ctx.agencyId },
      data: { brandName: input.brandName, engines: input.engines },
    });
  } else {
    await db.aiSetting.create({
      data: {
        agencyId: ctx.agencyId,
        projectId,
        brandName: input.brandName,
        engines: input.engines,
      },
    });
  }
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "ai.settings_saved",
    targetType: "Project",
    targetId: projectId,
    metadata: { engines: input.engines },
  });
}

export async function listPrompts(ctx: TenantContext, projectId: string) {
  requireView(ctx);
  await getProject(ctx, projectId);
  return db.aiPrompt.findMany({
    where: { agencyId: ctx.agencyId, projectId },
    select: { id: true, text: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: MAX_AI_PROMPTS + 5,
  });
}

export async function addPrompt(ctx: TenantContext, projectId: string, raw: unknown) {
  requireEdit(ctx);
  const input = parseInput(promptSchema, raw);
  await getProject(ctx, projectId);
  const count = await db.aiPrompt.count({ where: { agencyId: ctx.agencyId, projectId } });
  if (count >= MAX_AI_PROMPTS) {
    throw new LimitExceededError(
      `You can track up to ${MAX_AI_PROMPTS} questions per project. Remove one first.`,
    );
  }
  try {
    const created = await db.aiPrompt.create({
      data: { agencyId: ctx.agencyId, projectId, text: input.text },
      select: { id: true, text: true },
    });
    await logActivity({
      agencyId: ctx.agencyId,
      actorUserId: ctx.userId,
      action: "ai.prompt_added",
      targetType: "AiPrompt",
      targetId: created.id,
      metadata: { projectId },
    });
    return created;
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      throw new ConflictError("This question is already on the list.");
    }
    throw error;
  }
}

export async function removePrompt(ctx: TenantContext, projectId: string, promptId: string) {
  requireEdit(ctx);
  await getProject(ctx, projectId);
  const result = await db.aiPrompt.deleteMany({
    where: { id: promptId, agencyId: ctx.agencyId, projectId },
  });
  if (result.count === 0) throw new NotFoundError("Question not found.");
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "ai.prompt_removed",
    targetType: "AiPrompt",
    targetId: promptId,
    metadata: { projectId },
  });
}

/** Asks the worker to check the prompts now. The checks use the plan's AI check allowance. */
export async function requestAiCheck(ctx: TenantContext, projectId: string) {
  if (!can(ctx.role, "tools.run")) throw new ForbiddenError();
  assertFeatureAvailable("ai");
  await getProject(ctx, projectId);
  const prompts = await db.aiPrompt.count({ where: { agencyId: ctx.agencyId, projectId } });
  if (prompts === 0) throw new ValidationError("Add at least one question first.");
  const today = new Date();
  const [engines, done] = await Promise.all([
    getAiSettings(ctx, projectId).then((s) => s.engines.length),
    db.aiVisibilityCheck.count({
      where: {
        agencyId: ctx.agencyId,
        projectId,
        checkedOn: new Date(`${day(today)}T00:00:00Z`),
      },
    }),
  ]);
  if (done >= prompts * engines)
    throw new ConflictError("The questions were already checked today.");
  const queued = await enqueueAiCheck({ agencyId: ctx.agencyId, projectId, date: day(today) });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "ai.check_requested",
    targetType: "Project",
    targetId: projectId,
    metadata: {},
  });
  return { queued };
}

export type AiHistoryPoint = {
  date: string;
  total: number;
  mentioned: number;
  mentionRate: number;
};

/** Everything the overview needs: the latest run, how it compares with the one before, and the history. */
export async function getAiOverview(ctx: TenantContext, projectId: string) {
  requireView(ctx);
  await getProject(ctx, projectId);
  const base = { agencyId: ctx.agencyId, projectId };
  const days = await db.aiVisibilityCheck.findMany({
    where: base,
    select: { checkedOn: true },
    distinct: ["checkedOn"],
    orderBy: { checkedOn: "desc" },
    take: HISTORY_RUNS,
  });
  if (days.length === 0) {
    return {
      latestOn: null,
      latest: null,
      previousRate: null,
      history: [] as AiHistoryPoint[],
      citedPages: [],
      checkedToday: false,
    };
  }
  const counts = await db.aiVisibilityCheck.groupBy({
    by: ["checkedOn", "brandMentioned"],
    where: { ...base, checkedOn: { in: days.map((d) => d.checkedOn) } },
    _count: { _all: true },
    orderBy: { checkedOn: "desc" },
    take: HISTORY_RUNS * 2,
  });
  const history: AiHistoryPoint[] = days.map((d) => {
    const mentioned =
      counts.find((c) => c.checkedOn.getTime() === d.checkedOn.getTime() && c.brandMentioned)
        ?._count._all ?? 0;
    const other =
      counts.find((c) => c.checkedOn.getTime() === d.checkedOn.getTime() && !c.brandMentioned)
        ?._count._all ?? 0;
    const total = mentioned + other;
    return {
      date: day(d.checkedOn),
      total,
      mentioned,
      mentionRate: total === 0 ? 0 : Math.round((mentioned / total) * 100),
    };
  });

  const latestOn = days[0]!.checkedOn;
  const latestChecks = await db.aiVisibilityCheck.findMany({
    where: { ...base, checkedOn: latestOn },
    select: {
      engine: true,
      brandMentioned: true,
      domainCited: true,
      mentionPosition: true,
      competitorsMentioned: true,
      citedUrls: true,
    },
    take: 1000,
  });
  const cited = new Map<string, number>();
  for (const c of latestChecks)
    for (const url of c.citedUrls) cited.set(url, (cited.get(url) ?? 0) + 1);
  const citedPages = [...cited.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([url, count]) => ({ url, count }));

  return {
    latestOn: day(latestOn),
    latest: summarizeChecks(latestChecks) satisfies RunSummary,
    previousRate: history[1]?.mentionRate ?? null,
    history,
    citedPages,
    checkedToday: day(latestOn) === day(new Date()),
  };
}

/** The answers of the latest run, one row per prompt and engine. */
export async function listLatestAnswers(ctx: TenantContext, projectId: string, p: Page = {}) {
  requireView(ctx);
  await getProject(ctx, projectId);
  const latest = await db.aiVisibilityCheck.findFirst({
    where: { agencyId: ctx.agencyId, projectId },
    select: { checkedOn: true },
    orderBy: { checkedOn: "desc" },
  });
  if (!latest) return { rows: [], total: 0 };
  const { take, skip } = paging({ pageSize: 25, ...p });
  const where = { agencyId: ctx.agencyId, projectId, checkedOn: latest.checkedOn };
  const [rows, total] = await Promise.all([
    db.aiVisibilityCheck.findMany({
      where,
      select: {
        id: true,
        engine: true,
        brandMentioned: true,
        domainCited: true,
        mentionPosition: true,
        sentiment: true,
        snippet: true,
        citedUrls: true,
        competitorsMentioned: true,
        prompt: { select: { text: true } },
      },
      orderBy: [{ prompt: { text: "asc" } }, { engine: "asc" }, { id: "asc" }],
      take,
      skip,
    }),
    db.aiVisibilityCheck.count({ where }),
  ]);
  return { rows, total };
}
