"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withPortalAction } from "@/server/auth/portal-action";
import { answerApproval, commentOnReport, commentOnTask } from "@/server/services/portal-tasks";

const idSchema = z.string().min(1).max(100);

const comment = withPortalAction(
  z.object({ taskId: idSchema, values: z.unknown() }),
  (ctx, input) => commentOnTask(ctx, input.taskId, input.values),
);
const answer = withPortalAction(z.object({ taskId: idSchema, values: z.unknown() }), (ctx, input) =>
  answerApproval(ctx, input.taskId, input.values),
);
const reportComment = withPortalAction(
  z.object({ reportId: idSchema, values: z.unknown() }),
  (ctx, input) => commentOnReport(ctx, input.reportId, input.values),
);

export async function portalCommentAction(slug: string, taskId: string, values: unknown) {
  const result = await comment(slug, { taskId, values });
  if (result.ok) revalidatePath(`/portal/${slug}/tasks/${taskId}`);
  return result;
}
export async function portalAnswerAction(slug: string, taskId: string, values: unknown) {
  const result = await answer(slug, { taskId, values });
  if (result.ok) revalidatePath(`/portal/${slug}/tasks`, "layout");
  return result;
}
export async function portalReportCommentAction(slug: string, reportId: string, values: unknown) {
  const result = await reportComment(slug, { reportId, values });
  if (result.ok) revalidatePath(`/portal/${slug}/reports/${reportId}`);
  return result;
}
