"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  deleteScheduleAction,
  toggleScheduleAction,
} from "@/app/app/[agencySlug]/reports/schedules/actions";
import { FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function ScheduleRowActions({
  agencySlug,
  scheduleId,
  enabled,
  label,
}: {
  agencySlug: string;
  scheduleId: string;
  enabled: boolean;
  label: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    setError(null);
    const result = await toggleScheduleAction(agencySlug, scheduleId, !enabled);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" className="h-8 px-3" onClick={toggle} disabled={busy}>
        {enabled ? "Pause" : "Resume"}
        <span className="sr-only"> schedule for {label}</span>
      </Button>
      <ConfirmDialog
        trigger="Delete"
        title="Delete this schedule?"
        description="No more reports will be sent. Reports already made are kept."
        confirmLabel="Delete"
        onConfirm={async () => {
          const result = await deleteScheduleAction(agencySlug, scheduleId);
          if (!result.ok) return result.error;
          router.refresh();
          return null;
        }}
      />
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
    </div>
  );
}
