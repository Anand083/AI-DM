import "server-only";
import { z } from "zod";
import { MAX_QUESTION_LENGTH, actionSchema, type AssistantBundle } from "@/lib/assistant";
import { formatGoalValue, goalInfo, goalStatus } from "@/lib/goals";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { enqueueAssistant } from "@/server/jobs/enqueue";
import { logActivity } from "./activity";
import { getAiInsights } from "./ai-insights";
import { getBacklinkOverview } from "./backlinks";
import { getComparison } from "./competitors";
import { getDecayingPages } from "./content";
import {
  ConflictError,
  ForbiddenError,
  LimitExceededError,
  NotFoundError,
  ValidationError,
} from "./errors";
import { listGoals } from "./goals";
import { getKeywordInsights } from "./keyword-insights";
import { addKeywords, getProjectSummary } from "./keywords";
import { getProject } from "./projects";
import { getIssueGroups, getLatestCompletedAudit } from "./audits";
import { createTask } from "./tasks";
import { parseInput } from "./validation";

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Questions one agency may ask a day, whatever the person or project. */
export const ASSISTANT_DAILY_LIMIT = 50;
/** A question still waiting after this long is treated as lost, so a new one can be asked. */
const STALE_AFTER_MS = 5 * 60_000;

function requireView(ctx: TenantContext): void {
  if (ctx.role === "CLIENT" || !can(ctx.role, "data.view")) throw new ForbiddenError();
}

async function safely<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch {
    return fallback;
  }
}

/**
 * The facts about a project as the person with `ctx` may see them. Each part reuses the same
 * service a page uses (so the same permissions apply); a part that fails or has no data is left out.
 */
export async function buildAssistantBundle(
  ctx: TenantContext,
  projectId: string,
  today = new Date(),
): Promise<AssistantBundle> {
  const project = await getProject(ctx, projectId);
  const weekBase = { agencyId: ctx.agencyId, projectId };
  const [summary, audit, decaying, keywordInsights, ai, competitors, goals, backlinks, up, down] =
    await Promise.all([
      safely(() => getProjectSummary(ctx, projectId), null),
      safely(async () => {
        const latest = await getLatestCompletedAudit(ctx, projectId);
        if (!latest || latest.healthScore === null) return null;
        const groups = await getIssueGroups(ctx, projectId, latest.id);
        const counts = (latest.counts ?? {}) as {
          critical?: number;
          warning?: number;
          notice?: number;
        };
        return {
          score: latest.healthScore,
          pages: latest.pagesCrawled,
          critical: counts.critical ?? 0,
          warning: counts.warning ?? 0,
          notice: counts.notice ?? 0,
          topIssues: groups
            .slice(0, 5)
            .map((g) => ({ code: g.code, title: g.title, severity: g.severity, pages: g.count })),
        };
      }, null),
      safely(() => getDecayingPages(ctx, projectId), []),
      safely(() => getKeywordInsights(ctx, projectId), null),
      safely(() => getAiInsights(ctx, projectId, today), null),
      safely(() => getComparison(ctx, projectId, { pageSize: 1 }), null),
      safely(() => listGoals(ctx, projectId), []),
      safely(() => getBacklinkOverview(ctx, projectId), null),
      safely(() => db.keyword.count({ where: { ...weekBase, changeWeek: { gt: 0 } } }), 0),
      safely(() => db.keyword.count({ where: { ...weekBase, changeWeek: { lt: 0 } } }), 0),
    ]);
  return {
    project: { name: project.name, domain: project.domain },
    today: day(today),
    rankings:
      summary && summary.checkedKeywords > 0
        ? {
            tracked: summary.totalKeywords,
            checked: summary.checkedKeywords,
            averagePosition: summary.averagePosition,
            top3: summary.distribution.top3 ?? 0,
            top10: (summary.distribution.top3 ?? 0) + (summary.distribution.top10 ?? 0),
            improved: up,
            declined: down,
            gainers: summary.topGainers.map((k) => ({
              phrase: k.phrase,
              change: k.changeWeek ?? 0,
            })),
            losers: summary.topLosers.map((k) => ({ phrase: k.phrase, change: k.changeWeek ?? 0 })),
          }
        : null,
    audit,
    decaying: decaying.slice(0, 5).map((d) => ({
      path: (() => {
        try {
          return new URL(d.url).pathname || "/";
        } catch {
          return d.url;
        }
      })(),
      percent: d.percent,
      lost: d.lost,
    })),
    opportunities: (keywordInsights?.opportunities ?? []).slice(0, 5).map((o) => ({
      phrase: o.phrase,
      position: o.position,
      volume: o.volume,
      score: o.opportunity,
    })),
    aiVisibility:
      ai && ai.latestOn
        ? {
            mentionRate: ai.comparison.brand.rate,
            recommendations: ai.recommendations
              .slice(0, 3)
              .map((r) => ({ title: r.title, evidence: r.evidence, confidence: r.confidence })),
          }
        : null,
    competitors: (competitors?.summary ?? []).slice(0, 3).map((c) => ({
      domain: c.domain,
      inTop10: c.inTop10,
      theyAreAhead: c.theyAreAhead,
    })),
    goals: goals.slice(0, 5).map((g) => ({
      label: goalInfo(g.kind)?.label ?? g.kind,
      current: formatGoalValue(g.kind, g.current),
      target: formatGoalValue(g.kind, g.target),
      percent: g.percent,
      status: goalStatus(g.percent, g.onTrack),
    })),
    backlinks: backlinks?.latest
      ? {
          total: backlinks.latest.totalBacklinks,
          referringDomains: backlinks.latest.referringDomains,
          newLinks: backlinks.latest.newLinks,
          lostLinks: backlinks.latest.lostLinks,
        }
      : null,
  };
}

