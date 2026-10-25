"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveAuditConfigAction } from "@/app/app/[agencySlug]/projects/[projectId]/audit/actions";
import { FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";

/** Crawl settings: paths to skip, whether to follow robots.txt, and phone or computer view. */
export function AuditConfigForm({
  agencySlug,
  projectId,
  initial,
  canEdit,
}: {
  agencySlug: string;
  projectId: string;
  initial: { excludePaths: string[]; respectRobots: boolean; mobile: boolean };
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [paths, setPaths] = useState(initial.excludePaths.join("\n"));
  const [robots, setRobots] = useState(initial.respectRobots);
  const [mobile, setMobile] = useState(initial.mobile);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await saveAuditConfigAction(agencySlug, projectId, {
      excludePaths: paths
        .split("\n")
        .map((p) => p.trim())
        .filter(Boolean),
      respectRobots: robots,
      mobile,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.fieldErrors?.["values.excludePaths"] ?? result.error);
      return;
    }
    toast("success", "Crawl settings saved.");
    router.refresh();
  }

  return (
    <form onSubmit={save} className="max-w-xl space-y-4" noValidate>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <div className="space-y-1.5">
        <Label htmlFor="exclude-paths">Skip these paths (one per line)</Label>
        <Textarea
          id="exclude-paths"
          value={paths}
          rows={4}
          disabled={!canEdit}
          placeholder={"/cart\n/account"}
          onChange={(e) => setPaths(e.target.value)}
        />
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          Any page whose address starts with one of these is left out of the audit.
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={robots}
          disabled={!canEdit}
          onChange={(e) => setRobots(e.target.checked)}
        />
        Follow the rules in robots.txt
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={mobile}
          disabled={!canEdit}
          onChange={(e) => setMobile(e.target.checked)}
        />
        Check as a phone
      </label>
      {canEdit ? (
        <Button type="submit" disabled={busy}>
          Save crawl settings
        </Button>
      ) : null}
    </form>
  );
}
