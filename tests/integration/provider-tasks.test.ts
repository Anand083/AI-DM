import { gzipSync } from "node:zlib";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as pingback } from "@/app/api/providers/dataforseo/pingback/route";
import { POST as postback } from "@/app/api/providers/dataforseo/postback/route";
import { enqueueProcessTask } from "@/server/jobs/enqueue";
import { redisConnectionOptions } from "@/server/jobs/config";
import { getQueue, getQueues } from "@/server/jobs/queues";
import { createWorkerRuntime } from "@/server/jobs/runtime";
import { resolveProviderName } from "@/server/providers/seo/overrides";
import { MockSeoProvider } from "@/server/providers/seo/mock";
import type { SeoDataProvider } from "@/server/providers/seo/types";
import {
  pollProviderTasks,
  processProviderTask,
  registerPendingTask,
} from "@/server/services/provider-tasks";
import { SeoGateway } from "@/server/services/seo-gateway";
import { RedisLockStore } from "@/server/locks";
import IORedis from "ioredis";
import { createAgencyWithMembers } from "../factories";
import { createTestClient, resetDb } from "../helpers/db";

const SECRET = "test-callback-secret";
const prisma = createTestClient();
const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379");
let agencyId: string;
let seq = 0;

const url = (path: string, params: Record<string, string>) =>
  `http://localhost:3000/api/providers/dataforseo/${path}?${new URLSearchParams(params)}`;

async function newTask(
  overrides: Partial<{
    operation: string;
    status: "PENDING" | "READY" | "PROCESSED";
    createdAt: Date;
  }> = {},
) {
  const providerTaskId = `dfs-task-${Date.now()}-${seq++}`;
  const task = await registerPendingTask(prisma, {
    agencyId,
    provider: "dataforseo",
    operation: overrides.operation ?? "rankings",
    providerTaskId,
    tag: `job-${seq}`,
  });
  if (overrides.status || overrides.createdAt) {
    await prisma.pendingProviderTask.update({
      where: { id: task.id },
      data: { status: overrides.status, createdAt: overrides.createdAt },
    });
  }
  return { ...task, providerTaskId };
}

const jobsIn = async () =>
  (
    await getQueue("provider-tasks").getJobs([
      "waiting",
      "delayed",
      "active",
      "completed",
      "failed",
    ])
  ).filter(Boolean);

beforeAll(async () => {
  await resetDb(prisma);
  const { agency } = await createAgencyWithMembers(prisma, ["OWNER"]);
  agencyId = agency.id;
});
beforeEach(async () => {
  await prisma.pendingProviderTask.deleteMany({});
  const keys = await redis.keys("rl:dfs-callback:*");
  if (keys.length) await redis.del(...keys);
});
afterEach(async () => {
  await getQueue("provider-tasks").obliterate({ force: true });
});
afterAll(async () => {
  await Promise.all(Object.values(getQueues()).map((q) => q.close()));
  await prisma.$disconnect();
  redis.disconnect();
});

describe("pingback route", () => {
  it("rejects a bad or missing secret with 401 and changes nothing", async () => {
    const task = await newTask();
    const bad = await pingback(
      new Request(url("pingback", { id: task.providerTaskId, secret: "wrong" })),
    );
    const none = await pingback(new Request(url("pingback", { id: task.providerTaskId })));
    expect(bad.status).toBe(401);
    expect(none.status).toBe(401);
    expect(
      (await prisma.pendingProviderTask.findUniqueOrThrow({ where: { id: task.id } })).status,
    ).toBe("PENDING");
    expect(await jobsIn()).toHaveLength(0);
  });

  it("returns 404 for an unknown task and 400 without an id", async () => {
    expect(
      (await pingback(new Request(url("pingback", { id: "nope", secret: SECRET })))).status,
    ).toBe(404);
    expect((await pingback(new Request(url("pingback", { secret: SECRET })))).status).toBe(400);
  });

  it("marks the task READY and queues exactly one processing job, even if called twice", async () => {
    const task = await newTask();
    const first = await pingback(
      new Request(url("pingback", { id: task.providerTaskId, tag: task.tag, secret: SECRET })),
    );
    const second = await pingback(
      new Request(url("pingback", { id: task.providerTaskId, tag: task.tag, secret: SECRET })),
    );
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ok: true, outcome: "queued" });
    expect(await second.json()).toMatchObject({ outcome: "duplicate" });
    const row = await prisma.pendingProviderTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(row.status).toBe("READY");
    expect(row.readyAt).not.toBeNull();
    const jobs = await jobsIn();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.id).toBe(`ptask_${task.id}`);
    expect(jobs[0]!.data).toEqual({ taskId: task.id });
  });

  it("does not trust data in the request: extra parameters change nothing", async () => {
    const task = await newTask();
    await pingback(
      new Request(
        url("pingback", {
          id: task.providerTaskId,
          secret: SECRET,
          status: "PROCESSED",
          result: "x",
        }),
      ),
    );
    const row = await prisma.pendingProviderTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(row.status).toBe("READY");
    expect(row.result).toBeNull();
  });
});