export const questionSchema = z.object({
  question: z
    .string()
    .trim()
    .min(5, "Write a question of at least 5 characters.")
    .max(MAX_QUESTION_LENGTH, `Keep the question under ${MAX_QUESTION_LENGTH} characters.`),
});

/** Saves a question and queues the answer. The answer is written by the worker. */
export async function askAssistant(
  ctx: TenantContext,
  projectId: string,
  raw: unknown,
  now = new Date(),
) {
  if (!can(ctx.role, "tools.run")) throw new ForbiddenError();
  const input = parseInput(questionSchema, raw);
  await getProject(ctx, projectId);
  const base = { agencyId: ctx.agencyId };

  const waiting = await db.assistantMessage.findFirst({
    where: {
      ...base,
      projectId,
      userId: ctx.userId,
      role: "USER",
      status: "PENDING",
      createdAt: { gt: new Date(now.getTime() - STALE_AFTER_MS) },
    },
    select: { id: true },
  });
  if (waiting) throw new ConflictError("Wait for the answer to your last question first.");

  const startOfDay = new Date(`${day(now)}T00:00:00Z`);
  const today = await db.assistantMessage.count({
    where: { ...base, role: "USER", createdAt: { gte: startOfDay } },
  });
  if (today >= ASSISTANT_DAILY_LIMIT) {
    throw new LimitExceededError(
      `Your agency has used its ${ASSISTANT_DAILY_LIMIT} assistant questions for today. Try again tomorrow.`,
    );
  }
  const message = await db.assistantMessage.create({
    data: {
      ...base,
      projectId,
      userId: ctx.userId,
      role: "USER",
      content: input.question,
      status: "PENDING",
    },
    select: { id: true },
  });
  await enqueueAssistant({ agencyId: ctx.agencyId, projectId, messageId: message.id });
  return message;
}

export type ConversationItem = {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  status: string | null;
  confidence: string | null;
  provider: string | null;
  evidence: { source: string; detail: string }[];
  createdAt: Date;
  actions: {
    id: string;
    type: string;
    status: string;
    resultNote: string | null;
    label: string;
    detail: string;
  }[];
};

const describeAction = (type: string, payload: unknown): { label: string; detail: string } => {
  const parsed = actionSchema.safeParse(payload);
  if (!parsed.success) return { label: "Unknown suggestion", detail: "" };
  const a = parsed.data;
  return a.type === "create_task"
    ? { label: `Create the task "${a.title}"`, detail: a.description }
    : {
        label: `Start tracking ${a.phrases.length} ${a.phrases.length === 1 ? "keyword" : "keywords"}`,
        detail: a.phrases.join(", "),
      };
};

