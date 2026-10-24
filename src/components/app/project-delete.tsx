"use client";

import { useRouter } from "next/navigation";
import { deleteProjectAction } from "@/app/app/[agencySlug]/clients/actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function ProjectDelete({
  agencySlug,
  projectId,
  projectName,
}: {
  agencySlug: string;
  projectId: string;
  projectName: string;
}) {
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger="Delete project"
      title={`Delete ${projectName}?`}
      description="The project and its data will be removed. This cannot be undone from the app."
      confirmLabel="Delete project"
      onConfirm={async () => {
        const result = await deleteProjectAction(agencySlug, projectId);
        if (!result.ok) return result.error;
        router.push(`/app/${agencySlug}/projects`);
        router.refresh();
        return null;
      }}
    />
  );
}
