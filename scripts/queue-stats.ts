/** Prints how many jobs are waiting, running, done and failed in each queue.  pnpm queues:stats */
import "@/server/load-env";
import { getEnv } from "@/env";
import { redisConnectionOptions, QUEUES } from "@/server/jobs/config";
import { createQueues } from "@/server/jobs/runtime";

async function main() {
  const env = getEnv();
  const queues = createQueues(redisConnectionOptions(env.REDIS_URL), env.QUEUE_PREFIX);
  console.log(`Queues (prefix "${env.QUEUE_PREFIX}")`);
  console.log("queue".padEnd(16), "waiting active delayed completed failed");
  for (const name of QUEUES) {
    const c = await queues[name].getJobCounts(
      "waiting",
      "active",
      "delayed",
      "completed",
      "failed",
    );
    console.log(
      name.padEnd(16),
      String(c.waiting).padStart(7),
      String(c.active).padStart(6),
      String(c.delayed).padStart(7),
      String(c.completed).padStart(9),
      String(c.failed).padStart(6),
    );
  }
  await Promise.all(Object.values(queues).map((q) => q.close()));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
