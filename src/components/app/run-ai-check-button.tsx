"use client";

import { runAiCheckAction } from "@/app/app/[agencySlug]/projects/[projectId]/ai-visibility/actions";
import { JobButton } from "./job-button";

export function RunAiCheckButton({
  agencySlug,
  projectId,
  label,
  checkedToday,
}: {
  agencySlug: string;
  projectId: string;
  label: string;
  checkedToday: boolean;
}) {
  return (
    <JobButton
      run={() => runAiCheckAction(agencySlug, projectId)}
      label={label}
      busyText="Asking the AI engines. This page updates by itself."
      doneToday={checkedToday}
      doneText="Already checked today."
    />
  );
}
