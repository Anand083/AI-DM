"use client";

import { useRouter } from "next/navigation";
import { deleteLeadAction } from "@/app/app/[agencySlug]/leads/actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function LeadDelete({
  agencySlug,
  leadId,
  email,
}: {
  agencySlug: string;
  leadId: string;
  email: string;
}) {
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger="Delete"
      title="Delete this lead?"
      description={`The lead from ${email} will be removed for good.`}
      confirmLabel="Delete"
      onConfirm={async () => {
        const result = await deleteLeadAction(agencySlug, leadId);
        if (!result.ok) return result.error;
        router.refresh();
        return null;
      }}
    />
  );
}
