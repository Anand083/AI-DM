import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Tasks that a provider finishes later (DataForSEO `task_post`). A row in PendingProviderTask
 * follows each task: PENDING, then READY (provider says done), then PROCESSED (we stored the
 * result) or FAILED.
 *
 * This is system code: provider callbacks and the poll job have no user and no agency
 * context, so it works with the plain database client and looks tasks up by provider task id.
 */

export type TaskDb = Pick<PrismaClient, "pendingProviderTask">;

export type TaskDeps = {
  db: TaskDb;
  /** Adds the "process this task" job. Must ignore a second job with the same task id. */
  enqueueProcess: (taskId: string) => Promise<void>;
  now?: () => Date;
};

export type NewPendingTask = {
  agencyId: string;
  projectId?: string;
  provider: string;
  operation: string;
  providerTaskId: string;
  /** Our own job id, sent to the provider as `tag` and returned in the callback. */
  tag: string;
  requestHash?: string;
};

export async function registerPendingTask(db: TaskDb, task: NewPendingTask) {
  return db.pendingProviderTask.create({ data: task });
}

type TaskRow = { id: string; status: string };

/** Moves a PENDING task to READY and queues its processing. Returns false if it was not PENDING. */
async function markReady(
  deps: TaskDeps,
  task: TaskRow,
  result?: Prisma.InputJsonValue,
): Promise<boolean> {
  const now = (deps.now ?? (() => new Date()))();
  const claimed = await deps.db.pendingProviderTask.updateMany({
    where: { id: task.id, status: "PENDING" },
    data: { status: "READY", readyAt: now, ...(result === undefined ? {} : { result }) },
  });
  if (claimed.count !== 1) return false;
  await deps.enqueueProcess(task.id);
  return true;
}

export type CallbackOutcome = "queued" | "duplicate" | "unknown";

/**
 * A pingback only says "task X is ready". We never trust anything else in the request;
 * the processing job fetches the real result from the provider API.
 */
export async function receivePingback(
  deps: TaskDeps,
  providerTaskId: string,
): Promise<CallbackOutcome> {
  const task = await deps.db.pendingProviderTask.findUnique({
    where: { providerTaskId },
    select: { id: true, status: true },
  });
  if (!task) return "unknown";
  return (await markReady(deps, task)) ? "queued" : "duplicate";
}

type PostbackBody = { tasks?: { id?: unknown; result?: unknown; status_code?: unknown }[] };

/**
 * A postback carries the result itself. We only accept results for tasks we are waiting for
 * (status PENDING). A second delivery of the same task changes nothing.
 */
export async function receivePostback(
  deps: TaskDeps,
  body: unknown,
): Promise<{ queued: number; duplicate: number; unknown: number }> {
  const counts = { queued: 0, duplicate: 0, unknown: 0 };
  const tasks = (body as PostbackBody | null)?.tasks;
  if (!Array.isArray(tasks)) return counts;
  for (const item of tasks) {
    if (typeof item?.id !== "string") {
      counts.unknown++;
      continue;
    }
    const task = await deps.db.pendingProviderTask.findUnique({
      where: { providerTaskId: item.id },
      select: { id: true, status: true },
    });
    if (!task) {
      counts.unknown++;
    } else if (await markReady(deps, task, item as Prisma.InputJsonValue)) {
      counts.queued++;
    } else {
      counts.duplicate++;
    }
  }
  return counts;
}

export type ReadyChecker = (provider: string, operation: string) => Promise<string[]>;

export type PollDeps = TaskDeps & {
  readyIds: ReadyChecker;
  /** "poll": ask about every pending task. Other modes: only tasks that are overdue. */
  mode: "poll" | "pingback" | "postback";
  staleAfterMinutes?: number;
  /** Tasks pending longer than this are given up on. */
  giveUpAfterHours?: number;
  batchSize?: number;
};

/**
 * The poll job. It (1) re-queues tasks that are READY but were never processed,
 * (2) asks the provider which pending tasks are done, and (3) gives up on very old tasks.
 * In callback modes step 2 only looks at tasks pending for more than 30 minutes, which
 * catches callbacks that never arrived.
 */
