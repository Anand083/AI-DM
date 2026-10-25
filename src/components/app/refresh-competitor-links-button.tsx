"use client";

import { refreshCompetitorLinksAction } from "@/app/app/[agencySlug]/projects/[projectId]/competitors/actions";
import { JobButton } from "./job-button";

export function RefreshCompetitorLinksButton({
  agencySlug,
  projectId,
  label,
  doneToday,
}: {
  agencySlug: string;
  projectId: string;
  label: string;
  doneToday: boolean;
}) {
  return (
    <JobButton
      run={() => refreshCompetitorLinksAction(agencySlug, projectId)}
      label={label}
      busyText="Reading the competitors' links. This page updates by itself."
      doneToday={doneToday}
      doneText="Already updated today."
    />
  );
}
