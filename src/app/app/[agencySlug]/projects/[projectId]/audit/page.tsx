import type { Metadata } from "next";
import Link from "next/link";
import { AuditConfigForm } from "@/components/app/audit-config-form";
import { AuditStatusBadge, ScoreBadge } from "@/components/app/audit-widgets";
import { RunAuditButton } from "@/components/app/run-audit-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, pageFromParams } from "@/components/ui/pagination";
import { getPageContext } from "@/server/auth/page-context";
import { can } from "@/server/auth/permissions";
import { getAgency } from "@/server/services/agency";
import { getAuditConfig } from "@/server/services/audit-config";
import { listAudits } from "@/server/services/audits";

export const metadata: Metadata = { title: "Site audit" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ agencySlug: string; projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { agencySlug, projectId } = await params;
  const sp = await searchParams;
  const { ctx } = await getPageContext(agencySlug);
  const page = pageFromParams(sp.page);
  const [{ rows, total }, agency, config] = await Promise.all([
    listAudits(ctx, projectId, { page, pageSize: PAGE_SIZE }),
    getAgency(ctx),
    getAuditConfig(ctx, projectId),
  ]);
  const base = `/app/${agencySlug}/projects/${projectId}/audit`;
  const running = rows.some((a) => a.status === "QUEUED" || a.status === "RUNNING");
  const canRun = can(ctx.role, "tools.run");
  const date = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: agency.timezone,
    }).format(d);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Site audit</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            We visit the pages of this website and look for problems that can hurt its rankings.
          </p>
        </div>
        {canRun ? (
          <RunAuditButton
            agencySlug={agencySlug}
            projectId={projectId}
            disabled={running}
            label={rows.length === 0 ? "Run first audit" : "Run new audit"}
          />
        ) : null}
      </div>

      <details className="rounded-lg border border-zinc-200 dark:border-zinc-800">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Crawl settings</summary>
        <div className="border-t border-zinc-200 px-4 py-4 dark:border-zinc-800">
          <AuditConfigForm
            agencySlug={agencySlug}
            projectId={projectId}
            initial={config}
            canEdit={can(ctx.role, "content.edit")}
          />
        </div>
      </details>

      {rows.length === 0 ? (
        <EmptyState
          title="No audits yet"
          description="Run an audit to get a health score and a list of things to fix."
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-left text-sm" aria-label="Audits">
              <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Started
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Health score
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Pages
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td className="px-4 py-2">{date(a.createdAt)}</td>
                    <td className="px-4 py-2">
                      <AuditStatusBadge status={a.status} />
                    </td>
                    <td className="px-4 py-2">
                      {a.healthScore === null ? (
                        "-"
                      ) : (
                        <ScoreBadge score={a.healthScore} size="sm" />
                      )}
                    </td>
                    <td className="px-4 py-2 tabular-nums">
                      {a.status === "COMPLETED" ? a.pagesCrawled : "-"}
                    </td>
                    <td className="px-4 py-2">
                      <Link href={`${base}/${a.id}`} className="underline-offset-4 hover:underline">
                        View<span className="sr-only"> audit from {date(a.createdAt)}</span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination basePath={base} page={page} pageSize={PAGE_SIZE} total={total} />
        </>
      )}
    </div>
  );
}
