"use client";

import { pauseQueueAction, removeJobAction, retryJobAction } from "@/app/admin-actions";
import { AdminButton } from "@/components/admin/admin-button";

export function QueueToggle({ queue, paused }: { queue: string; paused: boolean }) {
  return (
    <AdminButton
      label={paused ? "Resume" : "Pause"}
      run={() => pauseQueueAction({ queue, paused: !paused })}
      success={paused ? `${queue} resumed.` : `${queue} paused.`}
      confirm={
        paused
          ? undefined
          : {
              title: `Pause ${queue}?`,
              description: "No jobs in this queue will run until you resume it.",
            }
      }
    />
  );
}

export function FailedJobActions({ queue, jobId }: { queue: string; jobId: string }) {
  return (
    <span className="flex flex-wrap gap-2">
      <AdminButton
        label="Retry"
        run={() => retryJobAction({ queue, jobId })}
        success="Job queued again."
      />
      <AdminButton
        label="Remove"
        run={() => removeJobAction({ queue, jobId })}
        success="Job removed."
        confirm={{ title: "Remove this job?", description: "The job and its error are deleted." }}
      />
    </span>
  );
}
