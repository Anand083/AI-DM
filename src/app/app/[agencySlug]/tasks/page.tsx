import type { Metadata } from "next";
import Link from "next/link";
import { TaskDoneButton } from "@/components/app/task-extras";
import { TaskForm } from "@/components/app/task-form";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, pageFromParams } from "@/components/ui/pagination";
import { isOverdue, priorityLabel, statusLabel } from "@/lib/tasks";
import { getPageContext } from "@/server/auth/page-context";
import { can } from "@/server/auth/permissions";
import { listProjects } from "@/server/services/projects";
import { listAssignees, listTasks, TASK_VIEWS, type TaskView } from "@/server/services/tasks";

export const metadata: Metadata = { title: "Tasks" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const VIEW_LABEL: Record<TaskView, string> = {
  open: "Open",
  mine: "Mine",
  overdue: "Overdue",
  done: "Done",
};
const PRIORITY_TONE = {
  LOW: "neutral",
  MEDIUM: "neutral",
  HIGH: "warning",
  URGENT: "danger",
} as const;

export default async function TasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ agencySlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { agencySlug } = await params;
  const sp = await searchParams;
  const { ctx } = await getPageContext(agencySlug);
  const asked = typeof sp.view === "string" ? sp.view : "";
  const view = TASK_VIEWS.includes(asked as TaskView) ? (asked as TaskView) : "open";
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const page = pageFromParams(sp.page);
  const canEdit = can(ctx.role, "content.edit");
  const [list, assignees, projects] = await Promise.all([
    listTasks(ctx, { view, q, page, pageSize: PAGE_SIZE }),
    listAssignees(ctx),
    canEdit ? listProjects(ctx, { pageSize: 100 }) : Promise.resolve({ rows: [] }),
  ]);
  const base = `/app/${agencySlug}/tasks`;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Tasks</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          The SEO work for your team. Make a task from any problem in a site audit, give it an owner
          and a due date, and talk about it in the comments.
        </p>
      </div>

      {canEdit ? (
        <details className="rounded-lg border border-zinc-200 dark:border-zinc-800">
          <summary className="cursor-pointer px-4 py-3 font-medium">Add a task</summary>
          <div className="border-t border-zinc-200 p-4 dark:border-zinc-800">
            <TaskForm
              agencySlug={agencySlug}
              assignees={assignees}
              projects={projects.rows.map((p) => ({ id: p.id, name: p.name }))}
            />
          </div>
        </details>
      ) : null}

      <nav
        aria-label="Filter tasks"
        className="flex flex-wrap gap-4 border-b border-zinc-200 dark:border-zinc-800"
      >
        {TASK_VIEWS.map((v) => (
          <Link
            key={v}
            href={v === "open" ? base : `${base}?view=${v}`}
            aria-current={v === view ? "page" : undefined}
            className={
              v === view
                ? "-mb-px border-b-2 border-zinc-900 px-1 py-2 text-sm font-medium dark:border-zinc-100"
                : "-mb-px border-b-2 border-transparent px-1 py-2 text-sm text-zinc-600 hover:border-zinc-300 dark:text-zinc-400"
            }
          >
            {VIEW_LABEL[v]}
          </Link>
        ))}
      </nav>

      {list.rows.length === 0 ? (
        <EmptyState
          title={view === "done" ? "Nothing finished yet" : "No tasks here"}
          description={
            view === "open"
              ? "Add a task above, or open a site audit and press Create task on a problem."
              : "Nothing matches this view."
          }
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
                  {["Task", "Project", "Priority", "Status", "Owner", "Due"].map((h) => (
                    <th key={h} scope="col" className="px-4 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                  {canEdit ? (
                    <th scope="col" className="px-4 py-2">
                      <span className="sr-only">Actions</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {list.rows.map((t) => (
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
                    </td>
                    <td className="px-4 py-2">{t.project?.name ?? "-"}</td>
                    <td className="px-4 py-2">
                      <Badge
                        tone={PRIORITY_TONE[t.priority as keyof typeof PRIORITY_TONE] ?? "neutral"}
                      >
                        {priorityLabel(t.priority)}
                      </Badge>
                    </td>
                    <td className="px-4 py-2">{statusLabel(t.status)}</td>
                    <td className="px-4 py-2">{t.assignee ?? "Nobody"}</td>
                    <td className="whitespace-nowrap px-4 py-2">
                      {t.dueOn ?? "-"}
                      {isOverdue(t.dueOn, today, t.status) ? (
                        <Badge tone="danger" className="ml-2">
                          Overdue
                        </Badge>
                      ) : null}
                    </td>
                    {canEdit ? (
                      <td className="px-4 py-2">
                        {t.status !== "DONE" ? (
                          <TaskDoneButton agencySlug={agencySlug} taskId={t.id} title={t.title} />
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            basePath={base}
            page={page}
            pageSize={PAGE_SIZE}
            total={list.total}
            params={{ view: view === "open" ? undefined : view, q }}
            label="Task pages"
          />
        </>
      )}
    </div>
  );
}
