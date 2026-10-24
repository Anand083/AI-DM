import "server-only";
import type { Queue } from "bullmq";
import { getEnv } from "@/env";
import { redisConnectionOptions, type QueueName } from "./config";
import { createQueues } from "./runtime";

const globalForQueues = globalThis as unknown as { queues?: Record<QueueName, Queue> };

/** Queue clients for adding jobs from the web app or the worker. */
export function getQueues(): Record<QueueName, Queue> {
  const env = getEnv();
  globalForQueues.queues ??= createQueues(redisConnectionOptions(env.REDIS_URL), env.QUEUE_PREFIX);
  return globalForQueues.queues;
}

export function getQueue(name: QueueName): Queue {
  return getQueues()[name];
}
