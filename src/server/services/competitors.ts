import "server-only";
import { z } from "zod";
import {
  MAX_COMPETITORS,
  positionInTop,
  sortComparison,
  summarizeCompetitors,
  type ComparisonRow,
  type TopResult,
} from "@/lib/competitors";
import { normalizeDomain } from "@/lib/domain";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { enqueueCompetitorGap } from "@/server/jobs/enqueue";
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

/** Most keywords compared at once. Projects with more keywords are compared on the first 1000. */
export const COMPARISON_KEYWORD_LIMIT = 1000;
const BATCH = 200;

function requireView(ctx: TenantContext): void {
  if (ctx.role === "CLIENT" || !can(ctx.role, "data.view")) throw new ForbiddenError();
}
function requireEdit(ctx: TenantContext): void {
  if (!can(ctx.role, "content.edit")) throw new ForbiddenError();
}

export const competitorSchema = z.object({
  domain: z.string().trim().min(1, "Enter the competitor's website.").max(253),
});

export async function listCompetitors(ctx: TenantContext, projectId: string) {
  requireView(ctx);
  await getProject(ctx, projectId);
  return db.competitor.findMany({
    where: { agencyId: ctx.agencyId, projectId },
    select: { id: true, domain: true, gapFetchedAt: true },
    orderBy: { domain: "asc" },
    take: MAX_COMPETITORS + 5,
  });
}

export async function addCompetitor(ctx: TenantContext, projectId: string, raw: unknown) {
  requireEdit(ctx);
  const input = parseInput(competitorSchema, raw);
  const project = await getProject(ctx, projectId);
  const domain = normalizeDomain(input.domain);
  if (!domain) {
    throw new ValidationError("Enter a website like example.com.", {
      domain: "Enter a website like example.com.",
    });
  }
  if (domain === project.domain) {
    throw new ValidationError("A site cannot be its own competitor.", {
      domain: "This is the website of the project itself.",
    });
  }
  const count = await db.competitor.count({ where: { agencyId: ctx.agencyId, projectId } });
  if (count >= MAX_COMPETITORS) {
    throw new LimitExceededError(
      `You can compare with up to ${MAX_COMPETITORS} competitors per project. Remove one first.`,
    );
  }
  try {
    const created = await db.competitor.create({
      data: { agencyId: ctx.agencyId, projectId, domain },
      select: { id: true, domain: true },
    });
    await logActivity({
      agencyId: ctx.agencyId,
      actorUserId: ctx.userId,
      action: "competitor.added",
      targetType: "Competitor",
      targetId: created.id,
      metadata: { projectId, domain },
    });
    return created;
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      throw new ConflictError("This competitor is already on the list.");
    }
    throw error;
  }
}

export async function removeCompetitor(
  ctx: TenantContext,
  projectId: string,
  competitorId: string,
) {
  requireEdit(ctx);
  await getProject(ctx, projectId);
  const found = await db.competitor.findFirst({
    where: { id: competitorId, agencyId: ctx.agencyId, projectId },
    select: { id: true, domain: true },
  });
  if (!found) throw new NotFoundError("Competitor not found.");
  await db.competitor.deleteMany({ where: { id: found.id, agencyId: ctx.agencyId } });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "competitor.removed",
    targetType: "Competitor",
    targetId: found.id,
    metadata: { projectId, domain: found.domain },
  });
}

/**
 * Reads every tracked keyword's position and the position of each competitor in the top 10
 * saved by the keyword's last rank check. No provider is called. Used by the page and the report.
 */
export async function loadComparisonRows(agencyId: string, projectId: string) {
  const competitors = await db.competitor.findMany({
    where: { agencyId, projectId },
    select: { id: true, domain: true, gapFetchedAt: true },
    orderBy: { domain: "asc" },
    take: MAX_COMPETITORS + 5,
  });
  const domains = competitors.map((c) => c.domain);

  const rows: ComparisonRow[] = [];
  let cursor: string | undefined;
  let seen = 0;
  for (;;) {
    const keywords = await db.keyword.findMany({
      where: { agencyId, projectId, lastCheckedOn: { not: null } },
      select: { id: true, phrase: true, currentPosition: true, lastCheckedOn: true },
      orderBy: { id: "asc" },
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (keywords.length === 0) break;
    cursor = keywords[keywords.length - 1]!.id;
    seen += keywords.length;
    if (domains.length > 0) {
      const checks = await db.rankCheck.findMany({
        where: {
          agencyId,
          OR: keywords.map((k) => ({ keywordId: k.id, date: k.lastCheckedOn! })),
        },
        select: { keywordId: true, topResults: true },
        take: keywords.length,
      });
      const tops = new Map(
        checks.map((c) => [c.keywordId, c.topResults as unknown as TopResult[]]),
      );
      for (const k of keywords) {
        const top = tops.get(k.id) ?? [];
        rows.push({
          phrase: k.phrase,
          you: k.currentPosition,
          competitors: Object.fromEntries(domains.map((d) => [d, positionInTop(top, d)])),
        });
      }
    }
    if (seen >= COMPARISON_KEYWORD_LIMIT || keywords.length < BATCH) break;
  }
  return { competitors, rows };
}

/** The comparison for the page: summary per competitor and one page of keyword rows. */
export async function getComparison(ctx: TenantContext, projectId: string, p: Page = {}) {
  requireView(ctx);
  await getProject(ctx, projectId);
  const { competitors, rows } = await loadComparisonRows(ctx.agencyId, projectId);
  const { take, skip } = paging({ pageSize: 25, ...p });
  const sorted = sortComparison(rows);
  return {
    competitors,
    summary: summarizeCompetitors(
      rows,
      competitors.map((c) => c.domain),
    ),
    compared: rows.length,
    rows: sorted.slice(skip, skip + take),
    total: sorted.length,
  };
}

export async function listGap(
  ctx: TenantContext,
  projectId: string,
  filter: Page & { competitorId?: string } = {},
) {
  requireView(ctx);
  await getProject(ctx, projectId);
  const { take, skip } = paging({ pageSize: 25, ...filter });
  const where = {
    agencyId: ctx.agencyId,
    projectId,
    ...(filter.competitorId ? { competitorId: filter.competitorId } : {}),
  };
  const [rows, total] = await Promise.all([
    db.competitorKeyword.findMany({
      where,
      select: {
        id: true,
        keyword: true,
        position: true,
        volume: true,
        url: true,
        competitor: { select: { id: true, domain: true } },
      },
      orderBy: [{ volume: "desc" }, { keyword: "asc" }, { id: "asc" }],
      take,
      skip,
    }),
    db.competitorKeyword.count({ where }),
  ]);
  return { rows, total };
}

/** Asks the worker to refresh the keyword gap. It uses provider data, so it never runs in the page. */
export async function requestGapRefresh(ctx: TenantContext, projectId: string) {
  if (!can(ctx.role, "tools.run")) throw new ForbiddenError();
  await getProject(ctx, projectId);
  const count = await db.competitor.count({ where: { agencyId: ctx.agencyId, projectId } });
  if (count === 0) throw new ValidationError("Add at least one competitor first.");
  const today = new Date().toISOString().slice(0, 10);
  const queued = await enqueueCompetitorGap({ agencyId: ctx.agencyId, projectId, date: today });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "competitor.gap_requested",
    targetType: "Project",
    targetId: projectId,
    metadata: {},
  });
  return { queued };
}
