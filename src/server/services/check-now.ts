import "server-only";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { enqueueCheckNow, type CheckNowJobData } from "@/server/jobs/enqueue";
import { getQueue } from "@/server/jobs/queues";
import { ForbiddenError, NotFoundError } from "./errors";
import { getProject } from "./projects";
import { assertWithinLimit } from "./usage";

export const MAX_CHECK_NOW_KEYWORDS = 500;

/**
 * "Check now": a live rank check for a project (or some of its keywords). The plan limit for
 * live checks is checked first so people see the problem at once. The work runs in the worker.
 */
export async function requestCheckNow(
  ctx: TenantContext,
  projectId: string,
  keywordIds?: string[],
): Promise<{ jobId: string; keywords: number }> {
  if (!can(ctx.role, "tools.run")) throw new ForbiddenError();
  await getProject(ctx, projectId);

  const ids = keywordIds
    ?.filter((id) => typeof id === "string" && id.length <= 100)
    .slice(0, MAX_CHECK_NOW_KEYWORDS);
  const count = await db.keyword.count({
    where: { agencyId: ctx.agencyId, projectId, ...(ids ? { id: { in: ids } } : {}) },
  });
  if (count === 0) throw new NotFoundError("There are no keywords to check.");
  const units = Math.min(count, MAX_CHECK_NOW_KEYWORDS);
  await assertWithinLimit({ agencyId: ctx.agencyId }, "LIVE_CHECK", units);

  const data: CheckNowJobData = {
    projectId,
    agencyId: ctx.agencyId,
    userId: ctx.userId,
    date: new Date().toISOString().slice(0, 10),
    keywordIds: ids,
  };
  return { jobId: await enqueueCheckNow(data), keywords: units };
}

export type CheckNowStatus = {
  state: "waiting" | "running" | "done" | "failed";
  /** 0 to 100 */
  progress: number;
  error?: string;
};

/** Progress of a check-now job. Only the agency that started it can see it. */
export async function getCheckNowStatus(
  ctx: TenantContext,
  jobId: string,
): Promise<CheckNowStatus> {
  if (!can(ctx.role, "tools.run")) throw new ForbiddenError();
  if (typeof jobId !== "string" || jobId.length > 200) throw new NotFoundError();
  const job = await getQueue("rank-checks").getJob(jobId);
  if (!job || (job.data as CheckNowJobData).agencyId !== ctx.agencyId)
    throw new NotFoundError("Check not found.");

  const state = await job.getState();
  const progress = typeof job.progress === "number" ? job.progress : 0;
  if (state === "completed") {
    const result = job.returnvalue as { error?: string } | undefined;
    return result?.error
      ? { state: "failed", progress, error: result.error }
      : { state: "done", progress: 100 };
  }
  if (state === "failed") {
    return {
      state: "failed",
      progress,
      error: "The check could not be finished. Please try again.",
    };
  }
  return { state: state === "active" ? "running" : "waiting", progress };
}
