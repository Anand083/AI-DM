import "server-only";
import type { EmailMessage } from "@/server/providers/email/types";
import { jobIds } from "./config";
import { getQueue } from "./queues";

export type EmailJobData = EmailMessage;

/**
 * Puts an email on the queue. The worker sends it, so web requests never wait for SMTP.
 * Give a `key` (for example "digest:<agency>:<date>") to make sure the same email is only queued once.
 */
export async function enqueueEmail(message: EmailJobData, key?: string): Promise<void> {
  await getQueue("emails").add("send", message, key ? { jobId: jobIds.email(key) } : undefined);
}

export type RankCheckJobData = { projectId: string; agencyId: string; date: string };

/** Queues one project's daily rank check. Returns false if it was already queued for that date. */
export async function enqueueRankCheck(data: RankCheckJobData): Promise<boolean> {
  const queue = getQueue("rank-checks");
  const jobId = jobIds.rankCheck(data.projectId, data.date);
  if (await queue.getJob(jobId)) return false;
  await queue.add("project", data, { jobId });
  return true;
}

/**
 * Queues the job that processes a finished provider task. If an earlier job for the same task
 * failed, it is replaced so the task is not stuck.
 */
export async function enqueueProcessTask(taskId: string): Promise<void> {
  const queue = getQueue("provider-tasks");
  const jobId = jobIds.providerTask(taskId);
  const existing = await queue.getJob(jobId);
  if (existing) {
    if ((await existing.getState()) !== "failed") return;
    await existing.remove();
  }
  await queue.add("process-task", { taskId }, { jobId });
}

export type CheckNowJobData = {
  projectId: string;
  agencyId: string;
  userId: string;
  date: string;
  keywordIds?: string[];
};

/** Queues a live ("check now") rank check and returns the job id the page can poll. */
export async function enqueueCheckNow(data: CheckNowJobData): Promise<string> {
  const jobId = `live_${data.projectId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  // A live check costs money, so it is tried once; the person can press the button again.
  await getQueue("rank-checks").add("check-now", data, { jobId, attempts: 1 });
  return jobId;
}
