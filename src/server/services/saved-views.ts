import "server-only";
import { z } from "zod";
import { cleanViewParams, DASHBOARD_PARTS, isViewScope, VIEW_SCOPES } from "@/lib/saved-views";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { parseInput } from "./validation";

const MAX_VIEWS = 20;

function requireView(ctx: TenantContext): void {
  if (ctx.role === "CLIENT" || !can(ctx.role, "data.view")) throw new ForbiddenError();
}

export const savedViewSchema = z.object({
  scope: z.enum(
    Object.keys(VIEW_SCOPES) as [keyof typeof VIEW_SCOPES, ...(keyof typeof VIEW_SCOPES)[]],
  ),
  name: z
    .string()
    .trim()
    .min(2, "Enter at least 2 characters.")
    .max(40, "Use 40 characters or fewer."),
  params: z.record(z.string(), z.unknown()),
});

/** The signed-in person's own saved views for one list. */
export async function listSavedViews(ctx: TenantContext, scope: string) {
  requireView(ctx);
  if (!isViewScope(scope)) return [];
  const rows = await db.savedView.findMany({
    where: { agencyId: ctx.agencyId, userId: ctx.userId, scope },
    select: { id: true, name: true, params: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: MAX_VIEWS,
  });
  return rows.map((r) => ({ id: r.id, name: r.name, params: cleanViewParams(scope, r.params) }));
}

export async function createSavedView(ctx: TenantContext, raw: unknown) {
  requireView(ctx);
  const input = parseInput(savedViewSchema, raw);
  const params = cleanViewParams(input.scope, input.params);
  if (Object.keys(params).length === 0)
    throw new ValidationError("Nothing to save.", {
      name: "Pick a filter or type a search first, then save the view.",
    });
  const count = await db.savedView.count({
    where: { agencyId: ctx.agencyId, userId: ctx.userId, scope: input.scope },
  });
  if (count >= MAX_VIEWS)
    throw new ConflictError(`You can save up to ${MAX_VIEWS} views. Delete one first.`);
  const row = await db.savedView.create({
    data: {
      agencyId: ctx.agencyId,
      userId: ctx.userId,
      scope: input.scope,
      name: input.name,
      params,
    },
    select: { id: true },
  });
  return row;
}

export async function deleteSavedView(ctx: TenantContext, id: string) {
  requireView(ctx);
  const result = await db.savedView.deleteMany({
    where: { id, agencyId: ctx.agencyId, userId: ctx.userId },
  });
  if (result.count === 0) throw new NotFoundError("Saved view not found.");
}

export const dashboardPrefSchema = z.object({ hidden: z.array(z.enum(DASHBOARD_PARTS)).max(10) });

export async function getHiddenDashboardParts(ctx: TenantContext): Promise<string[]> {
  requireView(ctx);
  const row = await db.dashboardPref.findFirst({
    where: { agencyId: ctx.agencyId, userId: ctx.userId },
    select: { hidden: true },
  });
  return row?.hidden ?? [];
}

export async function setHiddenDashboardParts(ctx: TenantContext, raw: unknown) {
  requireView(ctx);
  const input = parseInput(dashboardPrefSchema, raw);
  const hidden = [...new Set(input.hidden)];
  await db.dashboardPref.upsert({
    where: { agencyId_userId: { agencyId: ctx.agencyId, userId: ctx.userId } },
    create: { agencyId: ctx.agencyId, userId: ctx.userId, hidden },
    update: { hidden },
  });
}
