"use client";

import { refreshGapAction } from "@/app/app/[agencySlug]/projects/[projectId]/competitors/actions";
import { JobButton } from "./job-button";

export function RefreshGapButton({
  agencySlug,
  projectId,
  label,
  refreshedToday,
}: {
  agencySlug: string;
  projectId: string;
  label: string;
  refreshedToday: boolean;
}) {
  return (
    <JobButton
      run={() => refreshGapAction(agencySlug, projectId)}
      label={label}
      busyText="Looking for keyword gaps. This page updates by itself."
      doneToday={refreshedToday}
      doneText="Already refreshed today."
    />
  );
}
