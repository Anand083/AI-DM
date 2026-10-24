"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { auditProgressAction } from "@/app/app/[agencySlug]/projects/[projectId]/audit/actions";

/** Shows a progress bar for a running audit and refreshes the page when it is done. */
export function AuditProgress({
  agencySlug,
  projectId,
  auditId,
  initialProgress,
}: {
  agencySlug: string;
  projectId: string;
  auditId: string;
  initialProgress: number;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState(initialProgress);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      const result = await auditProgressAction(agencySlug, projectId, auditId);
      if (stopped) return;
      if (result.ok) {
        setProgress(result.data.progress);
        if (result.data.status === "COMPLETED" || result.data.status === "FAILED") {
          router.refresh();
          return;
        }
      }
      timer = setTimeout(tick, 3000);
    }
    timer = setTimeout(tick, 3000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [agencySlug, projectId, auditId, router]);

  return (
    <div className="space-y-2">
      <div
        role="progressbar"
        aria-label="Audit progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        className="h-3 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
      >
        <div
          className="h-full rounded-full bg-zinc-900 transition-all dark:bg-zinc-100"
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Checking your website... {progress}%. You can leave this page; it keeps running.
      </p>
    </div>
  );
}
