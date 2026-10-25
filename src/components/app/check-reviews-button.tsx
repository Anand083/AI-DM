"use client";

import { checkReviewsAction } from "@/app/app/[agencySlug]/projects/[projectId]/reviews/actions";
import { JobButton } from "./job-button";

export function CheckReviewsButton({
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
      run={() => checkReviewsAction(agencySlug, projectId)}
      label={label}
      busyText="Reading reviews. This page updates by itself."
      doneToday={checkedToday}
      doneText="Already checked today."
    />
  );
}
