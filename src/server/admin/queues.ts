import "server-only";
import { QUEUES, type QueueName } from "@/server/jobs/config";
import { getQueue } from "@/server/jobs/queues";
import { logger } from "@/server/logger";
import { NotFoundError } from "@/server/services/errors";
import type { AdminContext } from "./guard";

export type QueueInfo = {
  name: QueueName;
  paused: boolean;
  counts: Record<"waiting" | "active" | "delayed" | "completed" | "failed", number>;
  failed: { id: string; name: string; reason: string; attempts: number; failedAt: string | null }[];
};

const MAX_FAILED_SHOWN = 20;

function assertQueue(name: string): QueueName {
  if (!(QUEUES as readonly string[]).includes(name)) throw new NotFoundError("Queue not found.");
  return name as QueueName;
}

/** Counts for every queue and the latest failed jobs with their errors. */
export async function listQueues(_admin: AdminContext): Promise<QueueInfo[]> {
  return Promise.all(
    QUEUES.map(async (name) => {
      const queue = getQueue(name);
      const [counts, paused, failed] = await Promise.all([
        queue.getJobCounts("waiting", "active", "delayed", "completed", "failed"),
        queue.isPaused(),
        queue.getFailed(0, MAX_FAILED_SHOWN - 1),
      ]);
      return {
        name,
        paused,
        counts: counts as QueueInfo["counts"],
        failed: failed.map((job) => ({
          id: String(job.id),
          name: job.name,
          reason: (job.failedReason ?? "").slice(0, 500),
          attempts: job.attemptsMade,
          failedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
        })),
      };
    }),
  );
}

async function findJob(queueName: string, jobId: string) {
  const queue = getQueue(assertQueue(queueName));
  const job = await queue.getJob(jobId);
  if (!job) throw new NotFoundError("Job not found.");
  return job;
}

export async function retryJob(admin: AdminContext, queueName: string, jobId: string) {
  const job = await findJob(queueName, jobId);
  await job.retry("failed");
  logger.info({ admin: admin.adminUserId, queueName, jobId }, "admin retried a job");
}

export async function removeJob(admin: AdminContext, queueName: string, jobId: string) {
  const job = await findJob(queueName, jobId);
  await job.remove();
  logger.info({ admin: admin.adminUserId, queueName, jobId }, "admin removed a job");
}

export async function setQueuePaused(admin: AdminContext, queueName: string, paused: boolean) {
  const queue = getQueue(assertQueue(queueName));
  if (paused) await queue.pause();
  else await queue.resume();
  logger.warn({ admin: admin.adminUserId, queueName, paused }, "admin changed a queue");
}
