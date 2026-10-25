"use client";

import { refreshKeywordMetricsAction } from "@/app/app/[agencySlug]/projects/[projectId]/keyword-insights/actions";
import { JobButton } from "./job-button";

export function RefreshMetricsButton({
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
      run={() => refreshKeywordMetricsAction(agencySlug, projectId)}
      label={label}
      busyText="Reading search volume and Bing positions. This page updates by itself."
      doneToday={doneToday}
      doneText="Already updated today."
    />
  );
}
