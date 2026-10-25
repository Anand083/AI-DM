"use client";

import { checkBacklinksAction } from "@/app/app/[agencySlug]/projects/[projectId]/backlinks/actions";
import { JobButton } from "./job-button";

export function CheckBacklinksButton({
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
      run={() => checkBacklinksAction(agencySlug, projectId)}
      label={label}
      busyText="Checking backlinks. This page updates by itself."
      doneToday={checkedToday}
      doneText="Already checked today."
    />
  );
}
