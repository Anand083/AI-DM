import type { Metadata } from "next";
import { FailedJobActions, QueueToggle } from "@/components/admin/queue-controls";
import { Badge } from "@/components/ui/badge";
import { requireSuperAdmin } from "@/server/admin/guard";
import { listQueues } from "@/server/admin/queues";

export const metadata: Metadata = { title: "Queues" };
export const dynamic = "force-dynamic";

export default async function AdminQueues() {
  const admin = await requireSuperAdmin();
  const queues = await listQueues(admin);
  return (
    <>
      <h1 className="text-2xl font-semibold">Queues</h1>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm" aria-label="Queues">
          <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <tr>
              {["Queue", "Waiting", "Active", "Delayed", "Done", "Failed", "State"].map((h) => (
                <th key={h} scope="col" className="px-3 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {queues.map((q) => (
              <tr key={q.name}>
                <th scope="row" className="px-3 py-2 font-medium">
                  {q.name}
                </th>
                <td className="px-3 py-2 tabular-nums">{q.counts.waiting}</td>
                <td className="px-3 py-2 tabular-nums">{q.counts.active}</td>
                <td className="px-3 py-2 tabular-nums">{q.counts.delayed}</td>
                <td className="px-3 py-2 tabular-nums">{q.counts.completed}</td>
                <td className="px-3 py-2 tabular-nums">{q.counts.failed}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={q.paused ? "warning" : "success"}>
                      {q.paused ? "paused" : "running"}
                    </Badge>
                    <QueueToggle queue={q.name} paused={q.paused} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section aria-labelledby="failed-h" className="space-y-3">
        <h2 id="failed-h" className="text-lg font-semibold">
          Failed jobs
        </h2>
        {queues.every((q) => q.failed.length === 0) ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">No failed jobs.</p>
        ) : (
          queues
            .filter((q) => q.failed.length > 0)
            .map((q) => (
              <div key={q.name} className="space-y-2">
                <h3 className="font-medium">{q.name}</h3>
                <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
                  {q.failed.map((job) => (
                    <li key={job.id} className="space-y-1 px-3 py-2">
                      <p>
                        <span className="font-medium">{job.name}</span>{" "}
                        <span className="font-mono text-xs">{job.id}</span>{" "}
                        <span className="text-zinc-600 dark:text-zinc-400">
                          after {job.attempts} {job.attempts === 1 ? "try" : "tries"}
                        </span>
                      </p>
                      <p className="break-words text-red-700 dark:text-red-400">
                        {job.reason || "No message"}
                      </p>
                      <FailedJobActions queue={q.name} jobId={job.id} />
                    </li>
                  ))}
                </ul>
              </div>
            ))
        )}
      </section>
    </>
  );
}
