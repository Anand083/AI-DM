import "server-only";
import type { Job } from "bullmq";
import { rawDb } from "@/server/db/client";
import { getEnv } from "@/env";
import { logger } from "@/server/logger";
import { NotImplementedError } from "@/server/providers/seo/errors";
import { getProviderByName } from "@/server/providers/seo";
import { DataForSeoProvider } from "@/server/providers/seo/dataforseo";
import { getBudget } from "@/server/services/budget-instance";
import { pollProviderTasks, processProviderTask } from "@/server/services/provider-tasks";
import { getEmailProvider } from "@/server/providers/email";
import type { EmailJobData } from "@/server/jobs/enqueue";
import { enqueueProcessTask, enqueueRankCheck } from "@/server/jobs/enqueue";
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
        // Also the place where budget alerts are sent (80% and 100%).
        const budget = await getBudget().checkAndAlert();
        const result = await runRankCheckScheduler({
          db: rawDb,
          now: new Date(),
          enqueue: enqueueRankCheck,
          paused: async () => budget.state === "paused",
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
  "provider-tasks": async (job) => {
    switch (job.name) {
      case "poll": {
        const result = await pollProviderTasks({
          db: rawDb,
          enqueueProcess: enqueueProcessTask,
          mode: getEnv().DATAFORSEO_CALLBACK_MODE,
          readyIds: async (provider, operation) => {
            if (provider !== "dataforseo") return [];
            const impl = getProviderByName("dataforseo");
            return impl instanceof DataForSeoProvider ? impl.listReadyTaskIds(operation) : [];
          },
        });
        if (result.checked + result.requeued + result.gaveUp > 0)
          logger.info(result, "provider task poll");
        return result;
      }
      case "process-task": {
        const { taskId } = job.data as { taskId: string };
        return processProviderTask(
          {
            db: rawDb,
            // Fetching and storing real results is built in Step 8c / 10 / 11.
            fetchResult: async () => {
              throw new NotImplementedError("Fetching DataForSEO task results");
            },
            handlers: {},
          },
          taskId,
        );
      }
      default:
        logger.warn({ name: job.name }, "unknown provider-tasks job");
    }
  },
};
