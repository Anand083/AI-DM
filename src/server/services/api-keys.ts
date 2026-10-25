import "server-only";
import { createApiKeySchema, generateApiKey, hashApiKey, keyPrefix } from "@/lib/api-keys";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db, rawDb } from "@/server/db/client";
import { logActivity } from "./activity";
import { ConflictError, ForbiddenError, NotFoundError } from "./errors";
import { parseInput } from "./validation";

const MAX_ACTIVE_KEYS = 20;

function requireManage(ctx: TenantContext): void {
  if (!can(ctx.role, "branding.edit")) throw new ForbiddenError();
}

export async function listApiKeys(ctx: TenantContext) {
  requireManage(ctx);
  return db.apiKey.findMany({
    where: { agencyId: ctx.agencyId },
    select: {
      id: true,
      name: true,
      prefix: true,
      scopes: true,
      lastUsedAt: true,
      revokedAt: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
  });
}

/** Makes a key. The full key is returned once and never stored. */
export async function createApiKey(ctx: TenantContext, rawInput: unknown) {
  requireManage(ctx);
  const input = parseInput(createApiKeySchema, rawInput);
  const active = await db.apiKey.count({ where: { agencyId: ctx.agencyId, revokedAt: null } });
  if (active >= MAX_ACTIVE_KEYS)
    throw new ConflictError(`You can have up to ${MAX_ACTIVE_KEYS} active keys. Revoke one first.`);
  const key = generateApiKey();
  const row = await db.apiKey.create({
    data: {
      agencyId: ctx.agencyId,
      name: input.name,
      prefix: keyPrefix(key),
      keyHash: hashApiKey(key),
      scopes: [...new Set(input.scopes)],
      createdById: ctx.userId,
    },
    select: { id: true },
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "apikey.created",
    targetType: "ApiKey",
    targetId: row.id,
  });
  return { id: row.id, key };
}

export async function revokeApiKey(ctx: TenantContext, id: string) {
  requireManage(ctx);
  const row = await db.apiKey.findFirst({
    where: { id, agencyId: ctx.agencyId },
    select: { id: true, revokedAt: true },
  });
  if (!row) throw new NotFoundError("Key not found.");
  if (row.revokedAt) return;
  await db.apiKey.update({
    where: { id, agencyId: ctx.agencyId },
    data: { revokedAt: new Date() },
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "apikey.revoked",
    targetType: "ApiKey",
    targetId: id,
  });
}

export type ApiPrincipal = { agencyId: string; keyId: string; scopes: string[] };

/**
 * Finds the agency a key belongs to. This is the one place that reads across agencies, because
 * the key is what tells us which agency it is. Revoked keys and agencies that are suspended,
 * deleted or read-only (trial over, unpaid) get nothing.
 */
export async function authenticateApiKey(
  key: string,
  now: Date = new Date(),
): Promise<ApiPrincipal | null> {
  const row = await rawDb.apiKey.findUnique({
    where: { keyHash: hashApiKey(key) },
    select: {
      id: true,
      agencyId: true,
      scopes: true,
      revokedAt: true,
      lastUsedAt: true,
      agency: {
        select: {
          status: true,
          deletedAt: true,
          subscription: { select: { status: true } },
        },
      },
    },
  });
  if (!row || row.revokedAt) return null;
  if (row.agency.status !== "ACTIVE" || row.agency.deletedAt) return null;
  const sub = row.agency.subscription?.status;
  if (sub === "EXPIRED" || sub === "CANCELED") return null;
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > 60_000) {
    await rawDb.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: now } });
  }
  return { agencyId: row.agencyId, keyId: row.id, scopes: row.scopes };
}
