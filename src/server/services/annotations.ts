import "server-only";
import { z } from "zod";
import { dateText } from "@/lib/date-text";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { logActivity } from "./activity";
import { ForbiddenError, LimitExceededError, NotFoundError } from "./errors";
import { getProject } from "./projects";
import { parseInput } from "./validation";

export const ANNOTATION_KINDS = [
  { key: "CAMPAIGN", label: "Campaign" },
  { key: "ALGORITHM", label: "Google update" },
  { key: "SITE_CHANGE", label: "Site change" },
  { key: "OTHER", label: "Other" },
] as const;
const kinds = ANNOTATION_KINDS.map((k) => k.key) as [
  "CAMPAIGN",
  ...("ALGORITHM" | "SITE_CHANGE" | "OTHER")[],
];

export const annotationSchema = z.object({
  on: dateText,
  kind: z.enum(kinds, { message: "Choose a type." }),
  title: z
    .string()
    .trim()
    .min(3, "Write at least 3 characters.")
    .max(160, "Keep it under 160 characters."),
  /** Applies to every project of the agency (for example a Google update). */
  allProjects: z.boolean().default(false),
});

const day = (d: Date) => d.toISOString().slice(0, 10);

function requireView(ctx: TenantContext): void {
  if (ctx.role === "CLIENT" || !can(ctx.role, "data.view")) throw new ForbiddenError();
}

/** Notes that apply to the project or to all projects, newest first. */
export async function loadAnnotations(
  agencyId: string,
  projectId: string,
  range?: { start: string; end: string },
  take = 100,
) {
  const rows = await db.annotation.findMany({
    where: {
      agencyId,
      OR: [{ projectId }, { projectId: null }],
      ...(range
        ? {
            on: {
              gte: new Date(`${range.start}T00:00:00Z`),
              lte: new Date(`${range.end}T00:00:00Z`),
            },
          }
        : {}),
    },
    select: { id: true, on: true, kind: true, title: true, projectId: true },
    orderBy: [{ on: "desc" }, { id: "desc" }],
    take,
  });
  return rows.map((r) => ({
    id: r.id,
    on: day(r.on),
    kind: r.kind,
    title: r.title,
    allProjects: r.projectId === null,
  }));
}

export async function listAnnotations(ctx: TenantContext, projectId: string) {
  requireView(ctx);
  await getProject(ctx, projectId);
  return loadAnnotations(ctx.agencyId, projectId);
}

export async function createAnnotation(ctx: TenantContext, projectId: string, raw: unknown) {
  if (!can(ctx.role, "content.edit")) throw new ForbiddenError();
  const input = parseInput(annotationSchema, raw);
  await getProject(ctx, projectId);
  const count = await db.annotation.count({ where: { agencyId: ctx.agencyId } });
  if (count >= 2000)
    throw new LimitExceededError("You have reached 2000 notes. Delete old ones first.");
  const created = await db.annotation.create({
    data: {
      agencyId: ctx.agencyId,
      projectId: input.allProjects ? null : projectId,
      on: new Date(`${input.on}T00:00:00Z`),
      kind: input.kind,
      title: input.title,
      createdById: ctx.userId,
    },
    select: { id: true },
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "annotation.created",
    targetType: "Annotation",
    targetId: created.id,
    metadata: { projectId },
  });
  return created;
}

export async function deleteAnnotation(ctx: TenantContext, annotationId: string) {
  if (!can(ctx.role, "content.delete")) throw new ForbiddenError();
  const result = await db.annotation.deleteMany({
    where: { id: annotationId, agencyId: ctx.agencyId },
  });
  if (result.count === 0) throw new NotFoundError("Note not found.");
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "annotation.deleted",
    targetType: "Annotation",
    targetId: annotationId,
  });
}