/** The asking person's own conversation about a project, oldest first (last 40 messages). */
export async function listConversation(
  ctx: TenantContext,
  projectId: string,
): Promise<ConversationItem[]> {
  requireView(ctx);
  await getProject(ctx, projectId);
  const rows = await db.assistantMessage.findMany({
    where: { agencyId: ctx.agencyId, projectId, userId: ctx.userId },
    select: {
      id: true,
      role: true,
      content: true,
      status: true,
      confidence: true,
      provider: true,
      evidence: true,
      createdAt: true,
      actions: {
        select: { id: true, type: true, status: true, resultNote: true, payload: true },
        orderBy: { createdAt: "asc" },
        take: 5,
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 40,
  });
  return rows.reverse().map((r) => ({
    id: r.id,
    role: r.role === "USER" ? "USER" : "ASSISTANT",
    content: r.content,
    status: r.status,
    confidence: r.confidence,
    provider: r.provider,
    evidence: Array.isArray(r.evidence) ? (r.evidence as { source: string; detail: string }[]) : [],
    createdAt: r.createdAt,
    actions: r.actions.map((a) => ({
      id: a.id,
      type: a.type,
      status: a.status,
      resultNote: a.resultNote,
      ...describeAction(a.type, a.payload),
    })),
  }));
}

/**
 * Approve or dismiss a suggestion. Approving does the action as the person who approves, so it
 * needs their own permission and goes through the normal checks. A suggestion is decided once.
 */
export async function decideAssistantAction(
  ctx: TenantContext,
  projectId: string,
  actionId: string,
  decision: "approve" | "dismiss",
  now = new Date(),
) {
  if (!can(ctx.role, "content.edit")) throw new ForbiddenError();
  await getProject(ctx, projectId);
  const action = await db.assistantAction.findFirst({
    where: {
      id: actionId,
      agencyId: ctx.agencyId,
      projectId,
      message: { userId: ctx.userId },
    },
    select: { id: true, payload: true, status: true },
  });
  if (!action) throw new NotFoundError("Suggestion not found.");
  const claimed = await db.assistantAction.updateMany({
    where: { id: action.id, agencyId: ctx.agencyId, status: "PENDING" },
    data: {
      status: decision === "approve" ? "APPROVED" : "DISMISSED",
      decidedById: ctx.userId,
      decidedAt: now,
    },
  });
  if (claimed.count === 0) throw new ConflictError("This suggestion was already decided.");
  if (decision === "dismiss") return { status: "DISMISSED" as const, note: null };

  const parsed = actionSchema.safeParse(action.payload);
  let note = "";
  try {
    if (!parsed.success) throw new ValidationError("This suggestion is not valid any more.");
    const a = parsed.data;
    if (a.type === "create_task") {
      await createTask(ctx, {
        title: a.title,
        description: a.description,
        priority: a.priority,
        projectId,
      });
      note = "Task created.";
    } else {
      const r = await addKeywords(ctx, projectId, {
        text: a.phrases.join("\n"),
        tags: "assistant",
      });
      note = `Added ${r.added}, already tracked ${r.alreadyTracked}.`;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "It did not work.";
    await db.assistantAction.updateMany({
      where: { id: action.id, agencyId: ctx.agencyId },
      data: { status: "FAILED", resultNote: message.slice(0, 300) },
    });
    throw error;
  }
  await db.assistantAction.updateMany({
    where: { id: action.id, agencyId: ctx.agencyId },
    data: { resultNote: note },
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "assistant.action_approved",
    targetType: "AssistantAction",
    targetId: action.id,
    metadata: { projectId, type: parsed.success ? parsed.data.type : "unknown" },
  });
  return { status: "APPROVED" as const, note };
}

/** Facts for the worker: loads the asking person's role in the agency, then builds the bundle as them. */
export async function buildBundleForUser(
  userId: string,
  agencyId: string,
  projectId: string,
): Promise<AssistantBundle | null> {
  const member = await db.agencyMember.findFirst({
    where: { agencyId, userId },
    select: { role: true },
  });
  if (!member) return null;
  return buildAssistantBundle({ userId, agencyId, role: member.role }, projectId);
}
