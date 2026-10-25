"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  createTaskFromIssueAction,
  deleteTaskAction,
  updateTaskAction,
} from "@/app/app/[agencySlug]/tasks/actions";
import { FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";

/** Marks a task done from the list. */
export function TaskDoneButton({
  agencySlug,
  taskId,
  title,
}: {
  agencySlug: string;
  taskId: string;
  title: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      disabled={busy}
      aria-label={`Mark done: ${title}`}
      onClick={async () => {
        setBusy(true);
        const result = await updateTaskAction(agencySlug, taskId, { status: "DONE" });
        setBusy(false);
        if (!result.ok) return toast("error", result.error);
        toast("success", result.data.nextTaskId ? "Done. The next one is ready." : "Marked done.");
        router.refresh();
      }}
    >
      Done
    </Button>
  );
}

export function TaskDelete({ agencySlug, taskId }: { agencySlug: string; taskId: string }) {
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger="Delete task"
      title="Delete this task?"
      description="The task and its comments will be removed for good."
      confirmLabel="Delete"
      onConfirm={async () => {
        const result = await deleteTaskAction(agencySlug, taskId);
        if (!result.ok) return result.error;
        router.push(`/app/${agencySlug}/tasks`);
        router.refresh();
        return null;
      }}
    />
  );
}

/** On an audit issue: makes a task from it, or links to the one that is already open. */
export function CreateTaskFromIssueButton({
  agencySlug,
  projectId,
  auditId,
  code,
}: {
  agencySlug: string;
  projectId: string;
  auditId: string;
  code: string;
}) {
  const [busy, setBusy] = useState(false);
  const [task, setTask] = useState<{ id: string; existing: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (task) {
    return (
      <p role="status" className="text-sm">
        {task.existing ? "A task for this issue is already open. " : "Task created. "}
        <Link href={`/app/${agencySlug}/tasks/${task.id}`} className="underline underline-offset-4">
          Open the task
        </Link>
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const result = await createTaskFromIssueAction(agencySlug, projectId, auditId, code);
          setBusy(false);
          if (!result.ok) return setError(result.error);
          setTask(result.data);
        }}
      >
        Create task
      </Button>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
    </div>
  );
}
