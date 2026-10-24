import "server-only";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  averagePosition,
  BUCKETS,
  distribution,
  visibilityScore,
  type BucketKey,
} from "@/lib/rank-math";
import { parseKeywordPaste, parseTags } from "@/lib/keyword-input";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { logActivity } from "./activity";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { paging, type Page } from "./paging";
import { assertCountWithinLimit } from "./plan";
import { getProject } from "./projects";
import { parseInput } from "./validation";

function requireView(ctx: TenantContext): void {
  if (ctx.role === "CLIENT" || !can(ctx.role, "data.view")) throw new ForbiddenError();
}

export const addKeywordsSchema = z.object({
  text: z.string().max(500_000, "That list is too long."),
  tags: z.string().max(500, "Use 500 characters or fewer for tags.").optional(),
  targetUrl: z
    .string()
    .trim()
    .max(500, "Use 500 characters or fewer.")
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine(
      (v) => v === undefined || /^https?:\/\/\S+$/i.test(v),
      "Enter a full web address, like https://example.com/page.",
    ),
});

export type AddKeywordsResult = {
  added: number;
  /** Already tracked for this project. */
  alreadyTracked: number;
  /** Listed twice in the pasted text. */
  duplicatesInPaste: number;
  tooLong: number;
};

/** Adds keywords from a pasted list (one per line). Duplicates are skipped; the plan limit is enforced. */
export async function addKeywords(
  ctx: TenantContext,
  projectId: string,
  rawInput: unknown,
): Promise<AddKeywordsResult> {
  if (!can(ctx.role, "content.edit")) throw new ForbiddenError();
  const input = parseInput(addKeywordsSchema, rawInput);
  await getProject(ctx, projectId);

  const parsed = parseKeywordPaste(input.text);
  if (parsed.phrases.length === 0) {
    throw new ValidationError("Paste at least one keyword.", {
      text: "Paste at least one keyword, one per line.",
    });
  }
  const tags = parseTags(input.tags ?? "");

  const existing = await db.keyword.findMany({
    where: { agencyId: ctx.agencyId, projectId, phrase: { in: parsed.phrases } },
    select: { phrase: true },
  });
  const known = new Set(existing.map((e) => e.phrase));
  const fresh = parsed.phrases.filter((p) => !known.has(p));

  if (fresh.length > 0) {
    const current = await db.keyword.count({
      where: { agencyId: ctx.agencyId, project: { deletedAt: null } },
    });
    await assertCountWithinLimit(ctx, "maxKeywords", current, fresh.length);
    await db.keyword.createMany({
      data: fresh.map((phrase) => ({
        agencyId: ctx.agencyId,
        projectId,
        phrase,
        tags,
        targetUrl: input.targetUrl,
      })),
      skipDuplicates: true,
    });
    await logActivity({
      agencyId: ctx.agencyId,
      actorUserId: ctx.userId,
      action: "keywords.added",
      targetType: "Project",
      targetId: projectId,
      metadata: { count: fresh.length },
    });
  }
  return {
    added: fresh.length,
    alreadyTracked: parsed.phrases.length - fresh.length,
    duplicatesInPaste: parsed.duplicates.length,
    tooLong: parsed.tooLong.length,
  };
}

export async function deleteKeywords(
  ctx: TenantContext,
  projectId: string,
  ids: string[],
): Promise<number> {
  if (!can(ctx.role, "content.edit")) throw new ForbiddenError();
  await getProject(ctx, projectId);
  const clean = ids
    .filter((id) => typeof id === "string" && id.length > 0 && id.length <= 100)
    .slice(0, 1000);
  if (clean.length === 0) return 0;
  const result = await db.keyword.deleteMany({
    where: { agencyId: ctx.agencyId, projectId, id: { in: clean } },
  });
  if (result.count > 0) {
    await logActivity({
      agencyId: ctx.agencyId,
      actorUserId: ctx.userId,
      action: "keywords.deleted",
      targetType: "Project",
      targetId: projectId,
      metadata: { count: result.count },
    });
  }
  return result.count;
}

export const SORTS = ["keyword", "position", "change", "best"] as const;
export type RankingSort = (typeof SORTS)[number];

export type RankingFilter = Page & {
  q?: string;
  tag?: string;
  bucket?: BucketKey | "unchecked";
  sort?: RankingSort;
  dir?: "asc" | "desc";
};

function whereFor(
  ctx: TenantContext,
  projectId: string,
  filter: RankingFilter,
): Prisma.KeywordWhereInput {
  const q = filter.q?.trim().slice(0, 100);
  const where: Prisma.KeywordWhereInput = { agencyId: ctx.agencyId, projectId };
  if (q) where.phrase = { contains: q.toLowerCase() };
  if (filter.tag) where.tags = { has: filter.tag.trim().toLowerCase().slice(0, 30) };
  if (filter.bucket === "unchecked") where.lastCheckedOn = null;
  else if (filter.bucket === "none")
    Object.assign(where, { lastCheckedOn: { not: null }, currentPosition: null });
  else if (filter.bucket) {
    const bucket = BUCKETS.find((b) => b.key === filter.bucket);
    if (bucket) where.currentPosition = { gte: bucket.min, lte: bucket.max };
  }
  return where;
}

