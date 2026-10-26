"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { addToTrackerAction, saveToListAction } from "@/app/app/[agencySlug]/research/actions";
import { Sparkline } from "@/components/app/sparkline";
import { FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { difficultyLabel, formatCpc, INTENT_LABEL } from "@/lib/research";
import type { KeywordIntent } from "@/server/providers/seo/types";

export type ResearchRow = {
  keyword: string;
  volume: number;
  cpcMicros: number;
  difficulty: number;
  intent: KeywordIntent;
  trend: number[];
};

type Option = { id: string; name: string };

/** Results table with selection. Selected rows can be saved to a list or added to a project's rank tracker. */
export function ResearchTable({
  agencySlug,
  rows,
  locationCode,
  languageCode,
  lists,
  projects,
  canEdit,
}: {
  agencySlug: string;
  rows: ResearchRow[];
  locationCode: number;
  languageCode: string;
  lists: Option[];
  projects: Option[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [listId, setListId] = useState("");
  const [newListName, setNewListName] = useState("");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.keyword));
  const chosen = rows.filter((r) => selected.has(r.keyword));

  function toggle(keyword: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(keyword)) next.delete(keyword);
      else next.add(keyword);
      return next;
    });
  }

  async function saveToList() {
    setBusy(true);
    setError(null);
    const result = await saveToListAction(agencySlug, {
      ...(listId ? { listId } : { newListName }),
      items: chosen.map((r) => ({
        phrase: r.keyword,
        volume: r.volume,
        cpcMicros: r.cpcMicros,
        difficulty: r.difficulty,
        intent: r.intent,
        locationCode,
        languageCode,
      })),
    });
    setBusy(false);
    if (!result.ok) {
      setError(Object.values(result.fieldErrors ?? {})[0] ?? result.error);
      return;
    }
    toast(
      "success",
      `Saved ${result.data.added} ${result.data.added === 1 ? "keyword" : "keywords"} to your list${result.data.skipped ? ` (${result.data.skipped} already there)` : ""}.`,
    );
    setSelected(new Set());
    setNewListName("");
    router.refresh();
  }

  async function addToTracker() {
    setBusy(true);
    setError(null);
    const result = await addToTrackerAction(
      agencySlug,
      projectId,
      chosen.map((r) => r.keyword),
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const projectName = projects.find((p) => p.id === projectId)?.name ?? "the project";
    toast(
      "success",
      `Added ${result.data.added} ${result.data.added === 1 ? "keyword" : "keywords"} to ${projectName}${result.data.alreadyTracked ? ` (${result.data.alreadyTracked} already tracked)` : ""}.`,
    );
    setSelected(new Set());
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {canEdit && selected.size > 0 ? (
        <div className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm font-medium" aria-live="polite">
            {selected.size} selected
          </p>
          {error ? <FormMessage kind="error">{error}</FormMessage> : null}
          {projects.length > 0 ? (
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="track-project" className="mb-1 block text-xs font-medium">
                  Add to rank tracker of
                </label>
                <Select
                  id="track-project"
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
              <Button variant="outline" onClick={addToTracker} disabled={busy || !projectId}>
                Add to rank tracker
              </Button>
            </div>
          ) : (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Create a project first to track these keywords.
            </p>
          )}
          <details className="rounded-md border border-zinc-200 dark:border-zinc-800">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
              Save to a list for later (optional)
            </summary>
            <div className="p-3">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label htmlFor="save-list" className="mb-1 block text-xs font-medium">
                    Save to list
                  </label>
                  <Select
                    id="save-list"
                    value={listId}
                    onChange={(e) => setListId(e.target.value)}
                    className="w-48"
                  >
                    <option value="">New list...</option>
                    {lists.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </Select>
                </div>
                {listId === "" ? (
                  <div>
                    <label htmlFor="new-list" className="mb-1 block text-xs font-medium">
                      New list name
                    </label>
                    <Input
                      id="new-list"
                      value={newListName}
                      onChange={(e) => setNewListName(e.target.value)}
                      className="w-48"
                    />
                  </div>
                ) : null}
                <Button
                  onClick={saveToList}
                  disabled={busy || (listId === "" && newListName.trim().length < 2)}
                >
                  Save to list
                </Button>
              </div>
            </div>
          </details>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm" aria-label="Keyword ideas">
          <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <tr>
              <th scope="col" className="w-10 px-3 py-2">
                {canEdit ? (
                  <input
                    type="checkbox"
                    aria-label="Select all keywords on this page"
                    checked={allSelected}
                    onChange={() =>
                      setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.keyword)))
                    }
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
              <th scope="col" className="px-3 py-2 font-medium">
                12 months
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {rows.map((r) => (
              <tr key={r.keyword}>
                <td className="px-3 py-2">
                  {canEdit ? (
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.keyword}`}
                      checked={selected.has(r.keyword)}
                      onChange={() => toggle(r.keyword)}
                    />
                  ) : null}
                </td>
                <td className="px-3 py-2 font-medium">{r.keyword}</td>
                <td className="px-3 py-2 tabular-nums">{r.volume.toLocaleString("en-US")}</td>
                <td className="px-3 py-2 tabular-nums">{formatCpc(r.cpcMicros)}</td>
                <td className="px-3 py-2 tabular-nums">
                  {r.difficulty}{" "}
                  <span className="text-zinc-600 dark:text-zinc-400">
                    ({difficultyLabel(r.difficulty)})
                  </span>
                </td>
                <td className="px-3 py-2">{INTENT_LABEL[r.intent]}</td>
                <td className="px-3 py-2">
                  <Sparkline values={r.trend} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
