import "server-only";
import type { Job } from "bullmq";
import { db, rawDb } from "@/server/db/client";
import { AppError } from "@/server/services/errors";
import { ProviderError } from "@/server/providers/seo/errors";
import { createAudit } from "@/server/services/audits";
import { failAudit, pollAudit, runAuditStart } from "@/server/services/audit-runner";
import { runAuditScheduler } from "@/server/jobs/system/audit-scheduler";
import { runProjectRankCheck } from "@/server/services/rank-checks";
import { getSeoGateway } from "@/server/services/seo-gateway-instance";
import { getEnv } from "@/env";
import { logger } from "@/server/logger";
import { NotImplementedError } from "@/server/providers/seo/errors";
import { getProviderByName } from "@/server/providers/seo";
import { DataForSeoProvider } from "@/server/providers/seo/dataforseo";
import { getBudget } from "@/server/services/budget-instance";
import { pollProviderTasks, processProviderTask } from "@/server/services/provider-tasks";
import { getEmailProvider } from "@/server/providers/email";
import type { EmailJobData } from "@/server/jobs/enqueue";
import {
  enqueueAuditPoll,
  enqueueAutoAudit,
  enqueueDigest,
  enqueueEmail,
  enqueueProcessTask,
  enqueueRankCheck,
} from "@/server/jobs/enqueue";
import { generateReport } from "@/server/services/report-generator";
import { runDigestScheduler, sendDigest } from "@/server/services/alert-digest";
import type { JobProcessors } from "@/server/jobs/runtime";
import { purgeExpired } from "@/server/jobs/system/purge";
import { runRankCheckScheduler } from "@/server/jobs/system/scheduler";

type RankJobData = { projectId: string; agencyId: string; date: string; keywordIds?: string[] };

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
        const audits = await runAuditScheduler({
          db: rawDb,
          now: new Date(),
          enqueue: enqueueAutoAudit,
          paused: async () => budget.state === "paused",
        });
        if (audits.queued > 0) logger.info(audits, "monthly audits queued");
        const digests = await runDigestScheduler({
          db: rawDb,
          now: new Date(),
          enqueue: enqueueDigest,
        });
        if (digests.queued > 0) logger.info(digests, "daily digests queued");
        return { ...result, audits, digests };
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
  "rank-checks": async (job) => {
    const data = job.data as RankJobData;
    const live = job.name === "check-now";
    try {
      const result = await runProjectRankCheck(
        { db, gateway: getSeoGateway() },
        {
          projectId: data.projectId,
          agencyId: data.agencyId,
          date: data.date,
          priority: live ? "live" : "standard",
          keywordIds: data.keywordIds,
          onProgress: async (done, total) => {
            await job.updateProgress(total === 0 ? 100 : Math.round((done / total) * 100));
          },
        },
      );
      if (!result.projectActive)
        logger.info({ jobId: job.id }, "rank check skipped: project is not active");
      return result;
    } catch (error) {
      // Plan limits and the budget pause are not worth retrying. Tell the page and finish.
      if (error instanceof AppError) {
        logger.warn({ jobId: job.id, message: error.message }, "rank check stopped");
        return { error: error.message };
      }
      throw error;
    }
  },
  audits: async (job) => {
    const deps = { db, gateway: getSeoGateway(), enqueuePoll: enqueueAuditPoll };
    const data = job.data as {
      auditId?: string;
      agencyId: string;
      projectId?: string;
      attempt?: number;
    };
    try {
      switch (job.name) {
        case "run":
          return await runAuditStart(deps, { auditId: data.auditId!, agencyId: data.agencyId });
        case "poll":
          return await pollAudit(deps, {
            auditId: data.auditId!,
            agencyId: data.agencyId,
            attempt: data.attempt ?? 1,
          });
        case "auto":
          // The monthly audit. Plan limits or a running audit are not errors worth retrying.
          try {
            await createAudit({ agencyId: data.agencyId }, data.projectId!, null);
          } catch (error) {
            if (!(error instanceof AppError)) throw error;
            logger.info(
              { projectId: data.projectId, message: error.message },
              "monthly audit skipped",
            );
          }
          return;
        default:
          logger.warn({ name: job.name }, "unknown audits job");
      }
    } catch (error) {
      if (!data.auditId) throw error;
      // Known problems end the audit now. Other problems are retried, and the audit is only
      // marked failed on the last try.
      if (error instanceof AppError || (error instanceof ProviderError && !error.retryable)) {
        await failAudit(db, data.agencyId, data.auditId, error.message);
        return { error: error.message };
      }
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
        await failAudit(
          db,
          data.agencyId,
          data.auditId,
          "The audit could not be completed. Please try again.",
        );
      }
      throw error;
    }
  },
  reports: async (job) => {
    if (job.name !== "generate") {
      logger.warn({ name: job.name }, "unknown reports job");
      return;
    }
    const { reportId, agencyId } = job.data as { reportId: string; agencyId: string };
    return generateReport(agencyId, reportId, {
      finalAttempt: job.attemptsMade + 1 >= (job.opts.attempts ?? 1),
    });
  },
  alerts: async (job) => {
    if (job.name !== "digest") {
      logger.warn({ name: job.name }, "unknown alerts job");
      return;
    }
    const { agencyId, date } = job.data as { agencyId: string; date: string };
    return sendDigest({
      db: rawDb,
      agencyId,
      date,
      now: new Date(),
      appUrl: getEnv().APP_URL,
      send: (email, key) => enqueueEmail(email, key),
    });
  },
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
