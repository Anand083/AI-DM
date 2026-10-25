import "server-only";
import { z } from "zod";
import { addDays } from "@/lib/google-metrics";
import type { DimensionKey } from "@/lib/google-insights";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { loadAnnotations } from "./annotations";
import { cleanInspectionUrl } from "@/lib/url-inspection";
import { enqueueUrlInspection } from "@/server/jobs/enqueue";
import { ForbiddenError, LimitExceededError, ValidationError } from "./errors";
import { parseInput } from "./validation";
import { paging, type Page } from "./paging";
import { getProject } from "./projects";

const inspectionSchema = z.object({
  url: z.string().trim().min(1, "Enter a page address.").max(2000),
});
const day = (d: Date) => d.toISOString().slice(0, 10);
const dayDate = (value: string) => new Date(`${value}T00:00:00Z`);

function requireView(ctx: TenantContext): void {
  if (ctx.role === "CLIENT" || !can(ctx.role, "data.view")) throw new ForbiddenError();
}

/** A page of one Search Console top list (biggest clicks first) with the clicks of the 28 days before. */
export async function listSearchBreakdown(
  ctx: TenantContext,
  projectId: string,
  dimension: DimensionKey,
  p: Page = {},
) {
  requireView(ctx);
  await getProject(ctx, projectId);
  const { take, skip } = paging(p);
  const where = { agencyId: ctx.agencyId, projectId, dimension, period: "NOW" };
  const [rows, total] = await Promise.all([
    db.searchBreakdown.findMany({
      where,
      select: { key: true, clicks: true, impressions: true, positionTenths: true },
      orderBy: [{ clicks: "desc" }, { key: "asc" }],
      take,
      skip,
    }),
    db.searchBreakdown.count({ where }),
  ]);
  const before =
    rows.length === 0
      ? []
      : await db.searchBreakdown.findMany({
          where: {
            agencyId: ctx.agencyId,
            projectId,
            dimension,
            period: "BEFORE",
            key: { in: rows.map((r) => r.key) },
          },
          select: { key: true, clicks: true },
          take: rows.length,
        });
  const earlier = new Map(before.map((b) => [b.key, b.clicks]));
  return {
    items: rows.map((r) => ({ ...r, clicksBefore: earlier.get(r.key) })),
    total,
    page: Math.floor(skip / take) + 1,
    pageSize: take,
  };
}

/** Top landing pages from Google Analytics, most sessions first. */
export async function listLandingPages(ctx: TenantContext, projectId: string, p: Page = {}) {
  requireView(ctx);
  await getProject(ctx, projectId);
  const { take, skip } = paging(p);
  const where = { agencyId: ctx.agencyId, projectId };
  const [items, total] = await Promise.all([
    db.ga4Page.findMany({
      where,
      select: { path: true, sessions: true, engagedSessions: true, conversions: true },
      orderBy: [{ sessions: "desc" }, { path: "asc" }],
      take,
      skip,
    }),
    db.ga4Page.count({ where }),
  ]);
  return { items, total, page: Math.floor(skip / take) + 1, pageSize: take };
}

export type CombinedDay = {
  date: string;
  /** Average position of the tracked keywords checked that day. Null when none were checked. */
  averagePosition: number | null;
  clicks: number | null;
  sessions: number | null;
  conversions: number | null;
  notes: string[];
};

/**
 * Rankings, search clicks, visits and conversions side by side for the last `days` days that
 * have any data, newest first, with the timeline notes of each day. A source without a number
 * for a day shows nothing (null), never a zero.
 */
