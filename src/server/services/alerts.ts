import "server-only";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { ForbiddenError, NotFoundError } from "./errors";
import { paging, type Page } from "./paging";

function requireView(ctx: TenantContext): void {
  if (ctx.role === "CLIENT" || !can(ctx.role, "data.view")) throw new ForbiddenError();
}

const alertSelect = {
  id: true,
  projectId: true,
  type: true,
  severity: true,
  title: true,
  body: true,
  data: true,
  readAt: true,
  createdAt: true,
} as const;

export async function listAlerts(ctx: TenantContext, filter: Page & { unreadOnly?: boolean } = {}) {
  requireView(ctx);
  const { take, skip } = paging({ pageSize: 25, ...filter });
  const where = { agencyId: ctx.agencyId, ...(filter.unreadOnly ? { readAt: null } : {}) };
  const [rows, total] = await Promise.all([
    db.alert.findMany({
      where,
      select: alertSelect,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take,
      skip,
    }),
    db.alert.count({ where }),
  ]);
  return { rows, total };
}

/** What the notification bell shows: how many are unread and the latest few. */
export async function getBellData(ctx: TenantContext) {
  requireView(ctx);
  const [unread, recent] = await Promise.all([
    db.alert.count({ where: { agencyId: ctx.agencyId, readAt: null } }),
    db.alert.findMany({
      where: { agencyId: ctx.agencyId },
      select: { id: true, title: true, severity: true, readAt: true, createdAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 5,
    }),
  ]);
  return { unread, recent };
}

export async function markAlertRead(ctx: TenantContext, alertId: string): Promise<void> {
  requireView(ctx);
  const result = await db.alert.updateMany({
    where: { id: alertId, agencyId: ctx.agencyId, readAt: null },
    data: { readAt: new Date() },
  });
  if (result.count === 0) {
    // Already read is fine; a missing alert (or another agency's) is not found.
    const exists = await db.alert.count({ where: { id: alertId, agencyId: ctx.agencyId } });
    if (exists === 0) throw new NotFoundError("Alert not found.");
  }
}

export async function markAllAlertsRead(ctx: TenantContext): Promise<number> {
  requireView(ctx);
  const result = await db.alert.updateMany({
    where: { agencyId: ctx.agencyId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}
