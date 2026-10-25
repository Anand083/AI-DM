"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { trackGapKeywordsAction } from "@/app/app/[agencySlug]/projects/[projectId]/competitors/actions";
import { FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export type GapRow = {
  id: string;
  keyword: string;
  position: number;
  volume: number;
  competitor: string;
  url: string | null;
};

/** The keyword gap. Selected keywords can be added to the project's rank tracker. */
export function GapTable({
  agencySlug,
  projectId,
  rows,
  canEdit,
}: {
  agencySlug: string;
  projectId: string;
  rows: GapRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.keyword));
  const toggle = (keyword: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(keyword)) next.delete(keyword);
      else next.add(keyword);
      return next;
    });

  async function addToTracker() {
    setBusy(true);
    setError(null);
    const result = await trackGapKeywordsAction(agencySlug, projectId, [...selected]);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const r = result.data;
    toast(
      "success",
      `Added ${r.added} ${r.added === 1 ? "keyword" : "keywords"} to the rank tracker${r.alreadyTracked ? ` (${r.alreadyTracked} already tracked)` : ""}.`,
    );
    setSelected(new Set());
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void addToTracker()} disabled={busy || selected.size === 0}>
            {busy ? "Adding..." : `Add to rank tracker (${selected.size})`}
          </Button>
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            Pick keywords in the table first.
          </span>
        </div>
      ) : null}
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <div
        role="region"
        aria-label="Keyword gap list"
        tabIndex={0}
        className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800"
      >
        <table className="w-full text-left text-sm" aria-label="Keyword gap">
          <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <tr>
              {canEdit ? (
                <th scope="col" className="w-10 px-4 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select all keywords on this page"
                    checked={allSelected}
                    onChange={() =>
                      setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.keyword)))
                    }
                  />
                </th>
              ) : null}
              {["Keyword", "Search volume", "Competitor", "Their position"].map((h) => (
                <th key={h} scope="col" className="px-4 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className="border-b border-zinc-100 last:border-0 dark:border-zinc-900"
              >
                {canEdit ? (
                  <td className="px-4 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.keyword}`}
                      checked={selected.has(r.keyword)}
                      onChange={() => toggle(r.keyword)}
                    />
                  </td>
                ) : null}
                <td className="px-4 py-2 font-medium">{r.keyword}</td>
                <td className="px-4 py-2 tabular-nums">{r.volume.toLocaleString("en-US")}</td>
                <td className="px-4 py-2">{r.competitor}</td>
                <td className="px-4 py-2 tabular-nums">{r.position}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
