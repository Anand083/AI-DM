import "server-only";
import type { ClientStatus, Prisma } from "@prisma/client";
import { clientSchema } from "@/lib/schemas/client";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { logActivity } from "./activity";
import { ForbiddenError, NotFoundError } from "./errors";
import { paging, type Page } from "./paging";
import { assertCountWithinLimit } from "./plan";
import { parseInput } from "./validation";

export type ClientFilter = Page & { q?: string; status?: ClientStatus | "ALL" };

function requireView(ctx: TenantContext): void {
  // Client users get their own portal views in Step 17, not these agency lists.
  if (ctx.role === "CLIENT" || !can(ctx.role, "data.view")) throw new ForbiddenError();
}

function requireEdit(ctx: TenantContext): void {
  if (!can(ctx.role, "content.edit")) throw new ForbiddenError();
}

const activeClients = (ctx: TenantContext): Prisma.ClientWhereInput => ({
  agencyId: ctx.agencyId,
  deletedAt: null,
  status: "ACTIVE",
});

export async function listClients(ctx: TenantContext, filter: ClientFilter = {}) {
  requireView(ctx);
  const q = filter.q?.trim().slice(0, 100);
  const where: Prisma.ClientWhereInput = {
    agencyId: ctx.agencyId,
    deletedAt: null,
    ...(filter.status && filter.status !== "ALL" ? { status: filter.status } : {}),
    ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
  };
  const { take, skip } = paging(filter);
  const [rows, total] = await Promise.all([
    db.client.findMany({
      where,
      select: {
        id: true,
        name: true,
        website: true,
        status: true,
        createdAt: true,
        _count: { select: { projects: { where: { deletedAt: null } } } },
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take,
      skip,
    }),
    db.client.count({ where }),
  ]);
  return { rows, total };
}

export async function getClient(ctx: TenantContext, id: string) {
  requireView(ctx);
  const client = await db.client.findFirst({
    where: { id, agencyId: ctx.agencyId, deletedAt: null },
    select: {
      id: true,
      name: true,
      website: true,
      contactName: true,
      contactEmail: true,
      notes: true,
      status: true,
      createdAt: true,
    },
  });
  if (!client) throw new NotFoundError("Client not found.");
  return client;
}

export async function createClient(ctx: TenantContext, rawInput: unknown) {
  requireEdit(ctx);
  const input = parseInput(clientSchema, rawInput);
  const current = await db.client.count({ where: activeClients(ctx) });
  await assertCountWithinLimit(ctx, "maxClients", current);
  const client = await db.client.create({
    data: { agencyId: ctx.agencyId, ...input },
    select: { id: true, name: true },
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "client.created",
    targetType: "Client",
    targetId: client.id,
  });
  return client;
}

export async function updateClient(ctx: TenantContext, id: string, rawInput: unknown) {
  requireEdit(ctx);
  const input = parseInput(clientSchema, rawInput);
  await getClient(ctx, id);
  const client = await db.client.update({
    where: { id, agencyId: ctx.agencyId },
    data: {
      name: input.name,
      website: input.website ?? null,
      contactName: input.contactName ?? null,
      contactEmail: input.contactEmail ?? null,
      notes: input.notes ?? null,
    },
    select: { id: true, name: true },
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "client.updated",
    targetType: "Client",
    targetId: id,
  });
  return client;
}

/** Archived clients keep their data but stop counting against the plan and stop being checked. */
export async function setClientArchived(ctx: TenantContext, id: string, archived: boolean) {
  requireEdit(ctx);
  const client = await getClient(ctx, id);
  if ((client.status === "ARCHIVED") === archived) return;
  if (!archived) {
    const current = await db.client.count({ where: activeClients(ctx) });
    await assertCountWithinLimit(ctx, "maxClients", current);
  }
  await db.client.update({
    where: { id, agencyId: ctx.agencyId },
    data: { status: archived ? "ARCHIVED" : "ACTIVE" },
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: archived ? "client.archived" : "client.restored",
    targetType: "Client",
    targetId: id,
  });
}

/** Soft delete: the client and its projects are hidden now and purged after 30 days. */
export async function deleteClient(ctx: TenantContext, id: string) {
  if (!can(ctx.role, "content.delete")) throw new ForbiddenError();
  await getClient(ctx, id);
  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.project.updateMany({
      where: { agencyId: ctx.agencyId, clientId: id, deletedAt: null },
      data: { deletedAt: now },
    });
    await tx.client.update({ where: { id, agencyId: ctx.agencyId }, data: { deletedAt: now } });
    await logActivity(
      {
        agencyId: ctx.agencyId,
        actorUserId: ctx.userId,
        action: "client.deleted",
        targetType: "Client",
        targetId: id,
      },
      tx,
    );
  });
}