describe("postback route", () => {
  const post = (body: BodyInit, secret = SECRET, headers: HeadersInit = {}) =>
    postback(new Request(url("postback", { secret }), { method: "POST", body, headers }));

  it("rejects a bad secret with 401", async () => {
    const task = await newTask();
    const res = await post(JSON.stringify({ tasks: [{ id: task.providerTaskId }] }), "wrong");
    expect(res.status).toBe(401);
  });

  it("unzips a gzip body, stores the result and queues one job", async () => {
    const task = await newTask();
    const payload = {
      tasks: [
        {
          id: task.providerTaskId,
          status_code: 20000,
          result: [{ keyword: "seo", items: [1, 2, 3] }],
        },
      ],
    };
    const res = await post(gzipSync(JSON.stringify(payload)), SECRET, {
      "content-encoding": "gzip",
    });
    expect(res.status).toBe(200);
    const row = await prisma.pendingProviderTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(row.status).toBe("READY");
    expect(row.result).toMatchObject({ result: [{ keyword: "seo", items: [1, 2, 3] }] });
    expect(await jobsIn()).toHaveLength(1);
  });

  it("also accepts a plain JSON body", async () => {
    const task = await newTask();
    const res = await post(JSON.stringify({ tasks: [{ id: task.providerTaskId, result: [] }] }));
    expect(res.status).toBe(200);
    expect(
      (await prisma.pendingProviderTask.findUniqueOrThrow({ where: { id: task.id } })).status,
    ).toBe("READY");
  });

  it("processes a duplicate delivery only once and keeps the first result", async () => {
    const task = await newTask();
    const send = (marker: string) =>
      post(
        gzipSync(JSON.stringify({ tasks: [{ id: task.providerTaskId, result: [{ marker }] }] })),
      );
    expect(await (await send("first")).json()).toMatchObject({ queued: 1, duplicate: 0 });
    expect(await (await send("second")).json()).toMatchObject({ queued: 0, duplicate: 1 });
    const row = await prisma.pendingProviderTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(row.result).toMatchObject({ result: [{ marker: "first" }] });
    expect(await jobsIn()).toHaveLength(1);
  });

  it("ignores results for tasks that are already processed", async () => {
    const task = await newTask({ status: "PROCESSED" });
    const res = await post(
      JSON.stringify({ tasks: [{ id: task.providerTaskId, result: [{ evil: true }] }] }),
    );
    expect(await res.json()).toMatchObject({ duplicate: 1, queued: 0 });
    expect(
      (await prisma.pendingProviderTask.findUniqueOrThrow({ where: { id: task.id } })).result,
    ).toBeNull();
  });

  it("returns 404 for an unknown task and 400 for a body that is not JSON", async () => {
    expect((await post(JSON.stringify({ tasks: [{ id: "unknown-task" }] }))).status).toBe(404);
    expect((await post("this is not json")).status).toBe(400);
    expect((await post(Buffer.from([0x1f, 0x8b, 0x00, 0x01]))).status).toBe(400);
  });

  it("handles several tasks in one delivery", async () => {
    const a = await newTask();
    const b = await newTask();
    const res = await post(
      JSON.stringify({
        tasks: [
          { id: a.providerTaskId, result: [] },
          { id: b.providerTaskId, result: [] },
        ],
      }),
    );
    expect(await res.json()).toMatchObject({ queued: 2 });
    expect(await jobsIn()).toHaveLength(2);
  });
});

