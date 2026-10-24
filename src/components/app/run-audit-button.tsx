"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { startAuditAction } from "@/app/app/[agencySlug]/projects/[projectId]/audit/actions";
import { FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";

export function RunAuditButton({
  agencySlug,
  projectId,
  label = "Run audit",
  disabled,
}: {
  agencySlug: string;
  projectId: string;
  label?: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const result = await startAuditAction(agencySlug, projectId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.push(`/app/${agencySlug}/projects/${projectId}/audit/${result.data.auditId}`);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <Button onClick={run} disabled={busy || disabled}>
        {busy ? "Starting..." : label}
      </Button>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
    </div>
  );
}
