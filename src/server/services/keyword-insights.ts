import "server-only";
import { z } from "zod";
import { addDays } from "@/lib/google-metrics";
import { parseKeywordCsv } from "@/lib/keyword-import";
import { parseTags } from "@/lib/keyword-input";
import {
  buildPageMap,
  classifyIntent,
  clusterKeywords,
  explainRankChange,
  findCannibalization,
  opportunityScore,
  type ChangeReason,
  type SearchIntent,
} from "@/lib/keyword-insights";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { enqueueKeywordMetrics } from "@/server/jobs/enqueue";
import { logActivity } from "./activity";
import { loadAnnotations } from "./annotations";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { assertCountWithinLimit } from "./plan";
import { getProject } from "./projects";
import { parseInput } from "./validation";

const day = (d: Date) => d.toISOString().slice(0, 10);
const MAX_IDS = 1000;

function requireView(ctx: TenantContext): void {
  if (ctx.role === "CLIENT" || !can(ctx.role, "data.view")) throw new ForbiddenError();
}
function requireEdit(ctx: TenantContext): void {
  if (!can(ctx.role, "content.edit")) throw new ForbiddenError();
}

/** Asks the worker to read search volume, difficulty and Bing positions now. Once a day. */
export async function requestKeywordMetrics(ctx: TenantContext, projectId: string) {
  if (!can(ctx.role, "tools.run")) throw new ForbiddenError();
  await getProject(ctx, projectId);
  const count = await db.keyword.count({ where: { agencyId: ctx.agencyId, projectId } });
  if (count === 0) throw new ValidationError("Add some keywords first.");
  const queued = await enqueueKeywordMetrics({
    agencyId: ctx.agencyId,
    projectId,
    date: day(new Date()),
  });
  return { queued };
}

/** Everything the Keyword insights page shows, worked out from the saved keywords. */
export async function getKeywordInsights(ctx: TenantContext, projectId: string) {
  requireView(ctx);
  const project = await getProject(ctx, projectId);
  const base = { agencyId: ctx.agencyId, projectId };
  const keywords = await db.keyword.findMany({
    where: base,
    select: {
      id: true,
      phrase: true,
      currentPosition: true,
      currentUrl: true,
      targetUrl: true,
      lastCheckedOn: true,
      volume: true,
      difficulty: true,
      cpcMicros: true,
      metricsOn: true,
      bingPosition: true,
      bingCheckedOn: true,
    },
    orderBy: [{ phrase: "asc" }, { id: "asc" }],
    take: 5000,
  });

  const brand = [project.name, project.client.name, project.domain.split(".")[0] ?? ""];
  const rows = keywords.map((k) => ({
    ...k,
    intent: classifyIntent(k.phrase, brand),
    opportunity: opportunityScore({
      position: k.currentPosition,
      volume: k.volume,
      difficulty: k.difficulty,
    }),
  }));

  const intents: Record<SearchIntent, number> = {
    informational: 0,
    commercial: 0,
    transactional: 0,
    navigational: 0,
    local: 0,
  };
  for (const r of rows) intents[r.intent]++;

  const byPhrase = new Map(rows.map((r) => [r.phrase, r]));
  const clusters = clusterKeywords(rows.map((r) => r.phrase))
    .slice(0, 30)
    .map((c) => {
      const members = c.phrases.map((p) => byPhrase.get(p)!);
      const positions = members
        .map((m) => m.currentPosition)
        .filter((p): p is number => p !== null);
      return {
        name: c.name,
        phrases: c.phrases,
        volume: members.reduce((a, m) => a + (m.volume ?? 0), 0),
        averagePosition:
          positions.length === 0
            ? null
            : Math.round((positions.reduce((a, b) => a + b, 0) / positions.length) * 10) / 10,
      };
    });

  const opportunities = rows
    .filter((r) => r.opportunity !== null)
    .sort((a, b) => b.opportunity! - a.opportunity! || a.phrase.localeCompare(b.phrase))
    .slice(0, 20)
    .map((r) => ({
      phrase: r.phrase,
      position: r.currentPosition,
      volume: r.volume,
      difficulty: r.difficulty,
      opportunity: r.opportunity!,
      url: r.currentUrl,
    }));

  // Ranking addresses of the last 30 days, for phrases that rank in the top 50.
  const ranking = rows
    .filter((r) => r.currentPosition !== null && r.currentPosition <= 50)
    .slice(0, 1500);
  const since = new Date(Date.now() - 30 * 86_400_000);
  const checks =
    ranking.length === 0
      ? []
      : await db.rankCheck.findMany({
          where: {
            agencyId: ctx.agencyId,
            keywordId: { in: ranking.map((r) => r.id) },
            date: { gte: since },
          },
          select: { keywordId: true, rankingUrl: true },
          orderBy: { date: "asc" },
          take: 1500 * 31,
        });
  const history = new Map<string, (string | null)[]>();
  for (const c of checks)
    history.set(c.keywordId, [...(history.get(c.keywordId) ?? []), c.rankingUrl]);
  const cannibalization = findCannibalization(
    ranking.map((r) => ({
      phrase: r.phrase,
      position: r.currentPosition,
      currentUrl: r.currentUrl,
      urlHistory: history.get(r.id) ?? [],
    })),
  ).slice(0, 50);

  const withMetrics = rows.filter((r) => r.metricsOn !== null);
  const newest = (dates: (Date | null)[]) =>
    dates.reduce<Date | null>((m, d) => (d && (!m || d > m) ? d : m), null);
  return {
    total: rows.length,
    withVolume: rows.filter((r) => r.volume !== null).length,
    metricsOn: newest(withMetrics.map((r) => r.metricsOn)),
    bingOn: newest(rows.map((r) => r.bingCheckedOn)),
    intents,
    clusters,
    opportunities,
    cannibalization,
    pageMap: buildPageMap(
      rows.map((r) => ({
        targetUrl: r.targetUrl,
        currentUrl: r.currentUrl,
        position: r.currentPosition,
      })),
    ),
  };
}