describe("poll job", () => {
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

  function deps(readyIds: string[], mode: "poll" | "pingback" | "postback" = "poll") {
    const queued: string[] = [];
    const asked: string[] = [];
    return {
      queued,
      asked,
      deps: {
        db: prisma,
        mode,
        enqueueProcess: async (id: string) => void queued.push(id),
        readyIds: async (provider: string, operation: string) => {
          asked.push(`${provider}:${operation}`);
          return readyIds;
        },
      },
    };
  }

  it("re-queues READY tasks that were never processed", async () => {
    const lost = await newTask({ status: "READY" });
    await newTask({ status: "PROCESSED" });
    const { deps: d, queued } = deps([]);
    const summary = await pollProviderTasks(d);
    expect(queued).toEqual([lost.id]);
    expect(summary.requeued).toBe(1);
  });

  it("in poll mode asks about every pending task and marks the finished ones READY", async () => {
    const done = await newTask({ createdAt: minutesAgo(2) });
    const waiting = await newTask({ createdAt: minutesAgo(2) });
    const { deps: d, queued, asked } = deps([done.providerTaskId]);
    const summary = await pollProviderTasks(d);
    expect(asked).toEqual(["dataforseo:rankings"]);
    expect(summary).toMatchObject({ checked: 2, markedReady: 1 });
    expect(queued).toEqual([done.id]);
    expect(
      (await prisma.pendingProviderTask.findUniqueOrThrow({ where: { id: done.id } })).status,
    ).toBe("READY");
    expect(
      (await prisma.pendingProviderTask.findUniqueOrThrow({ where: { id: waiting.id } })).status,
    ).toBe("PENDING");
  });

  it("in callback mode only checks tasks that are pending for more than 30 minutes", async () => {
    const fresh = await newTask({ createdAt: minutesAgo(10) });
    const stale = await newTask({ createdAt: minutesAgo(45) });
    const { deps: d, queued } = deps([fresh.providerTaskId, stale.providerTaskId], "pingback");
    const summary = await pollProviderTasks(d);
    expect(summary).toMatchObject({ checked: 1, markedReady: 1 });
    expect(queued).toEqual([stale.id]);
    expect(
      (await prisma.pendingProviderTask.findUniqueOrThrow({ where: { id: fresh.id } })).status,
    ).toBe("PENDING");
  });

  it("asks once per operation and gives up on tasks pending for over a day", async () => {
    await newTask({ operation: "rankings" });
    await newTask({ operation: "rankings" });
    await newTask({ operation: "reviews" });
    const ancient = await newTask({ createdAt: minutesAgo(25 * 60) });
    const { deps: d, asked } = deps([]);
    const summary = await pollProviderTasks(d);
    expect(asked.sort()).toEqual(["dataforseo:rankings", "dataforseo:reviews"]);
    expect(summary.gaveUp).toBe(1);
    const row = await prisma.pendingProviderTask.findUniqueOrThrow({ where: { id: ancient.id } });
    expect(row).toMatchObject({ status: "FAILED", error: "Timed out waiting for the provider." });
  });

  it("replaces a failed processing job so a READY task is not stuck", async () => {
    const queue = getQueue("provider-tasks");
    const task = await newTask({ status: "READY" });
    await queue.add(
      "process-task",
      { taskId: task.id },
      { jobId: `ptask_${task.id}`, attempts: 1 },
    );
    // Let a worker fail the job once.
    const runtime = createWorkerRuntime({
      connection: redisConnectionOptions(process.env.REDIS_URL ?? "redis://localhost:6379"),
      prefix: process.env.QUEUE_PREFIX!,
      concurrency: 1,
      queues: ["provider-tasks"],
      processors: {
        "provider-tasks": async () => {
          throw new Error("boom");
        },
      },
    });
    runtime.start();
    const job = (await queue.getJob(`ptask_${task.id}`))!;
    for (let i = 0; i < 100 && (await job.getState()) !== "failed"; i++)
      await new Promise((r) => setTimeout(r, 50));
    await runtime.shutdown();
    expect(await job.getState()).toBe("failed");
    await enqueueProcessTask(task.id);
    expect(await (await queue.getJob(`ptask_${task.id}`))!.getState()).not.toBe("failed");
  });
});

