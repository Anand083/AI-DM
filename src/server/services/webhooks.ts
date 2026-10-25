import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { getEnv } from "@/env";
import { checkWebhookUrl } from "@/lib/webhook";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { logActivity } from "./activity";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { parseInput } from "./validation";

const MAX_WEBHOOKS = 5;

export const webhookSchema = z.object({
  url: z.string().trim().min(1, "Enter the web address.").max(500),
  format: z.enum(["JSON", "SLACK"]),
});

function requireManage(ctx: TenantContext): void {
  if (!can(ctx.role, "branding.edit")) throw new ForbiddenError();
}

export async function listWebhooks(ctx: TenantContext) {
  requireManage(ctx);
  const hooks = await db.webhook.findMany({
    where: { agencyId: ctx.agencyId },
    select: {
      id: true,
      url: true,
      format: true,
      secret: true,
      enabled: true,
      failureStreak: true,
      lastError: true,
      lastDeliveryAt: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MAX_WEBHOOKS + 5,
  });
  const deliveries = hooks.length
    ? await db.webhookDelivery.findMany({
        where: { agencyId: ctx.agencyId, webhookId: { in: hooks.map((h) => h.id) } },
        select: {
          id: true,
          webhookId: true,
          event: true,
          status: true,
          httpStatus: true,
          error: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 30,
      })
    : [];
  return hooks.map((h) => ({
    ...h,
    // Slack addresses are secret; show only where they end.
    recent: deliveries.filter((d) => d.webhookId === h.id).slice(0, 5),
  }));
}

export async function createWebhook(ctx: TenantContext, rawInput: unknown) {
  requireManage(ctx);
  const input = parseInput(webhookSchema, rawInput);
  const checked = checkWebhookUrl(input.url, {
    allowLocalHttp: getEnv().NODE_ENV !== "production",
  });
  if (!checked.ok) throw new ValidationError(checked.message, { url: checked.message });
  const count = await db.webhook.count({ where: { agencyId: ctx.agencyId } });
  if (count >= MAX_WEBHOOKS)
    throw new ConflictError(`You can have up to ${MAX_WEBHOOKS} webhooks. Delete one first.`);
  const hook = await db.webhook.create({
    data: {
      agencyId: ctx.agencyId,
      url: checked.url,
      format: input.format,
      secret: randomBytes(24).toString("base64url"),
      createdById: ctx.userId,
    },
    select: { id: true },
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "webhook.created",
    targetType: "Webhook",
    targetId: hook.id,
  });
  return hook;
}

async function mustFind(ctx: TenantContext, id: string) {
  const hook = await db.webhook.findFirst({
    where: { id, agencyId: ctx.agencyId },
    select: { id: true },
  });
  if (!hook) throw new NotFoundError("Webhook not found.");
}

/** Turning it on again starts from now, so old alerts are not sent in a burst. */
export async function setWebhookEnabled(ctx: TenantContext, id: string, enabled: boolean) {
  requireManage(ctx);
  await mustFind(ctx, id);
  await db.webhook.update({
    where: { id, agencyId: ctx.agencyId },
    data: enabled
      ? { enabled: true, failureStreak: 0, lastError: null, cursorAt: new Date() }
      : { enabled: false },
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: enabled ? "webhook.enabled" : "webhook.disabled",
    targetType: "Webhook",
    targetId: id,
  });
}

export async function deleteWebhook(ctx: TenantContext, id: string) {
  requireManage(ctx);
  await mustFind(ctx, id);
  await db.webhook.delete({ where: { id, agencyId: ctx.agencyId } });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "webhook.deleted",
    targetType: "Webhook",
    targetId: id,
  });
}

/** Checks the webhook belongs to the agency before the worker sends a test message. */
export async function assertWebhookForTest(ctx: TenantContext, id: string) {
  requireManage(ctx);
  await mustFind(ctx, id);
}
