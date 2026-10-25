import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, pageFromParams } from "@/components/ui/pagination";
import { buttonClasses } from "@/components/ui/button";
import { getPageContext } from "@/server/auth/page-context";
import { listPerformance } from "@/server/services/performance";

export const metadata: Metadata = { title: "Performance" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const num = (n: number | null) => (n === null ? "-" : n.toLocaleString("en-US"));

export default async function PerformancePage({
  params,
  searchParams,
}: {
  params: Promise<{ agencySlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { agencySlug } = await params;
  const sp = await searchParams;
  const { ctx } = await getPageContext(agencySlug);
  const page = pageFromParams(sp.page);
  const { rows, total } = await listPerformance(ctx, { page, pageSize: PAGE_SIZE });
  const base = `/app/${agencySlug}/performance`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Performance</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            All your projects side by side. Search clicks need a Google connection.
          </p>
        </div>
        <a href={`${base}/export`} className={buttonClasses("outline")}>
          Download CSV
        </a>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="Add a client and a project to see how they are doing here."
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-left text-sm" aria-label="Project performance">
              <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                <tr>
                  {[
                    "Project",
                    "Keywords",
                    "Avg position",
                    "Top 10",
                    "Health",
                    "Clicks (28 days)",
                    "Open tasks",
                    "Goals reached",
                  ].map((h) => (
                    <th key={h} scope="col" className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.projectId}
                    className="border-b border-zinc-100 last:border-0 dark:border-zinc-800"
                  >
                    <td className="px-3 py-2">
                      <Link
                        className="font-medium underline"
                        href={`/app/${agencySlug}/projects/${r.projectId}`}
                      >
                        {r.projectName}
                      </Link>
                      <div className="text-xs text-zinc-600 dark:text-zinc-400">{r.clientName}</div>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{num(r.keywords)}</td>
                    <td className="px-3 py-2 tabular-nums">{r.averagePosition ?? "-"}</td>
                    <td className="px-3 py-2 tabular-nums">{num(r.top10)}</td>
                    <td className="px-3 py-2 tabular-nums">{num(r.healthScore)}</td>
                    <td className="px-3 py-2 tabular-nums">{num(r.clicks28d)}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {r.openTasks}
                      {r.overdueTasks > 0 ? ` (${r.overdueTasks} late)` : ""}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {r.goals === 0 ? "-" : `${r.goalsReached} of ${r.goals}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            basePath={base}
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            label="Projects"
          />
        </>
      )}
    </div>
  );
}