describe("processing a task", () => {
  const handlerCalls: unknown[] = [];
  const baseDeps = {
    db: prisma,
    handlers: { rankings: async (_t: unknown, result: unknown) => void handlerCalls.push(result) },
    fetchResult: async () => ({ fetched: true }),
  };
  beforeEach(() => void (handlerCalls.length = 0));

  it("uses the stored postback result and marks the task PROCESSED once", async () => {
    const task = await newTask({ status: "READY" });
    await prisma.pendingProviderTask.update({
      where: { id: task.id },
      data: { result: { from: "postback" } },
    });
    expect(await processProviderTask(baseDeps, task.id)).toBe("processed");
    expect(handlerCalls).toEqual([{ from: "postback" }]);
    expect(await processProviderTask(baseDeps, task.id)).toBe("already");
    expect(handlerCalls).toHaveLength(1);
    const row = await prisma.pendingProviderTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(row.status).toBe("PROCESSED");
    expect(row.processedAt).not.toBeNull();
  });

  it("fetches the result from the provider when none was delivered", async () => {
    const task = await newTask({ status: "READY" });
    await processProviderTask(baseDeps, task.id);
    expect(handlerCalls).toEqual([{ fetched: true }]);
  });

  it("rethrows so the queue retries, and gives up with FAILED after 3 attempts", async () => {
    const task = await newTask({ status: "READY" });
    const failing = {
      ...baseDeps,
      handlers: {
        rankings: async () => {
          throw new Error("db write failed");
        },
      },
    };
    await expect(processProviderTask(failing, task.id)).rejects.toThrow("db write failed");
    await expect(processProviderTask(failing, task.id)).rejects.toThrow("db write failed");
    expect(await processProviderTask(failing, task.id)).toBe("failed");
    const row = await prisma.pendingProviderTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(row).toMatchObject({ status: "FAILED", attempts: 3, error: "db write failed" });
    expect(await processProviderTask(failing, task.id)).toBe("already");
  });

  it("fails a task whose operation has no handler, and reports missing tasks", async () => {
    const task = await newTask({ status: "READY", operation: "something_new" });
    await expect(processProviderTask({ ...baseDeps, maxAttempts: 1 }, task.id)).resolves.toBe(
      "failed",
    );
    expect(
      (await prisma.pendingProviderTask.findUniqueOrThrow({ where: { id: task.id } })).error,
    ).toMatch(/No handler/);
    expect(await processProviderTask(baseDeps, "no-such-task")).toBe("missing");
  });
});

describe("provider overrides", () => {
  class CountingMock extends MockSeoProvider {
    calls = 0;
    override getRankings(...args: Parameters<MockSeoProvider["getRankings"]>) {
      this.calls++;
      return super.getRankings(...args);
    }
    override startAudit(...args: Parameters<MockSeoProvider["startAudit"]>) {
      this.calls++;
      return super.startAudit(...args);
    }
  }

  /** The same fake data, but reporting a different provider name (as the real adapter would). */
  function named(provider: CountingMock, name: "mock" | "dataforseo"): SeoDataProvider {
    return new Proxy(provider, {
      get(target, prop) {
        if (prop === "name") return name;
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as unknown as SeoDataProvider;
  }

  it("sends rankings to one provider and audits to another", async () => {
    const realCounter = new CountingMock();
    const mockCounter = new CountingMock();
    const real = named(realCounter, "dataforseo");
    const mock = named(mockCounter, "mock");
    const overrides = { rankings: "dataforseo" } as const;
    const gateway = new SeoGateway({
      provider: (module) =>
        resolveProviderName(module, "mock", overrides) === "dataforseo" ? real : mock,
      db: prisma,
      locks: new RedisLockStore(redis, `test-lock:${Date.now()}:`),
    });
    const rankings = await gateway.getRankings(
      { agencyId },
      {
        domain: "example.com",
        keywords: ["seo"],
        locationCode: 2840,
        languageCode: "en",
        device: "desktop",
      },
    );
    await gateway.startAudit({ agencyId }, { domain: "example.com", maxPages: 10 });
    expect(realCounter.calls).toBe(1);
    expect(mockCounter.calls).toBe(1);
    const record = await prisma.usageRecord.findFirstOrThrow({
      where: { agencyId },
      orderBy: { createdAt: "desc" },
    });
    expect(record.provider).toBe("dataforseo");
    expect(rankings.data).toHaveLength(1);
  });
});
