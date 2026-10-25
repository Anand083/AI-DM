"use client";

import {
  checkListingsAction,
  checkLocalRanksAction,
} from "@/app/app/[agencySlug]/projects/[projectId]/locations/actions";
import { JobButton } from "./job-button";

export function CheckLocalRanksButton({
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
      run={() => checkLocalRanksAction(agencySlug, projectId)}
      label={label}
      busyText="Checking local positions. This page updates by itself."
      doneToday={doneToday}
      doneText="Already checked today."
    />
  );
}

export function CheckListingsButton({
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
      run={() => checkListingsAction(agencySlug, projectId)}
      label={label}
      busyText="Looking up the listings. This page updates by itself."
      doneToday={doneToday}
      doneText="Already checked today."
    />
  );
}
