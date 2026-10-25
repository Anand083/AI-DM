import type { ConnectionOptions, DefaultJobOptions } from "bullmq";

/** All queues (plan Step 8). */
export const QUEUES = [
  "rank-checks",
  "audits",
  "reports",
  "emails",
  "alerts",
  "provider-tasks",
  "maintenance",
  /** Weekly work of the extra modules: backlinks, competitors, AI visibility, reviews, search data. */
  "modules",
] as const;
export type QueueName = (typeof QUEUES)[number];

export const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;

/** 3 tries with growing waits, failed jobs are kept 7 days so they can be looked at. */
export const DEFAULT_JOB_OPTIONS: DefaultJobOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 5000 },
  removeOnFail: { age: SEVEN_DAYS_SECONDS },
};

/** Turns `redis://user:pass@host:6379/2` into options BullMQ accepts. */
export function redisConnectionOptions(url: string): ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : undefined,
    tls: u.protocol === "rediss:" ? {} : undefined,
    // BullMQ workers wait on Redis for a long time, so requests must not time out.
    maxRetriesPerRequest: null,
  };
}

/**
 * Job ids make a job safe to add twice: BullMQ ignores a second job with the same id.
 * BullMQ does not allow ":" in custom ids (and rejects ids that are only digits), so ids use "_".
 */
const safe = (part: string) => part.replace(/[^A-Za-z0-9_-]/g, "_");

export const jobIds = {
  rankCheck: (projectId: string, date: string) => `rank_${safe(projectId)}_${date}`,
  email: (key: string) => `email_${safe(key)}`,
  providerTask: (taskId: string) => `ptask_${safe(taskId)}`,
  digest: (agencyId: string, date: string) => `digest_${safe(agencyId)}_${date}`,
  auditRun: (auditId: string) => `audit_${safe(auditId)}_run`,
  auditPoll: (auditId: string, attempt: number) => `audit_${safe(auditId)}_poll_${attempt}`,
  auditAuto: (projectId: string, month: string) => `audit_auto_${safe(projectId)}_${month}`,
  agencyExport: (exportId: string) => `export_${safe(exportId)}`,
  report: (reportId: string) => `report_${safe(reportId)}`,
  competitorGap: (projectId: string, date: string) => `competitors_${safe(projectId)}_${date}`,
  backlinkRefresh: (projectId: string, date: string) => `backlinks_${safe(projectId)}_${date}`,
  maintenance: (name: string, date: string) => `maintenance_${safe(name)}_${date}`,
};
