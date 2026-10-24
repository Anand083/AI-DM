import "server-only";
import type { Prisma } from "@prisma/client";
import { projectSchema } from "@/lib/schemas/project";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { logActivity } from "./activity";
import { ConflictError, ForbiddenError, NotFoundError } from "./errors";
import { paging, type Page } from "./paging";
import { assertCountWithinLimit } from "./plan";
import { parseInput } from "./validation";

export type ProjectFilter = Page & { clientId?: string; q?: string };

function requireView(ctx: TenantContext): void {
  if (ctx.role === "CLIENT" || !can(ctx.role, "data.view")) throw new ForbiddenError();
}

function requireEdit(ctx: TenantContext): void {
  if (!can(ctx.role, "content.edit")) throw new ForbiddenError();
}

const projectSelect = {
  id: true,
  name: true,
  domain: true,
  locationCode: true,
  languageCode: true,
  device: true,
  rankCheckFrequency: true,
  autoAudit: true,
  createdAt: true,
  client: { select: { id: true, name: true, status: true } },
} satisfies Prisma.ProjectSelect;

export async function listProjects(ctx: TenantContext, filter: ProjectFilter = {}) {
  requireView(ctx);
  const q = filter.q?.trim().slice(0, 100);
  const where: Prisma.ProjectWhereInput = {
    agencyId: ctx.agencyId,
    deletedAt: null,
    client: { deletedAt: null },
    ...(filter.clientId ? { clientId: filter.clientId } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { domain: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const { take, skip } = paging(filter);
  const [rows, total] = await Promise.all([
    db.project.findMany({
      where,
      select: projectSelect,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take,
      skip,
    }),
    db.project.count({ where }),
  ]);
  return { rows, total };
}

export async function getProject(ctx: TenantContext, id: string) {
  requireView(ctx);
  const project = await db.project.findFirst({
    where: { id, agencyId: ctx.agencyId, deletedAt: null, client: { deletedAt: null } },
    select: projectSelect,
  });
  if (!project) throw new NotFoundError("Project not found.");
  return project;
}

async function assertDomainFree(
  ctx: TenantContext,
  clientId: string,
  domain: string,
  exceptId?: string,
) {
  const clash = await db.project.findFirst({
    where: {
      agencyId: ctx.agencyId,
      clientId,
      domain,
      deletedAt: null,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (clash) throw new ConflictError("This client already has a project for that domain.");
}

export async function createProject(ctx: TenantContext, clientId: string, rawInput: unknown) {
  requireEdit(ctx);
  const input = parseInput(projectSchema, rawInput);
  const client = await db.client.findFirst({
    where: { id: clientId, agencyId: ctx.agencyId, deletedAt: null },
    select: { id: true, status: true },
  });
  if (!client) throw new NotFoundError("Client not found.");
  if (client.status === "ARCHIVED")
    throw new ConflictError("This client is archived. Restore it before adding projects.");

  const current = await db.project.count({
    where: {
      agencyId: ctx.agencyId,
      deletedAt: null,
      client: { deletedAt: null, status: "ACTIVE" },
    },
  });
  await assertCountWithinLimit(ctx, "maxProjects", current);
  await assertDomainFree(ctx, clientId, input.domain);

  const project = await db.project.create({
    data: { agencyId: ctx.agencyId, clientId, ...input },
    select: { id: true, name: true },
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "project.created",
    targetType: "Project",
    targetId: project.id,
  });
  return project;
}

export async function updateProject(ctx: TenantContext, id: string, rawInput: unknown) {
  requireEdit(ctx);
  const input = parseInput(projectSchema, rawInput);
  const existing = await getProject(ctx, id);
  await assertDomainFree(ctx, existing.client.id, input.domain, id);
  const project = await db.project.update({
    where: { id, agencyId: ctx.agencyId },
    data: input,
    select: { id: true, name: true },
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "project.updated",
    targetType: "Project",
    targetId: id,
  });
  return project;
}

/** Soft delete: hidden now, purged after 30 days. */
export async function deleteProject(ctx: TenantContext, id: string) {
  if (!can(ctx.role, "content.delete")) throw new ForbiddenError();
  await getProject(ctx, id);
  await db.project.update({
    where: { id, agencyId: ctx.agencyId },
    data: { deletedAt: new Date() },
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "project.deleted",
    targetType: "Project",
    targetId: id,
  });
}
