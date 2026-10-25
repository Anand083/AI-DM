import "server-only";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { logActivity } from "./activity";
import { ForbiddenError, NotFoundError } from "./errors";
import { listReportCommentRows, portalCommentSchema } from "./portal-tasks";
import { parseInput } from "./validation";

/** Comments on a report, for the team. Clients write theirs in the portal. */
export async function listReportComments(ctx: TenantContext, reportId: string) {
  if (ctx.role === "CLIENT" || !can(ctx.role, "data.view")) throw new ForbiddenError();
  const report = await db.report.findFirst({
    where: { id: reportId, agencyId: ctx.agencyId },
    select: { id: true },
  });
  if (!report) throw new NotFoundError("Report not found.");
  return listReportCommentRows(ctx.agencyId, reportId, ctx.userId);
}

export async function addReportComment(ctx: TenantContext, reportId: string, raw: unknown) {
  if (!can(ctx.role, "content.edit")) throw new ForbiddenError();
  const input = parseInput(portalCommentSchema, raw);
  const report = await db.report.findFirst({
    where: { id: reportId, agencyId: ctx.agencyId },
    select: { id: true },
  });
  if (!report) throw new NotFoundError("Report not found.");
  await db.reportComment.create({
    data: { agencyId: ctx.agencyId, reportId, authorId: ctx.userId, body: input.body },
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "report.commented",
    targetType: "Report",
    targetId: reportId,
  });
}