export const bulkEditSchema = z.object({
  ids: z.array(z.string().min(1).max(100)).min(1, "Choose at least one keyword.").max(MAX_IDS),
  /** Tags typed as "brand, local". Added to every chosen keyword. */
  addTags: z.string().max(500).default(""),
  /** Tags typed as "brand, local". Taken off every chosen keyword. */
  removeTags: z.string().max(500).default(""),
  /** Missing: leave as it is. Empty text or null: remove the target page. */
  targetUrl: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .optional()
    .refine(
      (v) => v === undefined || v === null || v === "" || /^https?:\/\/\S+$/i.test(v),
      "Enter a full web address, like https://example.com/page.",
    ),
});

/** Adds or removes tags and sets the target page for many keywords at once. */
export async function bulkEditKeywords(ctx: TenantContext, projectId: string, raw: unknown) {
  requireEdit(ctx);
  const input = parseInput(bulkEditSchema, raw);
  await getProject(ctx, projectId);
  const add = parseTags(input.addTags);
  const remove = new Set(parseTags(input.removeTags));
  const touchesTarget = input.targetUrl !== undefined;
  if (add.length === 0 && remove.size === 0 && !touchesTarget) {
    throw new ValidationError("Choose something to change.");
  }
  const found = await db.keyword.findMany({
    where: { agencyId: ctx.agencyId, projectId, id: { in: input.ids } },
    select: { id: true, tags: true },
    take: MAX_IDS,
  });
  let changed = 0;
  for (const k of found) {
    const tags = [...new Set([...k.tags.filter((t) => !remove.has(t)), ...add])].slice(0, 10);
    const same = tags.length === k.tags.length && tags.every((t, i) => t === k.tags[i]);
    if (same && !touchesTarget) continue;
    await db.keyword.updateMany({
      where: { id: k.id, agencyId: ctx.agencyId, projectId },
      data: {
        ...(same ? {} : { tags }),
        ...(touchesTarget ? { targetUrl: input.targetUrl ? input.targetUrl : null } : {}),
      },
    });
    changed++;
  }
  if (changed > 0) {
    await logActivity({
      agencyId: ctx.agencyId,
      actorUserId: ctx.userId,
      action: "keywords.edited",
      targetType: "Project",
      targetId: projectId,
      metadata: { count: changed },
    });
  }
  return { changed, notFound: input.ids.length - found.length };
}

export const importSchema = z.object({ csv: z.string().max(1_000_000, "That file is too big.") });

export type ImportResult = {
  added: number;
  /** Already tracked: their tags and target page were updated if the file had them. */
  updated: number;
  problems: { line: number; message: string }[];
  truncated: boolean;
};

/**
 * Imports keywords from CSV text (columns keyword, tags, url). New phrases are added within the
 * plan limit. Phrases already tracked get the tags and target page from the file when it has them.
 * Bad lines are reported and skipped.
 */
