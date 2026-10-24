"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  addToTrackerAction,
  deleteListAction,
  removeListItemsAction,
} from "@/app/app/[agencySlug]/research/actions";
import { FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { formatCpc, INTENT_LABEL } from "@/lib/research";
import type { KeywordIntent } from "@/server/providers/seo/types";

export type ListItemRow = {
  id: string;
  phrase: string;
  volume: number;
  cpcMicros: number;
  difficulty: number;
  intent: string;
};

export function ListItemsTable({
  agencySlug,
  listId,
  listName,
  rows,
  projects,
  canEdit,
  canDelete,
}: {
  agencySlug: string;
  listId: string;
  listName: string;
  rows: ListItemRow[];
  projects: { id: string; name: string }[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = rows.filter((r) => selected.has(r.id));
  const all = rows.length > 0 && selected.size === rows.length;

  function toggle(id: string) {
    setSelected((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function track() {
    setBusy(true);
    setError(null);
    const phrases = (chosen.length > 0 ? chosen : rows).map((r) => r.phrase);
    const result = await addToTrackerAction(agencySlug, projectId, phrases);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    toast(
      "success",
      `Added ${result.data.added} ${result.data.added === 1 ? "keyword" : "keywords"} to the rank tracker${result.data.alreadyTracked ? ` (${result.data.alreadyTracked} already tracked)` : ""}.`,
    );
    setSelected(new Set());
  }

  return (
    <div className="space-y-4">
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <div className="flex flex-wrap items-end gap-3">
        {canEdit && projects.length > 0 ? (
          <>
            <div>
              <label htmlFor="list-project" className="mb-1 block text-xs font-medium">
                Rank tracker project
              </label>
              <Select
                id="list-project"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-64"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button variant="outline" onClick={track} disabled={busy || rows.length === 0}>
              {selected.size > 0
                ? `Add ${selected.size} selected to rank tracker`
                : "Add all to rank tracker"}
            </Button>
          </>
        ) : null}
        {canEdit && selected.size > 0 ? (
          <ConfirmDialog
            trigger="Remove selected"
            title={`Remove ${selected.size} ${selected.size === 1 ? "keyword" : "keywords"} from this list?`}
            description="They are only removed from the list. Tracked keywords are not affected."
            confirmLabel="Remove"
            onConfirm={async () => {
              const result = await removeListItemsAction(agencySlug, listId, [...selected]);
              if (!result.ok) return result.error;
              setSelected(new Set());
              router.refresh();
              return null;
            }}
          />
        ) : null}
        {canDelete ? (
          <ConfirmDialog
            trigger="Delete list"
            title={`Delete “${listName}”?`}
            description="The list and its keywords are removed. Tracked keywords are not affected."
            confirmLabel="Delete list"
            onConfirm={async () => {
              const result = await deleteListAction(agencySlug, listId);
              if (!result.ok) return result.error;
              router.push(`/app/${agencySlug}/research/lists`);
              router.refresh();
              return null;
            }}
          />
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm" aria-label="Keywords in this list">
          <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <tr>
              <th scope="col" className="w-10 px-3 py-2">
                {canEdit ? (
                  <input
                    type="checkbox"
                    aria-label="Select all keywords on this page"
                    checked={all}
                    onChange={() => setSelected(all ? new Set() : new Set(rows.map((r) => r.id)))}
                  />
                ) : null}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Keyword
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Searches a month
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Cost per click
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Difficulty
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Intent
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2">
                  {canEdit ? (
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.phrase}`}
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                    />
                  ) : null}
                </td>
                <td className="px-3 py-2 font-medium">{r.phrase}</td>
                <td className="px-3 py-2 tabular-nums">{r.volume.toLocaleString("en-US")}</td>
                <td className="px-3 py-2 tabular-nums">{formatCpc(r.cpcMicros)}</td>
                <td className="px-3 py-2 tabular-nums">{r.difficulty}</td>
                <td className="px-3 py-2">{INTENT_LABEL[r.intent as KeywordIntent] ?? r.intent}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
