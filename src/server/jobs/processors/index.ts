import "server-only";
import type { Job } from "bullmq";
import { db, rawDb } from "@/server/db/client";
import { AppError } from "@/server/services/errors";
import { ProviderError } from "@/server/providers/seo/errors";
import { createAudit } from "@/server/services/audits";
import { runAiVisibility } from "@/server/services/ai-runner";
import { runCompetitorGap } from "@/server/services/competitor-runner";
import { runBacklinkRefresh } from "@/server/services/backlink-runner";
import { backlinkWindow } from "@/server/services/backlinks";
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
  enqueueAiCheck,
  enqueueAutoAudit,
  enqueueBacklinkRefresh,
  enqueueDigest,
  enqueueEmail,
  enqueueProcessTask,
  enqueueRankCheck,
  enqueueReport,
} from "@/server/jobs/enqueue";
import { buildAgencyExport, purgeExpiredExports } from "@/server/services/data-export";
import { generateReport } from "@/server/services/report-generator";
import { runDigestScheduler, sendDigest } from "@/server/services/alert-digest";
import type { JobProcessors } from "@/server/jobs/runtime";
import { uploadLatestBackup } from "@/server/jobs/system/backup-upload";
import { S3StorageProvider } from "@/server/providers/storage/s3";
import { purgeExpired } from "@/server/jobs/system/purge";
import { runAiScheduler } from "@/server/jobs/system/ai-scheduler";
import { runBacklinkScheduler } from "@/server/jobs/system/backlink-scheduler";
import { runBillingTick } from "@/server/jobs/system/billing-tick";
import { runReportDispatcher } from "@/server/jobs/system/report-dispatcher";
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
        const backlinks = await runBacklinkScheduler({
          db: rawDb,
          now: new Date(),
          enqueue: enqueueBacklinkRefresh,
          paused: async () => budget.state === "paused",
        });
        if (backlinks.queued > 0) logger.info(backlinks, "weekly backlink checks queued");
        const aiChecks = await runAiScheduler({
          db: rawDb,
          now: new Date(),
          enqueue: enqueueAiCheck,
          paused: async () => budget.state === "paused",
        });
        if (aiChecks.queued > 0) logger.info(aiChecks, "weekly AI visibility checks queued");
        const digests = await runDigestScheduler({
          db: rawDb,
          now: new Date(),
          enqueue: enqueueDigest,
        });
        if (digests.queued > 0) logger.info(digests, "daily digests queued");
        const reports = await runReportDispatcher({
          db: rawDb,
          now: new Date(),
          enqueue: enqueueReport,
        });
        if (reports.created > 0) logger.info(reports, "scheduled reports queued");
        const billing = await runBillingTick({ db: rawDb, now: new Date() });
        if (billing.checked + billing.reminders > 0) logger.info(billing, "billing tick");
        return { ...result, audits, backlinks, aiChecks, digests, reports, billing };
      }
      case "export:agency": {
        const { exportId, agencyId } = job.data as { exportId: string; agencyId: string };
        return buildAgencyExport(agencyId, exportId, {
          finalAttempt: job.attemptsMade + 1 >= (job.opts.attempts ?? 1),
        });
      }
      case "purge:expired": {
        const result = { ...(await purgeExpired(rawDb)), exports: await purgeExpiredExports() };
        logger.info(result, "purged expired data");
        return result;
      }
      case "backup:upload": {
        const env = getEnv();
        const result = await uploadLatestBackup({
          db: rawDb,
          dir: env.BACKUP_DIR || undefined,
          storage: new S3StorageProvider(env.S3_BUCKET, env.AWS_REGION),
        });
        logger.info(result, "backup upload");
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
  modules: async (job) => {
    switch (job.name) {
      case "backlinks": {
        const data = job.data as { projectId: string; agencyId: string; date: string };
        try {
          const result = await runBacklinkRefresh(
            { db, gateway: getSeoGateway(), windowFor: (agencyId) => backlinkWindow({ agencyId }) },
            data,
          );
          logger.info({ jobId: job.id, ...result }, "backlink check");
          return result;
        } catch (error) {
          // Plan limits and the budget pause are not worth retrying.
          if (error instanceof AppError) {
            logger.warn({ jobId: job.id, message: error.message }, "backlink check stopped");
            return { error: error.message };
          }
          throw error;
        }
      }
      case "ai-visibility": {
        const data = job.data as { projectId: string; agencyId: string; date: string };
        try {
          const result = await runAiVisibility({ db, gateway: getSeoGateway() }, data);
          logger.info({ jobId: job.id, ...result }, "ai visibility check");
          return result;
        } catch (error) {
          if (error instanceof AppError) {
            logger.warn({ jobId: job.id, message: error.message }, "ai visibility stopped");
            return { error: error.message };
          }
          throw error;
        }
      }
      case "competitor-gap": {
        const data = job.data as { projectId: string; agencyId: string };
        try {
          const result = await runCompetitorGap({ db, gateway: getSeoGateway() }, data);
          logger.info({ jobId: job.id, ...result }, "competitor gap");
          return result;
        } catch (error) {
          if (error instanceof AppError) {
            logger.warn({ jobId: job.id, message: error.message }, "competitor gap stopped");
            return { error: error.message };
          }
          throw error;
        }
      }
      default:
        logger.warn({ name: job.name }, "unknown modules job");
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
