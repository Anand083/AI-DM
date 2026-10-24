import { Queue, type Job } from "bullmq";
import IORedis from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { redisConnectionOptions, type QueueName } from "@/server/jobs/config";
import { createQueues, createWorkerRuntime, type JobProcessors } from "@/server/jobs/runtime";
import { purgeExpired } from "@/server/jobs/system/purge";
import { runRankCheckScheduler } from "@/server/jobs/system/scheduler";
import { minuteOffset } from "@/server/jobs/schedule";
import { createAgencyWithMembers } from "../factories";
import { createTestClient, resetDb } from "../helpers/db";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const connection = redisConnectionOptions(redisUrl);
const prefix = `test-${Date.now()}`;
const FAST = {
  attempts: 3,
  backoff: { type: "fixed" as const, delay: 20 },
  removeOnComplete: false,
  removeOnFail: false,
};

const prisma = createTestClient();
const admin = new IORedis(redisUrl);
const queues = createQueues(connection, prefix, FAST);
const runtimes: ReturnType<typeof createWorkerRuntime>[] = [];

function run(processors: JobProcessors, queueNames: QueueName[] = ["emails"]) {
  const runtime = createWorkerRuntime({
    connection,
    prefix,
    processors,
    concurrency: 2,
    queues: queueNames,
  });
  runtime.start();
  runtimes.push(runtime);
  return runtime;
}

async function waitFor<T>(
  check: () => Promise<T | undefined | false>,
  timeoutMs = 8000,
): Promise<T> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("timed out waiting");
}

beforeAll(async () => {
  await resetDb(prisma);
});
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((r) => r.shutdown()));
  for (const q of Object.values(queues)) await q.obliterate({ force: true });
});
afterAll(async () => {
  await Promise.all(Object.values(queues).map((q: Queue) => q.close()));
  await prisma.$disconnect();
  admin.disconnect();
});

describe("worker and queues", () => {
  it("runs a job and passes its data to the processor", async () => {
    const seen: unknown[] = [];
    run({ emails: async (job) => void seen.push(job.data) });
    await queues.emails.add("send", { to: "a@example.test" });
    await waitFor(async () => seen.length === 1);
    expect(seen[0]).toEqual({ to: "a@example.test" });
    const job = await waitFor(async () => (await queues.emails.getCompleted())[0]);
    expect(job.name).toBe("send");
  });

  it("retries a failing job 3 times, then keeps it as failed", async () => {
    let tries = 0;
    run({
      emails: async () => {
        tries++;
        throw new Error("smtp down");
      },
    });
    await queues.emails.add("send", { to: "b@example.test" });
    const failed = await waitFor(async () => (await queues.emails.getFailed())[0]);
    expect(tries).toBe(3);
    expect(failed.attemptsMade).toBe(3);
    expect(failed.failedReason).toBe("smtp down");
  });

  it("succeeds on a later try when the problem goes away", async () => {
    let tries = 0;
    run({
      emails: async () => {
        tries++;
        if (tries < 3) throw new Error("not yet");
      },
    });
    await queues.emails.add("send", {});
    await waitFor(async () => (await queues.emails.getCompleted()).length === 1);
    expect(tries).toBe(3);
    expect(await queues.emails.getFailedCount()).toBe(0);
  });

  it("ignores a second job with the same job id", async () => {
    let runs = 0;
    await queues.emails.add("send", { n: 1 }, { jobId: "email:welcome:user1" });
    await queues.emails.add("send", { n: 2 }, { jobId: "email:welcome:user1" });
    run({ emails: async () => void runs++ });
    await waitFor(async () => (await queues.emails.getCompletedCount()) === 1);
    await new Promise((r) => setTimeout(r, 200));
    expect(runs).toBe(1);
  });

  it("waits for a running job to finish before shutdown completes", async () => {
    let started = false;
    let finished = false;
    const runtime = run({
      emails: async () => {
        started = true;
        await new Promise((r) => setTimeout(r, 400));
        finished = true;
      },
    });
    await queues.emails.add("send", {});
    await waitFor(async () => started);
    expect(finished).toBe(false);
    await runtime.shutdown();
    expect(finished).toBe(true);
    expect(await queues.emails.getCompletedCount()).toBe(1);
  });

  it("does not start new jobs after shutdown begins", async () => {
    let runs = 0;
    const runtime = run({ emails: async () => void runs++ });
    await runtime.shutdown();
    await queues.emails.add("send", {});
    await new Promise((r) => setTimeout(r, 300));
    expect(runs).toBe(0);
    expect(await queues.emails.getWaitingCount()).toBe(1);
  });

  it("uses the prefix, so test jobs never mix with real ones", async () => {
    await queues.emails.add("send", {});
    const keys = await admin.keys(`${prefix}:emails:*`);
    expect(keys.length).toBeGreaterThan(0);
  });
});

