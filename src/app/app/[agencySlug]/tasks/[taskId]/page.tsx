import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApprovalPanel, TeamCommentForm } from "@/components/app/task-collab";
import { TaskDelete } from "@/components/app/task-extras";
import { TaskForm } from "@/components/app/task-form";
import { getPageContext } from "@/server/auth/page-context";
import { can } from "@/server/auth/permissions";
import { NotFoundError } from "@/server/services/errors";
import { listMilestones } from "@/server/services/milestones";
import { getTask, listAssignees } from "@/server/services/tasks";

export const metadata: Metadata = { title: "Task" };
export const dynamic = "force-dynamic";

export default async function TaskPage({
  params,
}: {
  params: Promise<{ agencySlug: string; taskId: string }>;
}) {
  const { agencySlug, taskId } = await params;
  const { ctx } = await getPageContext(agencySlug);
  const [task, assignees] = await Promise.all([
    getTask(ctx, taskId).catch((error) => {
      if (error instanceof NotFoundError) notFound();
      throw error;
    }),
    listAssignees(ctx),
  ]);
  const milestones = task.project ? await listMilestones(ctx, task.project.id) : [];
  const canEdit = can(ctx.role, "content.edit");
  const stamp = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm">
          <Link href={`/app/${agencySlug}/tasks`} className="underline-offset-4 hover:underline">
            All tasks
          </Link>
        </p>
        <h1 className="mt-1 text-2xl font-semibold">{task.title}</h1>
        {task.project ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Project:{" "}
            <Link
              href={`/app/${agencySlug}/projects/${task.project.id}`}
              className="underline-offset-4 hover:underline"
            >
              {task.project.name}
            </Link>
          </p>
        ) : null}
        {task.sourceAuditId && task.project ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            From a{" "}
            <Link
              href={`/app/${agencySlug}/projects/${task.project.id}/audit/${task.sourceAuditId}`}
              className="underline-offset-4 hover:underline"
            >
              site audit
            </Link>
            .
          </p>
        ) : null}
      </div>

      {canEdit ? (
        <section aria-labelledby="edit-heading" className="space-y-3">
          <h2 id="edit-heading" className="text-lg font-semibold">
            Details
          </h2>
          <TaskForm
            key={`${task.status}|${task.title}|${task.dueOn}|${task.assigneeId}|${task.priority}`}
            agencySlug={agencySlug}
            taskId={task.id}
            assignees={assignees}
            projects={[]}
            milestones={milestones.map((m) => ({ id: m.id, title: m.title }))}
            initial={{
              title: task.title,
              description: task.description,
              priority: task.priority,
              status: task.status,
              assigneeId: task.assigneeId ?? "",
              dueOn: task.dueOn ?? "",
              estimateMinutes: task.estimateMinutes === null ? "" : String(task.estimateMinutes),
              recurrence: task.recurrence,
              projectId: task.project?.id ?? "",
              clientVisible: task.clientVisible,
              milestoneId: task.milestoneId ?? "",
            }}
          />
        </section>
      ) : (
        <p className="whitespace-pre-wrap text-sm">{task.description}</p>
      )}

      <section aria-labelledby="approval-heading" className="space-y-3">
        <h2 id="approval-heading" className="text-lg font-semibold">
          Client approval
        </h2>
        <ApprovalPanel
          agencySlug={agencySlug}
          taskId={task.id}
          status={task.approvalStatus}
          note={task.approvalNote}
          answeredOn={task.approvalAt ? task.approvalAt.toISOString().slice(0, 10) : null}
          canEdit={canEdit}
          hasProject={!!task.project}
        />
      </section>

      <section aria-labelledby="comments-heading" className="space-y-3">
        <h2 id="comments-heading" className="text-lg font-semibold">
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
                  {c.fromClient ? (
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">
                      Client
                    </span>
                  ) : c.clientVisible ? (
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">
                      Visible to the client
                    </span>
                  ) : (
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">
                      Team only
                    </span>
                  )}{" "}
                  <span className="text-xs font-normal text-zinc-600 dark:text-zinc-400">
                    {stamp.format(c.createdAt)} UTC
                  </span>
                </p>
                <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
              </li>
            ))}
          </ul>
        )}
        {canEdit ? (
          <TeamCommentForm
            agencySlug={agencySlug}
            taskId={task.id}
            clientCanSee={task.clientVisible}
          />
        ) : null}
      </section>

      {can(ctx.role, "content.delete") ? (
        <TaskDelete agencySlug={agencySlug} taskId={task.id} />
      ) : null}
    </div>
  );
}
