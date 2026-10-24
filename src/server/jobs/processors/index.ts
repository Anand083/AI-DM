import "server-only";
import type { Job } from "bullmq";
import { rawDb } from "@/server/db/client";
import { logger } from "@/server/logger";
import { getEmailProvider } from "@/server/providers/email";
import type { EmailJobData } from "@/server/jobs/enqueue";
import { enqueueRankCheck } from "@/server/jobs/enqueue";
import type { JobProcessors } from "@/server/jobs/runtime";
import { purgeExpired } from "@/server/jobs/system/purge";
import { runRankCheckScheduler } from "@/server/jobs/system/scheduler";

/** Queues whose feature arrives in a later step. The job finishes and says so in the log. */
function placeholder(queue: string, step: string) {
  return async (job: Job) => {
    logger.info({ queue, jobId: job.id, name: job.name }, `${queue} processor is built in ${step}`);
  };
}

export const processors: JobProcessors = {
  emails: async (job: Job<EmailJobData>) => {
    await getEmailProvider().send(job.data);
  },
  maintenance: async (job) => {
    switch (job.name) {
      case "scheduler:rank-checks": {
        const result = await runRankCheckScheduler({
          db: rawDb,
          now: new Date(),
          enqueue: enqueueRankCheck,
        });
        logger.info(result, "rank check scheduler tick");
        return result;
      }
      case "purge:expired": {
        const result = await purgeExpired(rawDb);
        logger.info(result, "purged expired data");
        return result;
      }
      default:
        logger.warn({ name: job.name }, "unknown maintenance job");
    }
  },
  "rank-checks": placeholder("rank-checks", "Step 10"),
  audits: placeholder("audits", "Step 11"),
  reports: placeholder("reports", "Step 15"),
  alerts: placeholder("alerts", "Step 13"),
  "provider-tasks": placeholder("provider-tasks", "Step 8b"),
};
