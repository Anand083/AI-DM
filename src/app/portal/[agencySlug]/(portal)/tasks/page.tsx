import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, pageFromParams } from "@/components/ui/pagination";
import { approvalLabel, priorityLabel, statusLabel } from "@/lib/tasks";
import { getPortalPageContext } from "@/server/auth/portal-context";
import { listPortalTasks } from "@/server/services/portal-tasks";

export const metadata: Metadata = { title: "Tasks" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

export default async function PortalTasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ agencySlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { agencySlug } = await params;
  const { ctx } = await getPortalPageContext(agencySlug);
  const page = pageFromParams((await searchParams).page);
  const { rows, total, waitingForApproval } = await listPortalTasks(ctx, {
    page,
    pageSize: PAGE_SIZE,
  });
  const base = `/portal/${agencySlug}/tasks`;

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Tasks</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          The work your agency is doing for you. Some tasks need your approval.
        </p>
      </div>
      {waitingForApproval > 0 ? (
        <p
          role="status"
          className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          {waitingForApproval} {waitingForApproval === 1 ? "task is" : "tasks are"} waiting for your
          answer.
        </p>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState
          title="No tasks to show"
          description="Your agency has not shared any tasks yet."
        />
      ) : (
        <>
          <div
            role="region"
            aria-label="Task list"
            tabIndex={0}
            className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800"
          >
            <table className="w-full text-left text-sm" aria-label="Tasks">
              <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                <tr>
                  {["Task", "Website", "Status", "Due", "Approval"].map((h) => (
                    <th key={h} scope="col" className="px-4 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr
                    key={t.id}
                    className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-900"
                  >
                    <td className="max-w-xs px-4 py-2">
                      <Link
                        href={`${base}/${t.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {t.title}
                      </Link>
                      <p className="text-xs text-zinc-600 dark:text-zinc-400">
                        {priorityLabel(t.priority)} priority
                      </p>
                    </td>
                    <td className="px-4 py-2">{t.project?.name}</td>
                    <td className="px-4 py-2">{statusLabel(t.status)}</td>
                    <td className="whitespace-nowrap px-4 py-2">{t.dueOn ?? "-"}</td>
                    <td className="px-4 py-2">
                      {t.approvalStatus === "NONE" ? (
                        "-"
                      ) : (
                        <Badge
                          tone={
                            t.approvalStatus === "REQUESTED"
                              ? "warning"
                              : t.approvalStatus === "APPROVED"
                                ? "success"
                                : "neutral"
                          }
                        >
                          {t.approvalStatus === "REQUESTED"
                            ? "Needs your answer"
                            : approvalLabel(t.approvalStatus)}
                        </Badge>
                      )}
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
            label="Task pages"
          />
        </>
      )}
    </>
  );
}
