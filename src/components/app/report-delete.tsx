"use client";

import { useRouter } from "next/navigation";
import { deleteReportAction } from "@/app/app/[agencySlug]/reports/actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function ReportDelete({
  agencySlug,
  reportId,
  goToList,
}: {
  agencySlug: string;
  reportId: string;
  goToList?: boolean;
}) {
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger="Delete"
      title="Delete this report?"
      description="The report, its PDF and its share link will be removed."
      confirmLabel="Delete"
      onConfirm={async () => {
        const result = await deleteReportAction(agencySlug, reportId);
        if (!result.ok) return result.error;
        if (goToList) router.push(`/app/${agencySlug}/reports`);
        else router.refresh();
        return null;
      }}
    />
  );
}
