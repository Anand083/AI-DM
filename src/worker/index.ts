import "@/server/load-env";
import { getEnv } from "@/env";
import { redisConnectionOptions } from "@/server/jobs/config";
import { processors } from "@/server/jobs/processors";
import { getQueue } from "@/server/jobs/queues";
import { createWorkerRuntime } from "@/server/jobs/runtime";
import { logger } from "@/server/logger";

/**
 * The background worker. Run it next to the web app:
 *   pnpm worker:dev
 * It runs jobs from every queue, plus two repeating jobs: the rank check scheduler (every
 * 15 minutes) and the daily clean-up.
 */
async function main(): Promise<void> {
  const env = getEnv();

  const runtime = createWorkerRuntime({
    connection: redisConnectionOptions(env.REDIS_URL),
    prefix: env.QUEUE_PREFIX,
    processors,
    concurrency: env.WORKER_CONCURRENCY,
    onFailed: (queue, job, error) =>
      logger.error({ queue, jobId: job?.id, attempt: job?.attemptsMade, err: error }, "job failed"),
    onCompleted: (queue, job) => logger.debug({ queue, jobId: job.id }, "job done"),
  });
  runtime.start();

  const maintenance = getQueue("maintenance");
  await maintenance.upsertJobScheduler(
    "rank-check-scheduler",
    { every: 15 * 60 * 1000 },
    { name: "scheduler:rank-checks", opts: { attempts: 1 } },
  );
  await maintenance.upsertJobScheduler(
    "purge-expired",
    { pattern: "0 2 * * *", tz: "UTC" },
    { name: "purge:expired", opts: { attempts: 1 } },
  );
  logger.info({ concurrency: env.WORKER_CONCURRENCY, prefix: env.QUEUE_PREFIX }, "worker started");

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "worker stopping, waiting for running jobs");
    await runtime.shutdown();
    await Promise.all(
      Object.values((await import("@/server/jobs/queues")).getQueues()).map((q) => q.close()),
    );
    logger.info("worker stopped");
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGINT", () => void stop("SIGINT"));
}

main().catch((error) => {
  logger.fatal({ err: error }, "worker crashed on start");
  process.exit(1);
});
