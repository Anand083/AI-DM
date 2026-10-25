"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { addCompetitorAction } from "@/app/app/[agencySlug]/projects/[projectId]/competitors/actions";
import { FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";

/** One click to start tracking a suggested website as a competitor. */
export function AddSuggestedCompetitorButton({
  agencySlug,
  projectId,
  domain,
}: {
  agencySlug: string;
  projectId: string;
  domain: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function add() {
    setBusy(true);
    setError(null);
    const result = await addCompetitorAction(agencySlug, projectId, { domain });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    router.refresh();
  }
  return (
    <div className="space-y-1">
      <Button type="button" variant="outline" disabled={busy} onClick={() => void add()}>
        Track {domain}
      </Button>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
    </div>
  );
}
