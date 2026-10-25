import "server-only";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { addDays } from "@/lib/google-metrics";
import {
  FLAG_LABELS,
  compareBeforeAfter,
  contentFlags,
  detectDecay,
  freshness,
  suggestInternalLinks,
  type BeforeAfter,
  type ContentFlag,
  type Freshness,
  type PageTraffic,
} from "@/lib/content";
import { dateText } from "@/lib/date-text";
import { cleanInspectionUrl } from "@/lib/url-inspection";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { logActivity } from "./activity";
import { ForbiddenError, LimitExceededError, NotFoundError, ValidationError } from "./errors";
import { paging, type Page } from "./paging";
import { getProject } from "./projects";
import { createTask } from "./tasks";
import { parseInput } from "./validation";

const day = (d: Date) => d.toISOString().slice(0, 10);
const dayDate = (v: string) => new Date(`${v}T00:00:00Z`);

function requireView(ctx: TenantContext): void {
  if (ctx.role === "CLIENT" || !can(ctx.role, "data.view")) throw new ForbiddenError();
}

/** The part of an address that identifies a page: its path, without a closing slash. */
export function pathKey(url: string): string {
  try {
    const p = new URL(url).pathname.replace(/\/+$/, "");
    return p === "" ? "/" : p;
  } catch {
    return url;
  }
}

export const INVENTORY_SORTS = ["issues", "words", "oldest", "links", "url"] as const;
export type InventorySort = (typeof INVENTORY_SORTS)[number];
export const INVENTORY_FILTERS = ["all", "decaying", "stale", "thin", "duplicate"] as const;
export type InventoryFilter = (typeof INVENTORY_FILTERS)[number];

type Loaded = {
  auditId: string;
  auditOn: string;
  traffic: Map<string, PageTraffic & { positionTenths: number | null }>;
  keywords: Map<string, { phrase: string; position: number | null }[]>;
  issueUrls: { thin: Set<string>; duplicate: Set<string> };
};

