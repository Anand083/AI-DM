import "server-only";
import { getEnv } from "@/env";
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

export type AuditJobData = { auditId: string; agencyId: string; attempt?: number };

/** Queues the first step of an audit: asking the provider to start crawling. */
export async function enqueueAuditRun(data: AuditJobData): Promise<void> {
  await getQueue("audits").add("run", data, { jobId: jobIds.auditRun(data.auditId) });
}

/** Queues the next progress check, 10 seconds from now by default. */
export async function enqueueAuditPoll(
  data: AuditJobData & { attempt: number },
  delayMs = getEnv().AUDIT_POLL_SECONDS * 1000,
): Promise<void> {
  await getQueue("audits").add("poll", data, {
    delay: delayMs,
    jobId: jobIds.auditPoll(data.auditId, data.attempt),
  });
}

/** Queues a monthly audit for a project. Returns false if it was already queued this month. */
export async function enqueueAutoAudit(data: {
  agencyId: string;
  projectId: string;
  month: string;
}): Promise<boolean> {
  const queue = getQueue("audits");
  const jobId = jobIds.auditAuto(data.projectId, data.month);
  if (await queue.getJob(jobId)) return false;
  await queue.add("auto", data, { jobId, attempts: 1 });
  return true;
}

/** Queues one project's weekly backlink check. Returns false if it was already queued for that date. */
export async function enqueueBacklinkRefresh(data: {
  agencyId: string;
  projectId: string;
  date: string;
}): Promise<boolean> {
  const queue = getQueue("modules");
  const jobId = jobIds.backlinkRefresh(data.projectId, data.date);
  if (await queue.getJob(jobId)) return false;
  await queue.add("backlinks", data, { jobId, attempts: 2 });
  return true;
}

/** Queues the daily alert digest for an agency. Returns false if it was already queued for that date. */
export async function enqueueDigest(data: { agencyId: string; date: string }): Promise<boolean> {
  const queue = getQueue("alerts");
  const jobId = jobIds.digest(data.agencyId, data.date);
  if (await queue.getJob(jobId)) return false;
  await queue.add("digest", data, { jobId, attempts: 2 });
  return true;
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

/** Queues the worker job that builds a report (data, summary and PDF). */
export async function enqueueReport(data: { reportId: string; agencyId: string }): Promise<void> {
  await getQueue("reports").add("generate", data, {
    jobId: jobIds.report(data.reportId),
    attempts: 2,
  });
}

/** Queues the worker job that builds an agency data export (a zip for the owner to download). */
export async function enqueueExport(data: { exportId: string; agencyId: string }): Promise<void> {
  await getQueue("maintenance").add("export:agency", data, {
    jobId: jobIds.agencyExport(data.exportId),
    attempts: 2,
  });
}
