import "server-only";
import { createId } from "@paralleldrive/cuid2";
import {
  cleanFileName,
  detectAttachment,
  formatBytes,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_TASK,
} from "@/lib/attachments";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { getStorage } from "@/server/providers/storage";
import { logActivity } from "./activity";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors";

function requireView(ctx: TenantContext): void {
  if (ctx.role === "CLIENT" || !can(ctx.role, "data.view")) throw new ForbiddenError();
}
function requireEdit(ctx: TenantContext): void {
  if (!can(ctx.role, "content.edit")) throw new ForbiddenError();
}

async function mustFindTask(ctx: TenantContext, taskId: string) {
  const task = await db.task.findFirst({
    where: { id: taskId, agencyId: ctx.agencyId },
    select: { id: true },
  });
  if (!task) throw new NotFoundError("Task not found.");
}

export async function listAttachments(ctx: TenantContext, taskId: string) {
  requireView(ctx);
  await mustFindTask(ctx, taskId);
  return db.taskAttachment.findMany({
    where: { agencyId: ctx.agencyId, taskId },
    select: { id: true, name: true, contentType: true, bytes: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: MAX_ATTACHMENTS_PER_TASK + 5,
  });
}

/** Saves a file on a task after checking its size, count and what it really is. */
export async function addAttachment(
  ctx: TenantContext,
  taskId: string,
  file: { name: string; bytes: Buffer },
) {
  requireEdit(ctx);
  await mustFindTask(ctx, taskId);
  const fail = (message: string) => new ValidationError(message, { file: message });
  if (file.bytes.length === 0) throw fail("Choose a file to upload.");
  if (file.bytes.length > MAX_ATTACHMENT_BYTES)
    throw fail(`The file must be ${formatBytes(MAX_ATTACHMENT_BYTES)} or smaller.`);
  const name = cleanFileName(file.name);
  const kind = detectAttachment(file.bytes, name);
  if (!kind) throw fail("Use a PNG, JPG, WebP, GIF, PDF, TXT or CSV file.");
  const count = await db.taskAttachment.count({ where: { agencyId: ctx.agencyId, taskId } });
  if (count >= MAX_ATTACHMENTS_PER_TASK)
    throw new ConflictError(`A task can have up to ${MAX_ATTACHMENTS_PER_TASK} files.`);
  const storageKey = `tasks/${ctx.agencyId}/${taskId}/${createId()}.${kind.extension}`;
  await getStorage().put(storageKey, file.bytes, kind.contentType);
  try {
    const row = await db.taskAttachment.create({
      data: {
        agencyId: ctx.agencyId,
        taskId,
        name,
        contentType: kind.contentType,
        bytes: file.bytes.length,
        storageKey,
        uploadedById: ctx.userId,
      },
      select: { id: true, name: true },
    });
    await logActivity({
      agencyId: ctx.agencyId,
      actorUserId: ctx.userId,
      action: "task.file_added",
      targetType: "Task",
      targetId: taskId,
    });
    return row;
  } catch (error) {
    await getStorage().delete(storageKey);
    throw error;
  }
}

export async function readAttachment(ctx: TenantContext, taskId: string, attachmentId: string) {
  requireView(ctx);
  const row = await db.taskAttachment.findFirst({
    where: { id: attachmentId, taskId, agencyId: ctx.agencyId },
    select: { name: true, contentType: true, storageKey: true },
  });
  if (!row) throw new NotFoundError("File not found.");
  const stored = await getStorage().get(row.storageKey);
  if (!stored) throw new NotFoundError("File not found.");
  return { name: row.name, contentType: row.contentType, bytes: stored.bytes };
}

export async function deleteAttachment(ctx: TenantContext, taskId: string, attachmentId: string) {
  requireEdit(ctx);
  const row = await db.taskAttachment.findFirst({
    where: { id: attachmentId, taskId, agencyId: ctx.agencyId },
    select: { id: true, storageKey: true },
  });
  if (!row) throw new NotFoundError("File not found.");
  await db.taskAttachment.deleteMany({ where: { id: row.id, agencyId: ctx.agencyId } });
  await getStorage().delete(row.storageKey);
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "task.file_removed",
    targetType: "Task",
    targetId: taskId,
  });
}

/** Removes the stored files of a task that is being deleted. */
export async function removeTaskFiles(agencyId: string, taskId: string): Promise<void> {
  const rows = await db.taskAttachment.findMany({
    where: { agencyId, taskId },
    select: { storageKey: true },
    take: MAX_ATTACHMENTS_PER_TASK + 5,
  });
  for (const r of rows) await getStorage().delete(r.storageKey);
}
