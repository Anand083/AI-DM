import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, pageFromParams } from "@/components/ui/pagination";
import { formatChange, formatPosition } from "@/lib/rank-math";
import { getPortalPageContext } from "@/server/auth/portal-context";
import { NotFoundError } from "@/server/services/errors";
import { getPortalProgress } from "@/server/services/portal-tasks";
import {
  getPortalAudit,
  getPortalProject,
  listPortalKeywords,
  listPortalReports,
} from "@/server/services/portal";

export const metadata: Metadata = { title: "Website" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const SEVERITY = { CRITICAL: "Critical", WARNING: "Warning", NOTICE: "Notice" } as const;

export default async function PortalProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ agencySlug: string; projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { agencySlug, projectId } = await params;
  const { ctx } = await getPortalPageContext(agencySlug);
  const page = pageFromParams((await searchParams).page);
  const project = await getPortalProject(ctx, projectId).catch((error) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const [keywords, audit, reports, progress] = await Promise.all([
    listPortalKeywords(ctx, projectId, { page, pageSize: PAGE_SIZE }),
    getPortalAudit(ctx, projectId),
    listPortalReports(ctx, { projectId, pageSize: 5 }),
    getPortalProgress(ctx, projectId),
  ]);
  const base = `/portal/${agencySlug}`;
  const max = Math.max(1, ...project.distribution.map((d) => d.count));
  const date = (d: Date) =>
    new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(d);

  return (
    <>
      <div>
        <Link href={base} className="text-sm underline underline-offset-4">
          All websites
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{project.name}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{project.domain}</p>
      </div>

      {progress.total > 0 || progress.milestones.length > 0 ? (
        <section aria-labelledby="progress-h" className="space-y-3">
          <h2 id="progress-h" className="text-lg font-semibold">
            Progress
          </h2>
          {progress.total > 0 ? (
            <p className="text-sm">
              {progress.done} of {progress.total} tasks done ({progress.percent}%).{" "}
              <Link href={`${base}/tasks`} className="underline underline-offset-4">
                See the tasks
              </Link>
            </p>
          ) : null}
          {progress.milestones.length > 0 ? (
            <ul aria-label="Milestones" className="space-y-2">
              {progress.milestones.map((m) => (
                <li
                  key={m.id}
                  className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800"
                >
                  <p className="font-medium">
                    {m.title}
                    {m.reached ? " (reached)" : ""}
                  </p>
                  <p className="text-zinc-600 dark:text-zinc-400">
                    {m.dueOn ? `Due ${m.dueOn}. ` : ""}
                    {m.percent === null ? "No tasks yet." : `${m.done} of ${m.total} tasks done.`}
                  </p>
                  {m.percent !== null ? (
                    <div
                      role="progressbar"
                      aria-label={`${m.title} progress`}
                      aria-valuenow={m.percent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      className="mt-2 h-2 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-800"
                    >
                      <div
                        className="h-full"
                        style={{ width: `${m.percent}%`, background: "var(--brand-accent)" }}
                      />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="rank-h" className="space-y-3">
        <h2 id="rank-h" className="text-lg font-semibold">
          Google rankings
        </h2>
        {project.checked === 0 ? (
          <EmptyState
            title="No rankings yet"
            description="Rankings will show here after the first check."
          />
        ) : (
          <>
            <ul className="space-y-1.5" aria-label="Keywords by position">
              {project.distribution.map((d) => (
                <li key={d.key} className="flex items-center gap-3 text-sm">
                  <span className="w-24 shrink-0">{d.label}</span>
                  <span
                    aria-hidden="true"
                    className="h-4 rounded"
                    style={{
                      width: `${d.count === 0 ? 0 : Math.max(2, (d.count / max) * 100)}%`,
                      maxWidth: "60%",
                      background: "var(--brand-primary)",
                    }}
                  />
                  <span className="tabular-nums">{d.count}</span>
                </li>
              ))}
            </ul>
            <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <table className="w-full text-left text-sm" aria-label="Keyword rankings">
                <thead className="border-b border-zinc-200 dark:border-zinc-800">
                  <tr>
                    {["Keyword", "Position", "Change this week", "Change this month", "Best"].map(
                      (h) => (
                        <th key={h} scope="col" className="px-3 py-2 font-medium">
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {keywords.items.map((k) => (
                    <tr key={k.id}>
                      <td className="px-3 py-2 font-medium">{k.phrase}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {k.lastCheckedOn ? formatPosition(k.currentPosition) : "Not checked"}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{formatChange(k.changeWeek)}</td>
                      <td className="px-3 py-2 tabular-nums">{formatChange(k.changeMonth)}</td>
                      <td className="px-3 py-2 tabular-nums">{k.bestPosition ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              basePath={`${base}/projects/${projectId}`}
              page={page}
              pageSize={PAGE_SIZE}
              total={keywords.total}
            />
          </>
        )}
      </section>

      <section aria-labelledby="audit-h" className="space-y-3">
        <h2 id="audit-h" className="text-lg font-semibold">
          Website health
        </h2>
        {audit ? (
          <>
            <p>
              Score <strong>{audit.healthScore}</strong> out of 100 on{" "}
              {audit.finishedAt ? date(audit.finishedAt) : ""}. {audit.pagesCrawled} pages checked:{" "}
              {audit.counts.critical} critical, {audit.counts.warning} warnings,{" "}
              {audit.counts.notice} notices.
            </p>
            {audit.issues.length > 0 ? (
              <ul className="space-y-2 text-sm">
                {audit.issues.map((i) => (
                  <li
                    key={i.code}
                    className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
                  >
                    <p className="font-medium">
                      {i.title}{" "}
                      <span className="font-normal text-zinc-600 dark:text-zinc-400">
                        ({SEVERITY[i.severity]}, {i.pages} {i.pages === 1 ? "page" : "pages"})
                      </span>
                    </p>
                    <p className="text-zinc-600 dark:text-zinc-400">{i.fix}</p>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            No website check has finished yet.
          </p>
        )}
      </section>

      <section aria-labelledby="rep-h" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="rep-h" className="text-lg font-semibold">
            Latest reports
          </h2>
          <Link href={`${base}/reports`} className="text-sm underline underline-offset-4">
            All reports
          </Link>
        </div>
        {reports.items.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">No reports yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {reports.items.map((r) => (
              <li key={r.id}>
                <Link href={`${base}/reports/${r.id}`} className="underline underline-offset-4">
                  {r.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
