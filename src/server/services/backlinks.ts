import "server-only";
import type { Prisma } from "@prisma/client";
import { snapshotChange, type SuspiciousReason } from "@/lib/backlink-math";
import { anchorDistribution } from "@/lib/competitor-insights";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { enqueueBacklinkRefresh } from "@/server/jobs/enqueue";
import { ConflictError, ForbiddenError, LimitExceededError } from "./errors";
import { logActivity } from "./activity";
import { paging, type Page } from "./paging";
import { getProject } from "./projects";
import { getAgencyPlan, getBonusByMetric, getUsageByMetric } from "./usage";

/** Most links read in one weekly check. */
export const BACKLINK_WINDOW_MAX = 200;
/** Fewer than this and a check is not worth running. */
export const BACKLINK_WINDOW_MIN = 5;

const day = (d: Date) => d.toISOString().slice(0, 10);

function requireView(ctx: TenantContext): void {
  if (ctx.role === "CLIENT" || !can(ctx.role, "data.view")) throw new ForbiddenError();
}

/**
 * How many links the plan can still afford to read this month. One unit goes to the summary.
 * Throws when there is not enough left for a useful check.
 */
export async function backlinkWindow(agency: { agencyId: string }): Promise<number> {
  const plan = await getAgencyPlan(agency);
  if (plan.status === "EXPIRED" || plan.status === "CANCELED") {
    throw new LimitExceededError("Your subscription has ended. Choose a plan to continue.");
  }
  const planLimit = plan.limits.backlinkQueriesPerMonth;
  if (planLimit === -1) return BACKLINK_WINDOW_MAX;
  const [used, bonus] = await Promise.all([
    getUsageByMetric(agency, plan.period),
    getBonusByMetric(agency, plan.period),
  ]);
  const remaining = planLimit + (bonus.BACKLINK_QUERY ?? 0) - (used.BACKLINK_QUERY ?? 0) - 1;
  if (remaining < BACKLINK_WINDOW_MIN) {
    throw new LimitExceededError(
      `You have used the backlink lookups for this month on your ${plan.planName} plan. Upgrade your plan to get more.`,
    );
  }
  return Math.min(BACKLINK_WINDOW_MAX, remaining);
}

/** Asks for a backlink check now. The worker does the work; the page shows the result later. */
export async function requestBacklinkCheck(ctx: TenantContext, projectId: string) {
  if (!can(ctx.role, "tools.run")) throw new ForbiddenError();
  await getProject(ctx, projectId);
  const today = new Date();
  const done = await db.backlinkSnapshot.findFirst({
    where: { agencyId: ctx.agencyId, projectId, takenOn: new Date(`${day(today)}T00:00:00Z`) },
    select: { id: true },
  });
  if (done) throw new ConflictError("Backlinks were already checked today.");
  await backlinkWindow(ctx);
  const queued = await enqueueBacklinkRefresh({
    agencyId: ctx.agencyId,
    projectId,
    date: day(today),
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "backlinks.check_requested",
    targetType: "Project",
    targetId: projectId,
    metadata: {},
  });
  return { queued };
}

export type BacklinkFilter = "active" | "new" | "lost" | "suspicious";
export const BACKLINK_FILTERS: readonly BacklinkFilter[] = ["active", "new", "lost", "suspicious"];

export async function getBacklinkOverview(ctx: TenantContext, projectId: string) {
  requireView(ctx);
  await getProject(ctx, projectId);
  const base = { agencyId: ctx.agencyId, projectId };
  const snapshots = await db.backlinkSnapshot.findMany({
    where: base,
    select: {
      takenOn: true,
      totalBacklinks: true,
      referringDomains: true,
      dofollowPercent: true,
      domainRating: true,
      newLinks: true,
      lostLinks: true,
    },
    orderBy: { takenOn: "desc" },
    take: 12,
  });
  const latest = snapshots[0] ?? null;
  const [stored, suspicious] = await Promise.all([
    db.backlink.count({ where: { ...base, lostAt: null } }),
    db.backlink.count({ where: { ...base, lostAt: null, suspicious: true } }),
  ]);
  const points = snapshots.map((s) => ({ ...s, takenOn: day(s.takenOn) }));
  return {
    latest: latest ? { ...latest, takenOn: day(latest.takenOn) } : null,
    change: snapshotChange(points),
    /** Newest first. */
    history: points,
    storedActive: stored,
    suspicious,
    checkedToday: latest ? day(latest.takenOn) === day(new Date()) : false,
  };
}

