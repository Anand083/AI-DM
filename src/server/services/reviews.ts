import "server-only";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { ratingChange, starCounts } from "@/lib/reviews";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { enqueueReviewCheck } from "@/server/jobs/enqueue";
import { logActivity } from "./activity";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { paging, type Page } from "./paging";
import { getProject } from "./projects";
import { parseInput } from "./validation";

const HISTORY_POINTS = 12;
const day = (d: Date) => d.toISOString().slice(0, 10);

function requireView(ctx: TenantContext): void {
  if (ctx.role === "CLIENT" || !can(ctx.role, "data.view")) throw new ForbiddenError();
}
function requireEdit(ctx: TenantContext): void {
  if (!can(ctx.role, "content.edit")) throw new ForbiddenError();
}

export const businessSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Enter the business name.")
    .max(120, "Keep the name under 120 characters."),
  city: z.string().trim().max(80, "Keep the city under 80 characters.").optional(),
});

export async function getBusiness(ctx: TenantContext, projectId: string) {
  requireView(ctx);
  await getProject(ctx, projectId);
  return db.localBusiness.findFirst({
    where: { agencyId: ctx.agencyId, projectId },
    select: { id: true, name: true, city: true, lastCheckedOn: true },
  });
}

/** Links the business whose reviews are tracked, or changes it. */
export async function saveBusiness(ctx: TenantContext, projectId: string, raw: unknown) {
  requireEdit(ctx);
  const input = parseInput(businessSchema, raw);
  await getProject(ctx, projectId);
  const city = input.city?.trim() ? input.city.trim() : null;
  const existing = await db.localBusiness.findFirst({
    where: { agencyId: ctx.agencyId, projectId },
    select: { id: true, name: true },
  });
  if (existing) {
    await db.localBusiness.updateMany({
      where: { id: existing.id, agencyId: ctx.agencyId },
      data: { name: input.name, city },
    });
  } else {
    await db.localBusiness.create({
      data: { agencyId: ctx.agencyId, projectId, name: input.name, city },
    });
  }
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: existing ? "reviews.business_changed" : "reviews.business_linked",
    targetType: "Project",
    targetId: projectId,
    metadata: { name: input.name },
  });
}

/** Stops tracking reviews. The reviews already saved are deleted with the link. */
export async function unlinkBusiness(ctx: TenantContext, projectId: string) {
  requireEdit(ctx);
  await getProject(ctx, projectId);
  const business = await db.localBusiness.findFirst({
    where: { agencyId: ctx.agencyId, projectId },
    select: { id: true },
  });
  if (!business) throw new NotFoundError("No business is linked to this project.");
  await db.review.deleteMany({ where: { agencyId: ctx.agencyId, projectId } });
  await db.reviewSnapshot.deleteMany({ where: { agencyId: ctx.agencyId, projectId } });
  await db.localBusiness.deleteMany({ where: { id: business.id, agencyId: ctx.agencyId } });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "reviews.business_unlinked",
    targetType: "Project",
    targetId: projectId,
    metadata: {},
  });
}

/** Asks the worker to read the reviews now. */
export async function requestReviewCheck(ctx: TenantContext, projectId: string) {
  if (!can(ctx.role, "tools.run")) throw new ForbiddenError();
  await getProject(ctx, projectId);
  const business = await db.localBusiness.findFirst({
    where: { agencyId: ctx.agencyId, projectId },
    select: { lastCheckedOn: true },
  });
  if (!business) throw new ValidationError("Link a business first.");
  const today = day(new Date());
  if (business.lastCheckedOn && day(business.lastCheckedOn) === today) {
    throw new ConflictError("Reviews were already checked today.");
  }
  const queued = await enqueueReviewCheck({ agencyId: ctx.agencyId, projectId, date: today });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "reviews.check_requested",
    targetType: "Project",
    targetId: projectId,
    metadata: {},
  });
  return { queued };
}

export async function getReviewOverview(ctx: TenantContext, projectId: string) {
  requireView(ctx);
  await getProject(ctx, projectId);
  const base = { agencyId: ctx.agencyId, projectId };
  const rows = await db.reviewSnapshot.findMany({
    where: base,
    select: { takenOn: true, ratingTenths: true, reviewCount: true, newReviews: true },
    orderBy: { takenOn: "desc" },
    take: HISTORY_POINTS,
  });
  const history = rows.map((r) => ({ ...r, takenOn: day(r.takenOn) }));
  const stars = await db.review.groupBy({
    by: ["rating"],
    where: base,
    _count: { _all: true },
    orderBy: { rating: "asc" },
    take: 5,
  });
  const counts = starCounts(stars.flatMap((s) => Array<number>(s._count._all).fill(s.rating)));
  return {
    latest: history[0] ?? null,
    change: ratingChange(history),
    history,
    stars: counts,
    storedReviews: counts.reduce((a, b) => a + b, 0),
    checkedToday: history[0] ? history[0].takenOn === day(new Date()) : false,
  };
}

export type ReviewFilter = "all" | "low";
export const REVIEW_FILTERS: readonly ReviewFilter[] = ["all", "low"];

export async function listReviews(
  ctx: TenantContext,
  projectId: string,
  filter: ReviewFilter,
  p: Page = {},
) {
  requireView(ctx);
  await getProject(ctx, projectId);
  const { take, skip } = paging({ pageSize: 10, ...p });
  const where: Prisma.ReviewWhereInput = {
    agencyId: ctx.agencyId,
    projectId,
    ...(filter === "low" ? { rating: { lte: 2 } } : {}),
  };
  const [rows, total] = await Promise.all([
    db.review.findMany({
      where,
      select: {
        id: true,
        author: true,
        rating: true,
        text: true,
        publishedAt: true,
        firstSeenOn: true,
        suggestedReply: true,
      },
      orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
      take,
      skip,
    }),
    db.review.count({ where }),
  ]);
  return { rows, total };
}
