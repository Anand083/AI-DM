import { Queue, Worker, type ConnectionOptions, type Job } from "bullmq";
import { DEFAULT_JOB_OPTIONS, QUEUES, type QueueName } from "./config";

export type Processor = (job: Job) => Promise<unknown>;
export type JobProcessors = Partial<Record<QueueName, Processor>>;

export type RuntimeOptions = {
  connection: ConnectionOptions;
  /** Redis key prefix. Tests use their own so they never touch real jobs. */
  prefix: string;
  processors: JobProcessors;
  concurrency: number;
  /** Only run these queues (default: all that have a processor). */
  queues?: readonly QueueName[];
  onFailed?: (queue: QueueName, job: Job | undefined, error: Error) => void;
  onCompleted?: (queue: QueueName, job: Job) => void;
};

/** Plain queue clients, used to add jobs and to read counts. */
export function createQueues(
  connection: ConnectionOptions,
  prefix: string,
  defaultJobOptions = DEFAULT_JOB_OPTIONS,
): Record<QueueName, Queue> {
  const queues = {} as Record<QueueName, Queue>;
  for (const name of QUEUES)
    queues[name] = new Queue(name, { connection, prefix, defaultJobOptions });
  return queues;
}

/**
 * Starts one BullMQ worker per queue. `shutdown()` stops taking new jobs, waits for jobs that
 * are running to finish, and then closes the connections.
 */
export function createWorkerRuntime(options: RuntimeOptions) {
  const workers: Worker[] = [];
  let shuttingDown: Promise<void> | undefined;

  function start(): void {
    for (const name of options.queues ?? QUEUES) {
      const processor = options.processors[name];
      if (!processor) continue;
      const worker = new Worker(name, (job) => processor(job), {
        connection: options.connection,
        prefix: options.prefix,
        concurrency: options.concurrency,
      });
      worker.on("failed", (job, error) => options.onFailed?.(name, job, error));
      worker.on("completed", (job) => options.onCompleted?.(name, job));
      // Without an error listener a Redis hiccup would crash the process.
      worker.on("error", (error) => options.onFailed?.(name, undefined, error));
      workers.push(worker);
    }
  }

  function shutdown(): Promise<void> {
    shuttingDown ??= (async () => {
      // close() waits for active jobs unless told to force.
      await Promise.all(workers.map((w) => w.close()));
    })();
    return shuttingDown;
  }

  return { start, shutdown, workers };
}