export async function importKeywordsCsv(
  ctx: TenantContext,
  projectId: string,
  raw: unknown,
): Promise<ImportResult> {
  requireEdit(ctx);
  const input = parseInput(importSchema, raw);
  await getProject(ctx, projectId);
  const parsed = parseKeywordCsv(input.csv);
  if (parsed.rows.length === 0) {
    throw new ValidationError("No keywords found in the file.", {
      csv: "No keywords found. Use one keyword per line, or a keyword column.",
    });
  }
  const existing = await db.keyword.findMany({
    where: {
      agencyId: ctx.agencyId,
      projectId,
      phrase: { in: parsed.rows.map((r) => r.phrase) },
    },
    select: { id: true, phrase: true, tags: true },
    take: parsed.rows.length,
  });
  const known = new Map(existing.map((e) => [e.phrase, e]));
  const fresh = parsed.rows.filter((r) => !known.has(r.phrase));
  if (fresh.length > 0) {
    const current = await db.keyword.count({
      where: { agencyId: ctx.agencyId, project: { deletedAt: null } },
    });
    await assertCountWithinLimit(ctx, "maxKeywords", current, fresh.length);
    await db.keyword.createMany({
      data: fresh.map((r) => ({
        agencyId: ctx.agencyId,
        projectId,
        phrase: r.phrase,
        tags: r.tags,
        targetUrl: r.targetUrl,
      })),
      skipDuplicates: true,
    });
  }
  let updated = 0;
  for (const r of parsed.rows) {
    const old = known.get(r.phrase);
    if (!old || (r.tags.length === 0 && !r.targetUrl)) continue;
    const tags = [...new Set([...old.tags, ...r.tags])].slice(0, 10);
    await db.keyword.updateMany({
      where: { id: old.id, agencyId: ctx.agencyId, projectId },
      data: { tags, ...(r.targetUrl ? { targetUrl: r.targetUrl } : {}) },
    });
    updated++;
  }
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "keywords.imported",
    targetType: "Project",
    targetId: projectId,
    metadata: { added: fresh.length, updated },
  });
  return {
    added: fresh.length,
    updated,
    problems: parsed.problems.slice(0, 20),
    truncated: parsed.truncated,
  };
}

/**
 * Possible reasons a keyword moved in the last week or so, from its own checks, the timeline
 * notes, how the rest of the project moved and the latest audit. Null when it has no two checks
 * at least 5 days apart or it did not move by 3 places or more.
 */
export async function getRankingExplanation(
  ctx: TenantContext,
  projectId: string,
  keywordId: string,
): Promise<{
  from: number | null;
  to: number | null;
  since: string;
  until: string;
  reasons: ChangeReason[];
} | null> {
  requireView(ctx);
  await getProject(ctx, projectId);
  const keyword = await db.keyword.findFirst({
    where: { id: keywordId, agencyId: ctx.agencyId, projectId },
    select: { id: true, currentUrl: true },
  });
  if (!keyword) throw new NotFoundError("Keyword not found.");
  const checks = await db.rankCheck.findMany({
    where: { agencyId: ctx.agencyId, keywordId },
    select: { date: true, position: true, rankingUrl: true, serpFeatures: true },
    orderBy: { date: "desc" },
    take: 30,
  });
  const latest = checks[0];
  if (!latest) return null;
  const cutoff = addDays(day(latest.date), -5);
  const earlier = checks.find((c) => day(c.date) <= cutoff);
  if (!earlier) return null;
  const moved = Math.abs((latest.position ?? 101) - (earlier.position ?? 101));
  if (moved < 3) return null;

  const since = day(earlier.date);
  const until = day(latest.date);
  const [notes, week, audit] = await Promise.all([
    loadAnnotations(
      ctx.agencyId,
      projectId,
      { start: addDays(since, -3), end: addDays(until, 1) },
      5,
    ),
    db.keyword.findMany({
      where: { agencyId: ctx.agencyId, projectId, changeWeek: { not: null } },
      select: { changeWeek: true },
      take: 5000,
    }),
    db.audit.findFirst({
      where: { agencyId: ctx.agencyId, projectId, status: "COMPLETED" },
      select: { id: true },
      orderBy: { finishedAt: "desc" },
    }),
  ]);
  const critical =
    audit && latest.rankingUrl
      ? (await db.auditIssue.count({
          where: {
            agencyId: ctx.agencyId,
            auditId: audit.id,
            severity: "CRITICAL",
            url: latest.rankingUrl,
          },
        })) > 0
      : false;
  const features = (value: unknown) =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  return {
    from: earlier.position,
    to: latest.position,
    since,
    until,
    reasons: explainRankChange({
      from: earlier.position,
      to: latest.position,
      urlBefore: earlier.rankingUrl,
      urlAfter: latest.rankingUrl,
      featuresBefore: features(earlier.serpFeatures),
      featuresAfter: features(latest.serpFeatures),
      notes: notes.map((n) => ({ on: n.on, kind: n.kind, title: n.title })),
      siteWide: {
        up: week.filter((k) => (k.changeWeek ?? 0) > 0).length,
        down: week.filter((k) => (k.changeWeek ?? 0) < 0).length,
        total: week.length,
      },
      criticalIssueOnPage: critical,
    }),
  };
}
