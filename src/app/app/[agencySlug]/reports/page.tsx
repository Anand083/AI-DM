import type { Metadata } from "next";
import Link from "next/link";
import { ReportDelete } from "@/components/app/report-delete";
import { ReportRefresher } from "@/components/app/report-refresher";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, pageFromParams } from "@/components/ui/pagination";
import { getPageContext } from "@/server/auth/page-context";
import { can } from "@/server/auth/permissions";
import { getAgency } from "@/server/services/agency";
import { listReports } from "@/server/services/reports";

export const metadata: Metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

const STATUS = {
  QUEUED: { label: "Waiting", tone: "neutral" },
  GENERATING: { label: "Building", tone: "warning" },
  READY: { label: "Ready", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
} as const;

export default async function ReportsPage({
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
  const [{ items, total }, agency] = await Promise.all([
    listReports(ctx, { page, pageSize: PAGE_SIZE }),
    getAgency(ctx),
  ]);
  const canCreate = can(ctx.role, "reports.create");
  const date = (d: Date) =>
    new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: agency.timezone }).format(d);
  const busy = items.some((r) => r.status === "QUEUED" || r.status === "GENERATING");

  return (
    <div className="space-y-6">
      <ReportRefresher active={busy} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Reports</h1>
        {canCreate ? (
          <Link href={`/app/${agencySlug}/reports/new`} className={buttonClasses()}>
            New report
          </Link>
        ) : null}
      </div>
      {items.length === 0 ? (
        <EmptyState
          title="No reports yet"
          description="Create a report to show a client how their rankings and site health are doing."
          action={
            canCreate ? (
              <Link href={`/app/${agencySlug}/reports/new`} className={buttonClasses()}>
                New report
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-left text-sm" aria-label="Reports">
              <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Report
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Client
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Created
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {items.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 font-medium">
                      <Link
                        href={`/app/${agencySlug}/reports/${r.id}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {r.title}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{r.project.client.name}</td>
                    <td className="px-3 py-2">{date(r.createdAt)}</td>
                    <td className="px-3 py-2">
                      <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-3">
                        {r.status === "READY" && can(ctx.role, "reports.download") ? (
                          <a
                            href={`/app/${agencySlug}/reports/${r.id}/pdf`}
                            className="underline underline-offset-4"
                          >
                            Download PDF
                            <span className="sr-only"> for {r.title}</span>
                          </a>
                        ) : null}
                        {canCreate ? (
                          <ReportDelete agencySlug={agencySlug} reportId={r.id} />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            basePath={`/app/${agencySlug}/reports`}
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
          />
        </>
      )}
    </div>
  );
}