export async function getCombinedDaily(
  ctx: TenantContext,
  projectId: string,
  days = 28,
): Promise<CombinedDay[]> {
  requireView(ctx);
  await getProject(ctx, projectId);
  const base = { agencyId: ctx.agencyId, projectId };
  const [newest] = await Promise.all([
    Promise.all([
      db.searchConsoleDay.findFirst({
        where: base,
        select: { date: true },
        orderBy: { date: "desc" },
      }),
      db.ga4Day.findFirst({ where: base, select: { date: true }, orderBy: { date: "desc" } }),
      db.rankCheck.findFirst({
        where: { agencyId: ctx.agencyId, keyword: { projectId } },
        select: { date: true },
        orderBy: { date: "desc" },
      }),
    ]),
  ]);
  const ends = newest.filter((x) => x !== null).map((x) => day(x!.date));
  if (ends.length === 0) return [];
  const end = ends.sort().at(-1)!;
  const start = addDays(end, -(days - 1));
  const range = { gte: dayDate(start), lte: dayDate(end) };

  const [search, ga, ranks, notes] = await Promise.all([
    db.searchConsoleDay.findMany({
      where: { ...base, date: range },
      select: { date: true, clicks: true },
      take: days,
    }),
    db.ga4Day.findMany({
      where: { ...base, date: range },
      select: { date: true, sessions: true, conversions: true },
      take: days,
    }),
    db.rankCheck.groupBy({
      by: ["date"],
      where: { agencyId: ctx.agencyId, keyword: { projectId }, date: range },
      _avg: { position: true },
      orderBy: { date: "desc" },
      take: days,
    }),
    loadAnnotations(ctx.agencyId, projectId, { start, end }, 200),
  ]);
  const searchBy = new Map(search.map((r) => [day(r.date), r.clicks]));
  const gaBy = new Map(ga.map((r) => [day(r.date), r]));
  const rankBy = new Map(ranks.map((r) => [day(r.date), r._avg.position]));
  const out: CombinedDay[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(end, -i);
    const g = gaBy.get(date);
    const rank = rankBy.get(date);
    out.push({
      date,
      averagePosition: rank == null ? null : Math.round(rank * 10) / 10,
      clicks: searchBy.get(date) ?? null,
      sessions: g?.sessions ?? null,
      conversions: g?.conversions ?? null,
      notes: notes.filter((n) => n.on === date).map((n) => n.title),
    });
  }
  return out;
}

const INSPECTIONS_PER_DAY = 20;

/** Asks the worker to check how Google sees one page. At most 20 pages a day per project. */
export async function requestUrlInspection(
  ctx: TenantContext,
  projectId: string,
  rawUrl: unknown,
  now = new Date(),
) {
  if (!can(ctx.role, "tools.run")) throw new ForbiddenError();
  const project = await getProject(ctx, projectId);
  const input = parseInput(inspectionSchema, { url: rawUrl });
  const url = cleanInspectionUrl(input.url, project.domain);
  if (!url) {
    throw new ValidationError("Enter a full address of a page on this website.", {
      url: "Use an address on this website, starting with https://.",
    });
  }
  const connection = await db.googleConnection.findFirst({
    where: { agencyId: ctx.agencyId, projectId },
    select: { status: true, gscSite: true },
  });
  if (!connection) throw new ValidationError("Connect Google first.");
  if (connection.status !== "ACTIVE") throw new ValidationError("Connect Google again first.");
  if (!connection.gscSite) throw new ValidationError("Choose a Search Console site first.");
  const startOfDay = new Date(`${day(now)}T00:00:00Z`);
  const today = await db.urlInspection.count({
    where: { agencyId: ctx.agencyId, projectId, inspectedAt: { gte: startOfDay } },
  });
  if (today >= INSPECTIONS_PER_DAY) {
    throw new LimitExceededError(
      `You can check up to ${INSPECTIONS_PER_DAY} pages a day for each project. Try again tomorrow.`,
    );
  }
  const queued = await enqueueUrlInspection({ agencyId: ctx.agencyId, projectId, url });
  return { queued, url };
}

/** The newest Google answers, most recent first. */
export async function listUrlInspections(ctx: TenantContext, projectId: string, p: Page = {}) {
  requireView(ctx);
  await getProject(ctx, projectId);
  const { take, skip } = paging({ pageSize: 10, ...p });
  const where = { agencyId: ctx.agencyId, projectId };
  const [rows, total] = await Promise.all([
    db.urlInspection.findMany({
      where,
      select: {
        url: true,
        inspectedAt: true,
        verdict: true,
        coverageState: true,
        robotsTxtState: true,
        lastCrawlTime: true,
        googleCanonical: true,
        userCanonical: true,
        mobileVerdict: true,
        richVerdict: true,
        richTypes: true,
      },
      orderBy: [{ inspectedAt: "desc" }, { url: "asc" }],
      take,
      skip,
    }),
    db.urlInspection.count({ where }),
  ]);
  return { items: rows, total, page: Math.floor(skip / take) + 1, pageSize: take };
}