function orderFor(filter: RankingFilter): Prisma.KeywordOrderByWithRelationInput[] {
  const dir = filter.dir === "desc" ? "desc" : "asc";
  switch (filter.sort) {
    case "position":
      return [{ currentPosition: { sort: dir, nulls: "last" } }, { phrase: "asc" }];
    case "change":
      // Best improvements first by default.
      return [
        { changeWeek: { sort: filter.dir === "asc" ? "asc" : "desc", nulls: "last" } },
        { phrase: "asc" },
      ];
    case "best":
      return [{ bestPosition: { sort: dir, nulls: "last" } }, { phrase: "asc" }];
    default:
      return [{ phrase: dir }, { id: "asc" }];
  }
}

const rankingSelect = {
  id: true,
  phrase: true,
  tags: true,
  targetUrl: true,
  lastCheckedOn: true,
  currentPosition: true,
  currentUrl: true,
  currentFeatures: true,
  bestPosition: true,
  changeDay: true,
  changeWeek: true,
  changeMonth: true,
} satisfies Prisma.KeywordSelect;

export async function listRankings(
  ctx: TenantContext,
  projectId: string,
  filter: RankingFilter = {},
) {
  requireView(ctx);
  await getProject(ctx, projectId);
  const where = whereFor(ctx, projectId, filter);
  const { take, skip } = paging({ pageSize: 50, ...filter });
  const [rows, total] = await Promise.all([
    db.keyword.findMany({ where, select: rankingSelect, orderBy: orderFor(filter), take, skip }),
    db.keyword.count({ where }),
  ]);
  return { rows, total };
}

export async function listProjectTags(ctx: TenantContext, projectId: string): Promise<string[]> {
  requireView(ctx);
  const rows = await db.keyword.findMany({
    where: { agencyId: ctx.agencyId, projectId, tags: { isEmpty: false } },
    select: { tags: true },
    take: 5000,
  });
  return [...new Set(rows.flatMap((r) => r.tags))].sort();
}

export const EXPORT_LIMIT = 10_000;

export async function listRankingsForExport(
  ctx: TenantContext,
  projectId: string,
  filter: RankingFilter = {},
) {
  requireView(ctx);
  await getProject(ctx, projectId);
  return db.keyword.findMany({
    where: whereFor(ctx, projectId, filter),
    select: rankingSelect,
    orderBy: orderFor(filter),
    take: EXPORT_LIMIT,
  });
}

export async function getKeywordDetail(
  ctx: TenantContext,
  projectId: string,
  keywordId: string,
  days = 90,
) {
  requireView(ctx);
  const project = await getProject(ctx, projectId);
  const keyword = await db.keyword.findFirst({
    where: { id: keywordId, agencyId: ctx.agencyId, projectId },
    select: rankingSelect,
  });
  if (!keyword) throw new NotFoundError("Keyword not found.");

  const limitDays = Math.min(Math.max(1, Math.floor(days)), 365);
  const since = new Date(Date.now() - limitDays * 86_400_000);
  const checks = await db.rankCheck.findMany({
    where: { agencyId: ctx.agencyId, keywordId, date: { gte: since } },
    select: { date: true, position: true, rankingUrl: true, topResults: true },
    orderBy: { date: "asc" },
    take: 400,
  });
  const latest = checks[checks.length - 1];
  return {
    project,
    keyword,
    history: checks.map((c) => ({ date: c.date.toISOString().slice(0, 10), position: c.position })),
    topResults: (latest?.topResults ?? []) as {
      position: number;
      domain: string;
      url: string;
      title: string;
    }[],
  };
}

export async function getProjectSummary(ctx: TenantContext, projectId: string) {
  requireView(ctx);
  await getProject(ctx, projectId);
  const keywords = await db.keyword.findMany({
    where: { agencyId: ctx.agencyId, projectId },
    select: {
      id: true,
      phrase: true,
      lastCheckedOn: true,
      currentPosition: true,
      changeWeek: true,
    },
    take: 5000,
  });
  const checked = keywords.filter((k) => k.lastCheckedOn !== null);
  const positions = checked.map((k) => k.currentPosition);
  const movers = checked.filter((k) => k.changeWeek !== null && k.changeWeek !== 0);
  const lastChecked = checked.reduce<Date | null>(
    (max, k) => (k.lastCheckedOn && (!max || k.lastCheckedOn > max) ? k.lastCheckedOn : max),
    null,
  );
  return {
    totalKeywords: keywords.length,
    checkedKeywords: checked.length,
    rankingKeywords: positions.filter((p) => p !== null).length,
    averagePosition: averagePosition(positions),
    visibility: visibilityScore(positions),
    distribution: distribution(positions),
    lastCheckedOn: lastChecked ? lastChecked.toISOString().slice(0, 10) : null,
    topGainers: [...movers]
      .filter((k) => (k.changeWeek ?? 0) > 0)
      .sort((a, b) => b.changeWeek! - a.changeWeek!)
      .slice(0, 5),
    topLosers: [...movers]
      .filter((k) => (k.changeWeek ?? 0) < 0)
      .sort((a, b) => a.changeWeek! - b.changeWeek!)
      .slice(0, 5),
  };
}
