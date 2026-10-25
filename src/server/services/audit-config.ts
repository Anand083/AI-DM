import "server-only";
import { z } from "zod";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { logActivity } from "./activity";
import { ForbiddenError } from "./errors";
import { getProject } from "./projects";
import { parseInput } from "./validation";

export const MAX_EXCLUDED_PATHS = 20;

export const auditConfigSchema = z.object({
  /** One address start per entry, for example /cart. A missing slash is added. */
  excludePaths: z
    .array(
      z
        .string()
        .trim()
        .min(1, "Write an address start such as /cart.")
        .max(100, "Keep each path under 100 characters.")
        .regex(/^[A-Za-z0-9/_\-.~%]+$/, "Use only letters, numbers and / _ - . in a path.")
        .transform((v) => (v.startsWith("/") ? v : `/${v}`)),
    )
    .max(MAX_EXCLUDED_PATHS, `Skip up to ${MAX_EXCLUDED_PATHS} paths.`)
    .default([]),
  respectRobots: z.boolean().default(true),
  mobile: z.boolean().default(false),
});
export type AuditConfigValues = z.output<typeof auditConfigSchema>;

export const DEFAULT_AUDIT_CONFIG: AuditConfigValues = {
  excludePaths: [],
  respectRobots: true,
  mobile: false,
};

/** The crawl settings of a project (the defaults when none were saved). */
export async function loadAuditConfig(agencyId: string, projectId: string) {
  const row = await db.auditConfig.findFirst({
    where: { agencyId, projectId },
    select: { excludePaths: true, respectRobots: true, mobile: true },
  });
  return row ?? DEFAULT_AUDIT_CONFIG;
}

export async function getAuditConfig(ctx: TenantContext, projectId: string) {
  if (ctx.role === "CLIENT" || !can(ctx.role, "data.view")) throw new ForbiddenError();
  await getProject(ctx, projectId);
  return loadAuditConfig(ctx.agencyId, projectId);
}

export async function saveAuditConfig(ctx: TenantContext, projectId: string, raw: unknown) {
  if (!can(ctx.role, "content.edit")) throw new ForbiddenError();
  const input = parseInput(auditConfigSchema, raw);
  await getProject(ctx, projectId);
  const excludePaths = [...new Set(input.excludePaths)].sort();
  await db.auditConfig.upsert({
    where: { projectId, agencyId: ctx.agencyId },
    create: {
      agencyId: ctx.agencyId,
      projectId,
      excludePaths,
      respectRobots: input.respectRobots,
      mobile: input.mobile,
    },
    update: { excludePaths, respectRobots: input.respectRobots, mobile: input.mobile },
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "audit.config-saved",
    targetType: "Project",
    targetId: projectId,
  });
}
