"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { archiveClientAction, deleteClientAction } from "@/app/app/[agencySlug]/clients/actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";

export function ClientActions({
  agencySlug,
  clientId,
  clientName,
  archived,
  canEdit,
  canDelete,
}: {
  agencySlug: string;
  clientId: string;
  clientName: string;
  archived: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function toggleArchive() {
    startTransition(async () => {
      const result = await archiveClientAction(agencySlug, clientId, !archived);
      if (result.ok) {
        toast("success", archived ? "Client restored." : "Client archived.");
        router.refresh();
      } else {
        toast("error", result.error);
      }
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {canEdit ? (
        <Button variant="outline" onClick={toggleArchive} disabled={pending}>
          {archived ? "Restore client" : "Archive client"}
        </Button>
      ) : null}
      {canDelete ? (
        <ConfirmDialog
          trigger="Delete client"
          title={`Delete ${clientName}?`}
          description="The client and all its projects will be removed. This cannot be undone from the app."
          confirmLabel="Delete client"
          onConfirm={async () => {
            const result = await deleteClientAction(agencySlug, clientId);
            if (!result.ok) return result.error;
            router.push(`/app/${agencySlug}/clients`);
            router.refresh();
            return null;
          }}
        />
      ) : null}
    </div>
  );
}
