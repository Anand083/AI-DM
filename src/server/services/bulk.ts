import "server-only";
import { z } from "zod";
import type { TenantContext } from "@/server/auth/tenant-context";
import { AppError, ForbiddenError } from "./errors";
import { setClientArchived } from "./clients";
import { updateTask } from "./tasks";
import { parseInput } from "./validation";

const ids = z
  .array(z.string().min(1).max(100))
  .min(1, "Select at least one.")
  .max(100, "Select up to 100.");

export const clientsBulkSchema = z.object({ ids, archived: z.boolean() });
export const bulkTasksSchema = z.object({
  ids,
  action: z.enum(["done", "high", "assign_me"]),
});

export type BulkResult = { done: number; failed: { id: string; message: string }[] };

async function each(list: string[], run: (id: string) => Promise<void>): Promise<BulkResult> {
  const result: BulkResult = { done: 0, failed: [] };
  for (const id of [...new Set(list)]) {
    try {
      await run(id);
      result.done++;
    } catch (error) {
      // No permission is not a problem with one row, so it stops the whole call.
      if (!(error instanceof AppError) || error instanceof ForbiddenError) throw error;
      result.failed.push({ id, message: error.message });
    }
  }
  return result;
}

/** Archives or restores several clients. Each one is checked on its own (plan limit, ownership). */
export async function bulkSetClientsArchived(
  ctx: TenantContext,
  raw: unknown,
): Promise<BulkResult> {
  const input = parseInput(clientsBulkSchema, raw);
  return each(input.ids, (id) => setClientArchived(ctx, id, input.archived));
}

/** Changes several tasks. Each one goes through the normal task update, so all rules apply. */
export async function bulkUpdateTasks(ctx: TenantContext, raw: unknown): Promise<BulkResult> {
  const input = parseInput(bulkTasksSchema, raw);
  const patch =
    input.action === "done"
      ? { status: "DONE" }
      : input.action === "high"
        ? { priority: "HIGH" }
        : { assigneeId: ctx.userId };
  return each(input.ids, async (id) => {
    await updateTask(ctx, id, patch);
  });
}
