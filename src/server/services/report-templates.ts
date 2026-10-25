import "server-only";
import { z } from "zod";
import { REPORT_SECTION_KEYS, type ReportSectionKey } from "@/lib/report-model";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { logActivity } from "./activity";
import { ConflictError, ForbiddenError, LimitExceededError, NotFoundError } from "./errors";
import { parseInput } from "./validation";

export const templateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Write at least 2 characters.")
    .max(60, "Keep it under 60 characters."),
  sections: z
    .array(z.enum(REPORT_SECTION_KEYS as [ReportSectionKey, ...ReportSectionKey[]]))
    .min(1, "Choose at least one section.")
    .max(30),
  notes: z.string().trim().max(2000).nullable().default(null),
});

export async function listReportTemplates(ctx: TenantContext) {
  if (!can(ctx.role, "reports.create")) throw new ForbiddenError();
  return db.reportTemplate.findMany({
    where: { agencyId: ctx.agencyId },
    select: { id: true, name: true, sections: true, notes: true },
    orderBy: { name: "asc" },
    take: 50,
  });
}

export async function saveReportTemplate(ctx: TenantContext, raw: unknown) {
  if (!can(ctx.role, "reports.create")) throw new ForbiddenError();
  const input = parseInput(templateSchema, raw);
  const existing = await db.reportTemplate.findFirst({
    where: { agencyId: ctx.agencyId, name: input.name },
    select: { id: true },
  });
  if (!existing && (await db.reportTemplate.count({ where: { agencyId: ctx.agencyId } })) >= 50) {
    throw new LimitExceededError("You can save up to 50 templates.");
  }
  const sections = REPORT_SECTION_KEYS.filter((k) => input.sections.includes(k));
  try {
    const saved = existing
      ? await db.reportTemplate.update({
          where: { id: existing.id, agencyId: ctx.agencyId },
          data: { sections, notes: input.notes },
          select: { id: true },
        })
      : await db.reportTemplate.create({
          data: { agencyId: ctx.agencyId, name: input.name, sections, notes: input.notes },
          select: { id: true },
        });
    await logActivity({
      agencyId: ctx.agencyId,
      actorUserId: ctx.userId,
      action: "report-template.saved",
      targetType: "ReportTemplate",
      targetId: saved.id,
    });
    return saved;
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      throw new ConflictError("A template with that name exists.");
    }
    throw error;
  }
}

export async function deleteReportTemplate(ctx: TenantContext, id: string) {
  if (!can(ctx.role, "reports.create")) throw new ForbiddenError();
  const result = await db.reportTemplate.deleteMany({ where: { id, agencyId: ctx.agencyId } });
  if (result.count === 0) throw new NotFoundError("Template not found.");
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "report-template.deleted",
    targetType: "ReportTemplate",
    targetId: id,
  });
}