/** The latest finished audit with the saved traffic, tracked keywords and thin/duplicate flags by page. */
async function load(ctx: TenantContext, projectId: string): Promise<Loaded | null> {
  const base = { agencyId: ctx.agencyId, projectId };
  const audit = await db.audit.findFirst({
    where: { ...base, status: "COMPLETED" },
    select: { id: true, finishedAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  if (!audit) return null;
  const [rows, keywords, issues] = await Promise.all([
    db.searchBreakdown.findMany({
      where: { ...base, dimension: "PAGE" },
      select: { key: true, period: true, clicks: true, impressions: true, positionTenths: true },
      take: 600,
    }),
    db.keyword.findMany({
      where: base,
      select: { phrase: true, currentPosition: true, currentUrl: true, targetUrl: true },
      take: 5000,
    }),
    db.auditIssue.findMany({
      where: {
        agencyId: ctx.agencyId,
        auditId: audit.id,
        code: { in: ["thin_content", "duplicate_content"] },
      },
      select: { code: true, url: true },
      take: 20_000,
    }),
  ]);
  const traffic: Loaded["traffic"] = new Map();
  for (const r of rows.filter((x) => x.period === "NOW")) {
    traffic.set(pathKey(r.key), {
      clicks: r.clicks,
      impressions: r.impressions,
      clicksBefore: null,
      impressionsBefore: null,
      positionTenths: r.positionTenths,
    });
  }
  for (const r of rows.filter((x) => x.period === "BEFORE")) {
    const key = pathKey(r.key);
    const now = traffic.get(key) ?? {
      clicks: 0,
      impressions: 0,
      clicksBefore: null,
      impressionsBefore: null,
      positionTenths: null,
    };
    traffic.set(key, { ...now, clicksBefore: r.clicks, impressionsBefore: r.impressions });
  }
  const byPage = new Map<string, { phrase: string; position: number | null }[]>();
  for (const k of keywords) {
    for (const url of new Set([k.currentUrl, k.targetUrl].filter((u): u is string => !!u))) {
      const key = pathKey(url);
      byPage.set(key, [
        ...(byPage.get(key) ?? []),
        { phrase: k.phrase, position: k.currentPosition },
      ]);
    }
  }
  return {
    auditId: audit.id,
    auditOn: day(audit.finishedAt ?? audit.createdAt),
    traffic,
    keywords: byPage,
    issueUrls: {
      thin: new Set(issues.filter((i) => i.code === "thin_content").map((i) => pathKey(i.url))),
      duplicate: new Set(
        issues.filter((i) => i.code === "duplicate_content").map((i) => pathKey(i.url)),
      ),
    },
  };
}

export type InventoryRow = {
  url: string;
  title: string | null;
  statusCode: number;
  wordCount: number;
  issueCount: number;
  inlinks: number | null;
  lastModified: string | null;
  freshness: Freshness;
  clicks: number | null;
  clicksBefore: number | null;
  keywords: string[];
  flags: ContentFlag[];
};

function rowFor(
  p: {
    url: string;
    title: string | null;
    statusCode: number;
    wordCount: number;
    issueCount: number;
    inlinks: number | null;
    lastModified: Date | null;
  },
  l: Loaded,
  today: string,
): InventoryRow {
  const key = pathKey(p.url);
  const traffic = l.traffic.get(key) ?? null;
  const fresh = freshness(p.lastModified ? day(p.lastModified) : null, today);
  return {
    url: p.url,
    title: p.title,
    statusCode: p.statusCode,
    wordCount: p.wordCount,
    issueCount: p.issueCount,
    inlinks: p.inlinks,
    lastModified: p.lastModified ? day(p.lastModified) : null,
    freshness: fresh,
    clicks: traffic?.clicks ?? null,
    clicksBefore: traffic?.clicksBefore ?? null,
    keywords: (l.keywords.get(key) ?? []).slice(0, 3).map((k) => k.phrase),
    flags: contentFlags({
      traffic,
      freshness: fresh,
      thin: l.issueUrls.thin.has(key),
      duplicate: l.issueUrls.duplicate.has(key),
    }),
  };
}

/** Pages of the latest audit with traffic, freshness and flags. One page of up to 50 rows. */
export async function listContentInventory(
  ctx: TenantContext,
  projectId: string,
  options: Page & { sort?: InventorySort; filter?: InventoryFilter; q?: string } = {},
  today = new Date(),
) {
  requireView(ctx);
  await getProject(ctx, projectId);
  const l = await load(ctx, projectId);
  if (!l) return null;
  const { take, skip } = paging({ pageSize: 50, ...options });
  const q = options.q?.trim().slice(0, 200);
  const where: Prisma.AuditPageWhereInput = {
    agencyId: ctx.agencyId,
    auditId: l.auditId,
    ...(q ? { url: { contains: q, mode: "insensitive" } } : {}),
  };
  const filter = options.filter ?? "all";
  const todayText = day(today);
  const select = {
    url: true,
    title: true,
    statusCode: true,
    wordCount: true,
    issueCount: true,
    inlinks: true,
    lastModified: true,
  } as const;
  const all = await db.auditPage.findMany({
    where: { agencyId: ctx.agencyId, auditId: l.auditId },
    select,
    take: 500,
  });
  if (filter === "stale") {
    where.lastModified = { lt: dayDate(addDays(todayText, -365)) };
  } else if (filter !== "all") {
    // Flags that come from traffic or audit issues are matched by page path.
    const wanted =
      filter === "decaying"
        ? new Set([...l.traffic.entries()].filter(([, t]) => detectDecay(t)).map(([k]) => k))
        : l.issueUrls[filter];
    where.url = { in: all.filter((p) => wanted.has(pathKey(p.url))).map((p) => p.url) };
  }
  const orderBy: Prisma.AuditPageOrderByWithRelationInput[] =
    options.sort === "words"
      ? [{ wordCount: "asc" }, { url: "asc" }]
      : options.sort === "oldest"
        ? [{ lastModified: { sort: "asc", nulls: "last" } }, { url: "asc" }]
        : options.sort === "links"
          ? [{ inlinks: { sort: "asc", nulls: "last" } }, { url: "asc" }]
          : options.sort === "url"
            ? [{ url: "asc" }]
            : [{ issueCount: "desc" }, { url: "asc" }];
  const [pages, total] = await Promise.all([
    db.auditPage.findMany({ where, select, orderBy, take, skip }),
    db.auditPage.count({ where }),
  ]);
  const rows = pages.map((p) => rowFor(p, l, todayText));
  const allRows = all.map((p) => rowFor(p, l, todayText));
  const count = (flag: ContentFlag) => allRows.filter((r) => r.flags.includes(flag)).length;
  return {
    auditOn: l.auditOn,
    rows,
    total,
    summary: {
      pages: allRows.length,
      decaying: count("decaying"),
      stale: count("stale"),
      thin: count("thin"),
      duplicate: count("duplicate"),
      unknownAge: allRows.filter((r) => r.freshness === "unknown").length,
    },
  };
}

/** Everything for the CSV download (up to 500 pages), in the same columns as the table. */
export async function listContentForExport(
  ctx: TenantContext,
  projectId: string,
  today = new Date(),
) {
  const result = await listContentInventory(ctx, projectId, { pageSize: 100, sort: "url" }, today);
  if (!result) return [];
  const l = await load(ctx, projectId);
  const pages = await db.auditPage.findMany({
    where: { agencyId: ctx.agencyId, auditId: l!.auditId },
    select: {
      url: true,
      title: true,
      statusCode: true,
      wordCount: true,
      issueCount: true,
      inlinks: true,
      lastModified: true,
    },
    orderBy: { url: "asc" },
    take: 500,
  });
  return pages.map((p) => rowFor(p, l!, day(today)));
}

export type DecayRow = {
  url: string;
  clicks: number;
  clicksBefore: number;
  percent: number;
  lost: number;
  keywords: string[];
};

/** Pages that lost at least 30% of their Search Console clicks against the 28 days before, biggest loss first. */
export async function getDecayingPages(ctx: TenantContext, projectId: string): Promise<DecayRow[]> {
  requireView(ctx);
  await getProject(ctx, projectId);
  const base = { agencyId: ctx.agencyId, projectId, dimension: "PAGE" };
  const rows = await db.searchBreakdown.findMany({
    where: base,
    select: { key: true, period: true, clicks: true, impressions: true },
    take: 600,
  });
  const keywords = await db.keyword.findMany({
    where: { agencyId: ctx.agencyId, projectId },
    select: { phrase: true, currentUrl: true },
    take: 5000,
  });
  const before = new Map(rows.filter((r) => r.period === "BEFORE").map((r) => [r.key, r]));
  const now = new Map(rows.filter((r) => r.period === "NOW").map((r) => [r.key, r]));
  const out: DecayRow[] = [];
  for (const [key, b] of before) {
    const n = now.get(key);
    const decay = detectDecay({
      clicks: n?.clicks ?? 0,
      impressions: n?.impressions ?? 0,
      clicksBefore: b.clicks,
      impressionsBefore: b.impressions,
    });
    if (!decay) continue;
    out.push({
      url: key,
      clicks: n?.clicks ?? 0,
      clicksBefore: b.clicks,
      percent: decay.percent,
      lost: decay.lost,
      keywords: keywords
        .filter((k) => k.currentUrl && pathKey(k.currentUrl) === pathKey(key))
        .slice(0, 3)
        .map((k) => k.phrase),
    });
  }
  return out.sort((a, b) => b.lost - a.lost || a.url.localeCompare(b.url)).slice(0, 20);
}

/** Pages that could grow but get few internal links, with the pages best placed to link to them. */
export async function getLinkSuggestions(ctx: TenantContext, projectId: string) {
  requireView(ctx);
  await getProject(ctx, projectId);
  const l = await load(ctx, projectId);
  if (!l) return [];
  const pages = await db.auditPage.findMany({
    where: { agencyId: ctx.agencyId, auditId: l.auditId, statusCode: { lt: 400 } },
    select: { url: true, title: true, inlinks: true },
    take: 500,
  });
  return suggestInternalLinks(
    pages.map((p) => {
      const ks = l.keywords.get(pathKey(p.url)) ?? [];
      const growing = ks.filter((k) => k.position !== null && k.position >= 4 && k.position <= 20);
      return {
        url: p.url,
        title: p.title,
        inlinks: p.inlinks,
        keywords: (growing.length > 0 ? growing : ks).map((k) => k.phrase),
        growing: growing.length > 0,
      };
    }),
  );
}

const MAX_TASK_URLS = 20;
export const contentTasksSchema = z.object({
  urls: z.array(z.string().min(1).max(2000)).min(1, "Choose at least one page.").max(MAX_TASK_URLS),
});

/**
 * Makes one "refresh this page" task per chosen page, due in 14 days. The task text says why
 * (traffic lost, age, thin or duplicate text). A page that already has an open task is skipped.
 */
export async function createContentTasks(
  ctx: TenantContext,
  projectId: string,
  raw: unknown,
  today = new Date(),
) {
  if (!can(ctx.role, "content.edit")) throw new ForbiddenError();
  const input = parseInput(contentTasksSchema, raw);
  const project = await getProject(ctx, projectId);
  const l = await load(ctx, projectId);
  const todayText = day(today);
  let created = 0;
  let existing = 0;
  for (const raw of [...new Set(input.urls)]) {
    const url = cleanInspectionUrl(raw, project.domain);
    if (!url) throw new ValidationError("Choose pages of this website.");
    const key = pathKey(url);
    const title = `Refresh page: ${key}`.slice(0, 200);
    const open = await db.task.findFirst({
      where: { agencyId: ctx.agencyId, projectId, title, status: { not: "DONE" } },
      select: { id: true },
    });
    if (open) {
      existing++;
      continue;
    }
    const page = l
      ? await db.auditPage.findFirst({
          where: {
            agencyId: ctx.agencyId,
            auditId: l.auditId,
            url: { endsWith: key === "/" ? "/" : key },
          },
          select: {
            url: true,
            title: true,
            statusCode: true,
            wordCount: true,
            issueCount: true,
            inlinks: true,
            lastModified: true,
          },
        })
      : null;
    const row = page && l ? rowFor(page, l, todayText) : null;
    const traffic = l?.traffic.get(key) ?? null;
    const why: string[] = [];
    if (row) for (const f of row.flags) why.push(FLAG_LABELS[f]);
    const lines = [
      `Update this page so it ranks and converts better: ${url}`,
      why.length > 0 ? `Why: ${why.join(", ").toLowerCase()}.` : "",
      traffic?.clicksBefore != null
        ? `Clicks from Google: ${traffic.clicks} in the last 28 days, ${traffic.clicksBefore} in the 28 days before.`
        : "",
      row?.lastModified ? `Last updated: ${row.lastModified}.` : "",
      row ? `Words on the page: ${row.wordCount}.` : "",
      "When it is done, log the update on the Content tab to see the before and after.",
    ].filter(Boolean);
    await createTask(ctx, {
      title,
      description: lines.join("\n"),
      projectId,
      priority: row?.flags.includes("decaying") ? "HIGH" : "MEDIUM",
      dueOn: addDays(todayText, 14),
    });
    created++;
  }
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "content.tasks_created",
    targetType: "Project",
    targetId: projectId,
    metadata: { created, existing },
  });
  return { created, existing };
}

export const contentUpdateSchema = z.object({
  url: z.string().trim().min(1, "Enter the page address.").max(2000),
  updatedOn: dateText,
  note: z.string().trim().max(300).nullable().default(null),
});

/** Records that a page was updated, with its numbers just before, so the effect can be read later. */
export async function logContentUpdate(
  ctx: TenantContext,
  projectId: string,
  raw: unknown,
  today = new Date(),
) {
  if (!can(ctx.role, "content.edit")) throw new ForbiddenError();
  const input = parseInput(contentUpdateSchema, raw);
  const project = await getProject(ctx, projectId);
  const url = cleanInspectionUrl(input.url, project.domain);
  if (!url) {
    throw new ValidationError("Enter a full address of a page on this website.", {
      url: "Use an address on this website, starting with https://.",
    });
  }
  if (input.updatedOn > day(today)) {
    throw new ValidationError("The update day cannot be in the future.", {
      updatedOn: "Choose today or an earlier day.",
    });
  }
  if ((await db.contentUpdate.count({ where: { agencyId: ctx.agencyId, projectId } })) >= 500) {
    throw new LimitExceededError("You have logged 500 updates for this project.");
  }
  const l = await load(ctx, projectId);
  const traffic = l?.traffic.get(pathKey(url));
  const created = await db.contentUpdate.create({
    data: {
      agencyId: ctx.agencyId,
      projectId,
      url,
      updatedOn: dayDate(input.updatedOn),
      note: input.note,
      baselineClicks: traffic?.clicks ?? 0,
      baselineImpressions: traffic?.impressions ?? 0,
      baselinePositionTenths: traffic?.positionTenths ?? null,
      createdById: ctx.userId,
    },
    select: { id: true },
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "content.update_logged",
    targetType: "ContentUpdate",
    targetId: created.id,
    metadata: { projectId },
  });
  return { ...created, hadTraffic: traffic !== undefined };
}

export async function deleteContentUpdate(ctx: TenantContext, projectId: string, id: string) {
  if (!can(ctx.role, "content.delete")) throw new ForbiddenError();
  await getProject(ctx, projectId);
  const result = await db.contentUpdate.deleteMany({
    where: { id, agencyId: ctx.agencyId, projectId },
  });
  if (result.count === 0) throw new NotFoundError("Update not found.");
}

export type UpdateView = {
  id: string;
  url: string;
  updatedOn: string;
  note: string | null;
  baseline: { clicks: number; impressions: number };
  result: BeforeAfter;
};

/** Logged updates, newest first, each with the before and after of its page. */
export async function listContentUpdates(
  ctx: TenantContext,
  projectId: string,
  today = new Date(),
): Promise<UpdateView[]> {
  requireView(ctx);
  await getProject(ctx, projectId);
  const rows = await db.contentUpdate.findMany({
    where: { agencyId: ctx.agencyId, projectId },
    select: {
      id: true,
      url: true,
      updatedOn: true,
      note: true,
      baselineClicks: true,
      baselineImpressions: true,
      baselinePositionTenths: true,
    },
    orderBy: [{ updatedOn: "desc" }, { id: "desc" }],
    take: 50,
  });
  if (rows.length === 0) return [];
  const l = await load(ctx, projectId);
  return rows.map((r) => {
    const now = l?.traffic.get(pathKey(r.url));
    return {
      id: r.id,
      url: r.url,
      updatedOn: day(r.updatedOn),
      note: r.note,
      baseline: { clicks: r.baselineClicks, impressions: r.baselineImpressions },
      result: compareBeforeAfter(
        {
          clicks: r.baselineClicks,
          impressions: r.baselineImpressions,
          positionTenths: r.baselinePositionTenths,
        },
        now
          ? { clicks: now.clicks, impressions: now.impressions, positionTenths: now.positionTenths }
          : null,
        day(r.updatedOn),
        day(today),
      ),
    };
  });
}
