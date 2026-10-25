"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { setIssueStateAction } from "@/app/app/[agencySlug]/projects/[projectId]/audit/actions";
import { FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";

/** Bulk buttons for one issue type: ignore it, mark it fixed, or put it back on the list. */
export function IssueStateButtons({
  agencySlug,
  projectId,
  auditId,
  code,
  urls,
}: {
  agencySlug: string;
  projectId: string;
  auditId: string;
  code: string;
  /** Leave out to change every page that has the issue. */
  urls?: string[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function mark(status: "IGNORED" | "RESOLVED" | "OPEN", label: string) {
    setBusy(true);
    setError(null);
    setDone(null);
    const result = await setIssueStateAction(agencySlug, projectId, {
      auditId,
      code,
      status,
      ...(urls ? { urls } : {}),
    });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setDone(`${label}: ${result.data.changed} ${result.data.changed === 1 ? "page" : "pages"}.`);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => mark("RESOLVED", "Marked fixed")}
        >
          Mark as fixed
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => mark("IGNORED", "Ignored")}
        >
          Ignore
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => mark("OPEN", "Put back")}
        >
          Put back on the list
        </Button>
      </div>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      {done ? <FormMessage kind="success">{done}</FormMessage> : null}
    </div>
  );
}
