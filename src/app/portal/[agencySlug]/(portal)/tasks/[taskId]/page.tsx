import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApprovalButtons, PortalCommentForm } from "@/components/app/portal-task-actions";
import { approvalLabel, priorityLabel, statusLabel } from "@/lib/tasks";
import { getPortalPageContext } from "@/server/auth/portal-context";
import { NotFoundError } from "@/server/services/errors";
import { getPortalTask } from "@/server/services/portal-tasks";

export const metadata: Metadata = { title: "Task" };
export const dynamic = "force-dynamic";

export default async function PortalTaskPage({
  params,
}: {
  params: Promise<{ agencySlug: string; taskId: string }>;
}) {
  const { agencySlug, taskId } = await params;
  const { ctx } = await getPortalPageContext(agencySlug);
  const task = await getPortalTask(ctx, taskId).catch((error) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const stamp = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });

  return (
    <>
      <div>
        <Link href={`/portal/${agencySlug}/tasks`} className="text-sm underline underline-offset-4">
          All tasks
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{task.title}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {task.project?.name} | {statusLabel(task.status)} | {priorityLabel(task.priority)}{" "}
          priority
          {task.dueOn ? ` | Due ${task.dueOn}` : ""}
        </p>
      </div>
      {task.description ? <p className="whitespace-pre-wrap text-sm">{task.description}</p> : null}

      {task.approvalStatus === "REQUESTED" ? (
        <ApprovalButtons agencySlug={agencySlug} taskId={task.id} />
      ) : task.approvalStatus !== "NONE" ? (
        <p role="status" className="text-sm">
          <span className="font-medium">{approvalLabel(task.approvalStatus)}.</span>
          {task.approvalNote ? ` Your note: ${task.approvalNote}` : ""}
        </p>
      ) : null}

      <section aria-labelledby="c-heading" className="space-y-3">
        <h2 id="c-heading" className="text-lg font-semibold">
          Comments
        </h2>
        {task.comments.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">No comments yet.</p>
        ) : (
          <ul aria-label="Comments" className="space-y-3">
            {task.comments.map((c) => (
              <li
                key={c.id}
                className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800"
              >
                <p className="font-medium">
                  {c.author}{" "}
                  <span className="text-xs font-normal text-zinc-600 dark:text-zinc-400">
                    {stamp.format(c.createdAt)} UTC
                  </span>
                </p>
                <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
              </li>
            ))}
          </ul>
        )}
        <PortalCommentForm agencySlug={agencySlug} taskId={task.id} />
      </section>
    </>
  );
}