const linkSelect = {
  id: true,
  sourceUrl: true,
  sourceDomain: true,
  targetUrl: true,
  anchor: true,
  dofollow: true,
  sourceRating: true,
  firstSeen: true,
  lastSeen: true,
  lostAt: true,
  suspicious: true,
  suspiciousReasons: true,
} satisfies Prisma.BacklinkSelect;

async function filterWhere(
  ctx: TenantContext,
  projectId: string,
  filter: BacklinkFilter,
): Promise<Prisma.BacklinkWhereInput> {
  const base = { agencyId: ctx.agencyId, projectId };
  if (filter === "lost") return { ...base, lostAt: { not: null } };
  if (filter === "suspicious") return { ...base, lostAt: null, suspicious: true };
  if (filter === "new") {
    const previous = await db.backlinkSnapshot.findMany({
      where: base,
      select: { takenOn: true },
      orderBy: { takenOn: "desc" },
      take: 2,
    });
    // "New" means found since the check before the latest one. With a single check there is none.
    const since = previous[1]?.takenOn;
    return since ? { ...base, lostAt: null, firstSeen: { gt: since } } : { ...base, id: "none" };
  }
  return { ...base, lostAt: null };
}

export type BacklinkRow = Omit<
  Prisma.BacklinkGetPayload<{ select: typeof linkSelect }>,
  "suspiciousReasons"
> & { suspiciousReasons: SuspiciousReason[] };

/**
 * What kind of text the project's live links use (brand name, exact keyword, generic words,
 * web address...). Too many exact-keyword anchors can look unnatural to Google.
 */
export async function getAnchorDistribution(ctx: TenantContext, projectId: string) {
  requireView(ctx);
  const project = await getProject(ctx, projectId);
  const base = { agencyId: ctx.agencyId, projectId };
  const [links, keywords] = await Promise.all([
    db.backlink.findMany({
      where: { ...base, lostAt: null },
      select: { anchor: true },
      orderBy: { id: "asc" },
      take: 5000,
    }),
    db.keyword.findMany({ where: base, select: { phrase: true }, take: 2000 }),
  ]);
  const domainWord = project.domain.split(".")[0] ?? "";
  return anchorDistribution(
    links.map((l) => l.anchor),
    [project.name, project.client.name, project.domain, domainWord],
    keywords.map((k) => k.phrase),
  );
}

export async function listBacklinks(
  ctx: TenantContext,
  projectId: string,
  filter: BacklinkFilter,
  p: Page = {},
) {
  requireView(ctx);
  await getProject(ctx, projectId);
  const { take, skip } = paging({ pageSize: 25, ...p });
  const where = await filterWhere(ctx, projectId, filter);
  const [rows, total] = await Promise.all([
    db.backlink.findMany({
      where,
      select: linkSelect,
      orderBy: [{ firstSeen: "desc" }, { id: "asc" }],
      take,
      skip,
    }),
    db.backlink.count({ where }),
  ]);
  return { rows: rows as BacklinkRow[], total };
}

/** Everything for the CSV file, capped at the size of one check window. */
export async function listBacklinksForExport(
  ctx: TenantContext,
  projectId: string,
  filter: BacklinkFilter,
) {
  requireView(ctx);
  await getProject(ctx, projectId);
  const where = await filterWhere(ctx, projectId, filter);
  const rows = await db.backlink.findMany({
    where,
    select: linkSelect,
    orderBy: [{ firstSeen: "desc" }, { id: "asc" }],
    take: 5000,
  });
  return rows as BacklinkRow[];
}