export async function pollProviderTasks(deps: PollDeps) {
  const now = (deps.now ?? (() => new Date()))();
  const batch = deps.batchSize ?? 500;
  const staleMs = (deps.staleAfterMinutes ?? 30) * 60_000;
  const giveUpMs = (deps.giveUpAfterHours ?? 24) * 3_600_000;
  const summary = { requeued: 0, markedReady: 0, gaveUp: 0, checked: 0 };

  // 1. READY but not processed: the processing job was lost. Queue it again (same job id).
  const ready = await deps.db.pendingProviderTask.findMany({
    where: { status: "READY" },
    select: { id: true },
    orderBy: { readyAt: "asc" },
    take: batch,
  });
  for (const task of ready) {
    await deps.enqueueProcess(task.id);
    summary.requeued++;
  }

  // 2. PENDING: ask the provider.
  const pendingWhere: Prisma.PendingProviderTaskWhereInput = {
    status: "PENDING",
    ...(deps.mode === "poll" ? {} : { createdAt: { lt: new Date(now.getTime() - staleMs) } }),
  };
  const pending = await deps.db.pendingProviderTask.findMany({
    where: pendingWhere,
    select: {
      id: true,
      status: true,
      provider: true,
      operation: true,
      providerTaskId: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
    take: batch,
  });
  summary.checked = pending.length;
  const groups = new Map<string, typeof pending>();
  for (const task of pending) {
    const key = `${task.provider}\u0000${task.operation}`;
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }
  for (const [key, tasks] of groups) {
    const [provider, operation] = key.split("\u0000") as [string, string];
    const readyIds = new Set(await deps.readyIds(provider, operation));
    for (const task of tasks) {
      if (readyIds.has(task.providerTaskId) && (await markReady(deps, task))) summary.markedReady++;
    }
  }

  // 3. Give up on tasks that have waited far too long.
  const gaveUp = await deps.db.pendingProviderTask.updateMany({
    where: { status: "PENDING", createdAt: { lt: new Date(now.getTime() - giveUpMs) } },
    data: { status: "FAILED", error: "Timed out waiting for the provider." },
  });
  summary.gaveUp = gaveUp.count;
  return summary;
}

export type StoredTask = {
  id: string;
  agencyId: string;
  projectId: string | null;
  provider: string;
  operation: string;
  providerTaskId: string;
  tag: string;
  result: unknown;
};

export type TaskHandler = (task: StoredTask, result: unknown) => Promise<void>;

export type ProcessDeps = {
  db: TaskDb;
  /** Gets the result from the provider when no postback delivered it. */
  fetchResult: (task: StoredTask) => Promise<unknown>;
  handlers: Record<string, TaskHandler | undefined>;
  now?: () => Date;
  maxAttempts?: number;
};

/** Processes one READY task: get the result, hand it to the handler for its operation, mark it PROCESSED. */
export async function processProviderTask(
  deps: ProcessDeps,
  taskId: string,
): Promise<"processed" | "already" | "missing" | "failed"> {
  const maxAttempts = deps.maxAttempts ?? 3;
  const task = await deps.db.pendingProviderTask.findUnique({ where: { id: taskId } });
  if (!task) return "missing";
  if (task.status === "PROCESSED" || task.status === "FAILED") return "already";

  const claimed = await deps.db.pendingProviderTask.updateMany({
    where: { id: task.id, status: { in: ["PENDING", "READY"] } },
    data: { attempts: { increment: 1 } },
  });
  if (claimed.count !== 1) return "already";

  try {
    const handler = deps.handlers[task.operation];
    if (!handler) throw new Error(`No handler for operation "${task.operation}"`);
    const result = task.result ?? (await deps.fetchResult(task));
    await handler(task, result);
    await deps.db.pendingProviderTask.update({
      where: { id: task.id },
      data: {
        status: "PROCESSED",
        processedAt: (deps.now ?? (() => new Date()))(),
        error: null,
        result: result as Prisma.InputJsonValue,
      },
    });
    return "processed";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const exhausted = task.attempts + 1 >= maxAttempts;
    await deps.db.pendingProviderTask.update({
      where: { id: task.id },
      data: { error: message, ...(exhausted ? { status: "FAILED" } : {}) },
    });
    if (exhausted) return "failed";
    throw error; // lets the queue retry
  }
}
