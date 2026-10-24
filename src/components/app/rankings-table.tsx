"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteKeywordsAction } from "@/app/app/[agencySlug]/projects/[projectId]/rankings/actions";
import { ChangeBadge, PositionText } from "@/components/app/rank-widgets";
import { CheckNowButton } from "@/components/app/check-now-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";

export type RankingRow = {
  id: string;
  phrase: string;
  tags: string[];
  checked: boolean;
  position: number | null;
  url: string | null;
  features: string[];
  best: number | null;
  changeDay: number | null;
  changeWeek: number | null;
  changeMonth: number | null;
};

const FEATURE_LABEL: Record<string, string> = {
  featured_snippet: "Snippet",
  people_also_ask: "PAA",
  local_pack: "Local",
  image_pack: "Images",
  video: "Video",
  sitelinks: "Sitelinks",
  knowledge_panel: "Panel",
};

function path(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname === "/" ? "/" : u.pathname;
  } catch {
    return url;
  }
}

function SortHeader({
  href,
  active,
  dir,
  children,
}: {
  href: string;
  active: boolean;
  dir: string;
  children: string;
}) {
  const Icon = !active ? ChevronsUpDown : dir === "desc" ? ArrowDown : ArrowUp;
  return (
    <th
      scope="col"
      className="px-3 py-2 font-medium"
      aria-sort={active ? (dir === "desc" ? "descending" : "ascending") : "none"}
    >
      <Link href={href} className="inline-flex items-center gap-1 hover:underline">
        {children}
        <Icon className="size-3.5" aria-hidden="true" />
      </Link>
    </th>
  );
}

export function RankingsTable({
  agencySlug,
  projectId,
  rows,
  sortHrefs,
  sort,
  dir,
  canEdit,
  canRun,
}: {
  agencySlug: string;
  projectId: string;
  rows: RankingRow[];
  /** Link for each sortable column: the same page sorted by that column. */
  sortHrefs: Record<"keyword" | "position" | "change" | "best", string>;
  sort: string;
  dir: string;
  canEdit: boolean;
  canRun: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const base = `/app/${agencySlug}/projects/${projectId}/rankings`;
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <span className="text-sm font-medium" aria-live="polite">
            {selected.size} selected
          </span>
          {canRun ? (
            <CheckNowButton
              agencySlug={agencySlug}
              projectId={projectId}
              keywordIds={[...selected]}
              label="Check selected now"
            />
          ) : null}
          {canEdit ? (
            <ConfirmDialog
              trigger="Delete selected"
              title={`Delete ${selected.size} ${selected.size === 1 ? "keyword" : "keywords"}?`}
              description="The keywords and their history will be removed."
              confirmLabel="Delete"
              onConfirm={async () => {
                const result = await deleteKeywordsAction(agencySlug, projectId, [...selected]);
                if (!result.ok) return result.error;
                toast(
                  "success",
                  `Deleted ${result.data.deleted} ${result.data.deleted === 1 ? "keyword" : "keywords"}.`,
                );
                setSelected(new Set());
                router.refresh();
                return null;
              }}
            />
          ) : null}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm" aria-label="Keyword rankings">
          <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <tr>
              <th scope="col" className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label="Select all keywords on this page"
                  checked={allSelected}
                  onChange={() =>
                    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))
                  }
                />
              </th>
              <SortHeader href={sortHrefs.keyword} active={sort === "keyword"} dir={dir}>
                Keyword
              </SortHeader>
              <SortHeader href={sortHrefs.position} active={sort === "position"} dir={dir}>
                Position
              </SortHeader>
              <th scope="col" className="px-3 py-2 font-medium">
                1 day
              </th>
              <SortHeader href={sortHrefs.change} active={sort === "change"} dir={dir}>
                7 days
              </SortHeader>
              <th scope="col" className="px-3 py-2 font-medium">
                30 days
              </th>
              <SortHeader href={sortHrefs.best} active={sort === "best"} dir={dir}>
                Best
              </SortHeader>
              <th scope="col" className="px-3 py-2 font-medium">
                Ranking page
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Features
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Tags
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label={`Select ${r.phrase}`}
                    checked={selected.has(r.id)}
                    onChange={() => toggle(r.id)}
                  />
                </td>
                <td className="px-3 py-2 font-medium">
                  <Link href={`${base}/${r.id}`} className="underline-offset-4 hover:underline">
                    {r.phrase}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <PositionText position={r.position} checked={r.checked} />
                </td>
                <td className="px-3 py-2">
                  <ChangeBadge change={r.changeDay} />
                </td>
                <td className="px-3 py-2">
                  <ChangeBadge change={r.changeWeek} />
                </td>
                <td className="px-3 py-2">
                  <ChangeBadge change={r.changeMonth} />
                </td>
                <td className="px-3 py-2 tabular-nums">{r.best ?? "-"}</td>
                <td className="max-w-48 truncate px-3 py-2">
                  {r.url ? (
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="underline-offset-4 hover:underline"
                      title={r.url}
                    >
                      {path(r.url)}
                    </a>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-3 py-2">
                  {r.features.length === 0
                    ? "-"
                    : r.features.map((f) => FEATURE_LABEL[f] ?? f).join(", ")}
                </td>
                <td className="px-3 py-2">{r.tags.length === 0 ? "-" : r.tags.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