describe("rank check scheduler", () => {
  it("queues each due project once per day, spread by the project's minute", async () => {
    await resetDb(prisma);
    const { agency } = await createAgencyWithMembers(prisma, ["OWNER"]);
    const client = await prisma.client.create({ data: { agencyId: agency.id, name: "C" } });
    const mk = (n: number, extra: object = {}) =>
      prisma.project.create({
        data: {
          agencyId: agency.id,
          clientId: client.id,
          name: `P${n}`,
          domain: `site${n}.com`,
          locationCode: 2840,
          languageCode: "en",
          rankCheckHourUtc: 3,
          ...extra,
        },
      });
    const dueProject = await mk(1);
    await mk(2, { rankCheckHourUtc: 23 }); // later today
    await mk(3, { deletedAt: new Date() }); // deleted

    const queued: string[] = [];
    const enqueued = new Set<string>();
    const enqueue = async (j: { projectId: string; date: string }) => {
      const id = `${j.projectId}:${j.date}`;
      if (enqueued.has(id)) return false;
      enqueued.add(id);
      queued.push(j.projectId);
      return true;
    };

    const at = new Date(Date.UTC(2026, 2, 10, 4, 0)); // after 03:00 + any minute offset
    expect(minuteOffset(dueProject.id)).toBeLessThan(60);
    const first = await runRankCheckScheduler({ db: prisma, now: at, enqueue });
    expect(first).toEqual({ scanned: 2, due: 1, queued: 1 });
    expect(queued).toEqual([dueProject.id]);

    const second = await runRankCheckScheduler({
      db: prisma,
      now: new Date(at.getTime() + 15 * 60_000),
      enqueue,
    });
    expect(second).toMatchObject({ due: 1, queued: 0 });

    const nextDay = await runRankCheckScheduler({
      db: prisma,
      now: new Date(at.getTime() + 86_400_000),
      enqueue,
    });
    expect(nextDay.queued).toBe(1);
  });

  it("goes through projects in batches", async () => {
    const seen: string[] = [];
    await runRankCheckScheduler({
      db: prisma,
      now: new Date(Date.UTC(2026, 2, 10, 23, 59)),
      batchSize: 1,
      enqueue: async (j) => {
        seen.push(j.projectId);
        return true;
      },
    });
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe("purge", () => {
  it("removes expired cache and old soft-deleted data, and keeps recent data", async () => {
    await resetDb(prisma);
    const { agency } = await createAgencyWithMembers(prisma, ["OWNER"]);
    const now = new Date("2026-03-10T00:00:00Z");
    const days = (n: number) => new Date(now.getTime() - n * 86_400_000);
    const oldClient = await prisma.client.create({
      data: { agencyId: agency.id, name: "Old", deletedAt: days(31) },
    });
    await prisma.project.create({
      data: {
        agencyId: agency.id,
        clientId: oldClient.id,
        name: "p",
        domain: "a.com",
        locationCode: 2840,
        languageCode: "en",
        deletedAt: days(31),
      },
    });
    const recent = await prisma.client.create({
      data: { agencyId: agency.id, name: "Recent", deletedAt: days(5) },
    });
    await prisma.providerCache.createMany({
      data: [
        { provider: "mock", operation: "x", requestHash: "old", response: {}, expiresAt: days(1) },
        {
          provider: "mock",
          operation: "x",
          requestHash: "fresh",
          response: {},
          expiresAt: new Date(now.getTime() + 3600_000),
        },
      ],
    });
    const result = await purgeExpired(prisma, now);
    expect(result).toMatchObject({ providerCache: 1, projects: 1, clients: 1 });
    expect(await prisma.providerCache.findMany({ select: { requestHash: true } })).toEqual([
      { requestHash: "fresh" },
    ]);
    expect(await prisma.client.findMany({ select: { id: true } })).toEqual([{ id: recent.id }]);
  });
});
