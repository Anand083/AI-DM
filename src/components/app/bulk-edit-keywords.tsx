"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { bulkEditKeywordsAction } from "@/app/app/[agencySlug]/projects/[projectId]/rankings/actions";
import { Field, FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/** Add or remove tags, or set the target page, for the keywords chosen in the table. */
export function BulkEditKeywords({
  agencySlug,
  projectId,
  ids,
  onDone,
}: {
  agencySlug: string;
  projectId: string;
  ids: string[];
  onDone: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [addTags, setAddTags] = useState("");
  const [removeTags, setRemoveTags] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [clearTarget, setClearTarget] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function apply(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    const result = await bulkEditKeywordsAction(agencySlug, projectId, {
      ids,
      addTags,
      removeTags,
      ...(clearTarget ? { targetUrl: null } : targetUrl.trim() ? { targetUrl } : {}),
    });
    setBusy(false);
    if (!result.ok) {
      const next: Record<string, string> = {};
      for (const [k, m] of Object.entries(result.fieldErrors ?? {}))
        next[k.replace(/^values\./, "")] = m;
      setFields(next);
      return setError(result.error);
    }
    toast(
      "success",
      `Updated ${result.data.changed} ${result.data.changed === 1 ? "keyword" : "keywords"}.`,
    );
    router.refresh();
    onDone();
  }

  return (
    <form onSubmit={apply} className="grid w-full gap-3 sm:grid-cols-3" noValidate>
      <Field
        id="bulk-add-tags"
        label="Add tags"
        value={addTags}
        placeholder="brand, local"
        onChange={(e) => setAddTags(e.target.value)}
      />
      <Field
        id="bulk-remove-tags"
        label="Remove tags"
        value={removeTags}
        onChange={(e) => setRemoveTags(e.target.value)}
      />
      <Field
        id="bulk-target"
        label="Set target page"
        value={targetUrl}
        placeholder="https://example.com/page"
        disabled={clearTarget}
        error={fields.targetUrl}
        onChange={(e) => setTargetUrl(e.target.value)}
      />
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input
          type="checkbox"
          checked={clearTarget}
          onChange={(e) => setClearTarget(e.target.checked)}
        />
        Remove the target page instead
      </label>
      <div className="flex items-end">
        <Button type="submit" disabled={busy}>
          Apply to {ids.length} {ids.length === 1 ? "keyword" : "keywords"}
        </Button>
      </div>
      {error && !fields.targetUrl ? (
        <div className="sm:col-span-3">
          <FormMessage kind="error">{error}</FormMessage>
        </div>
      ) : null}
    </form>
  );
}
