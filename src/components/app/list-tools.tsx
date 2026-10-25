"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  bulkClientsAction,
  bulkTasksAction,
  deleteViewAction,
  saveViewAction,
  setDashboardPartsAction,
} from "@/app/app/[agencySlug]/views/actions";
import { FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { DASHBOARD_PART_LABEL, DASHBOARD_PARTS, viewHref, type ViewScope } from "@/lib/saved-views";

export type SavedViewItem = { id: string; name: string; params: Record<string, string> };

/** Saved filters for one list: open one, delete one, or save the filters on screen. */
export function SavedViews({
  agencySlug,
  scope,
  basePath,
  current,
  views,
}: {
  agencySlug: string;
  scope: ViewScope;
  basePath: string;
  /** The filters in the address now. */
  current: Record<string, string>;
  views: SavedViewItem[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const hasFilters = Object.keys(current).length > 0;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const result = await saveViewAction(agencySlug, { scope, name, params: current });
    if (!result.ok) {
      setError(result.fieldErrors?.name ?? result.fieldErrors?.["values.name"] ?? result.error);
      return;
    }
    toast("success", "View saved.");
    setName("");
    router.refresh();
  }

  async function remove(id: string) {
    const result = await deleteViewAction(agencySlug, id);
    if (!result.ok) return setError(result.error);
    toast("success", "View deleted.");
    router.refresh();
  }

  if (views.length === 0 && !hasFilters) return null;
  return (
    <section aria-label="Saved views" className="space-y-2 text-sm">
      {views.length > 0 ? (
        <ul className="flex flex-wrap items-center gap-2">
          <li className="text-zinc-600 dark:text-zinc-400">Saved views:</li>
          {views.map((v) => (
            <li
              key={v.id}
              className="flex items-center gap-1 rounded-full border border-zinc-300 pl-3 dark:border-zinc-700"
            >
              <Link
                href={viewHref(basePath, v.params)}
                className="underline-offset-4 hover:underline"
              >
                {v.name}
              </Link>
              <button
                type="button"
                onClick={() => remove(v.id)}
                aria-label={`Delete view ${v.name}`}
                className="px-2 py-1 text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                x
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {hasFilters ? (
        <form onSubmit={save} className="flex flex-wrap items-end gap-2" noValidate>
          <div className="space-y-1">
            <Label htmlFor={`view-name-${scope}`}>Save these filters as a view</Label>
            <Input
              id={`view-name-${scope}`}
              value={name}
              maxLength={40}
              placeholder="View name"
              onChange={(e) => setName(e.target.value)}
              className="w-56"
            />
          </div>
          <Button type="submit" variant="outline">
            Save view
          </Button>
        </form>
      ) : null}
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
    </section>
  );
}

type BulkOption = { value: string; label: string };

/**
 * The bar above a table with row checkboxes. The checkboxes sit in the table and point at this
 * form with the `form` attribute, so the table can stay a server component.
 */
export function BulkBar({
  agencySlug,
  formId,
  kind,
  options,
}: {
  agencySlug: string;
  formId: string;
  kind: "clients" | "tasks";
  options: BulkOption[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [value, setValue] = useState(options[0]?.value ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ids = new FormData(event.currentTarget).getAll("ids").map(String);
    if (ids.length === 0) return setError("Select at least one row first.");
    setBusy(true);
    setError(null);
    const result =
      kind === "clients"
        ? await bulkClientsAction(agencySlug, { ids, archived: value === "archive" })
        : await bulkTasksAction(agencySlug, { ids, action: value });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    const { done, failed } = result.data;
    if (failed.length > 0) {
      setError(`${done} done, ${failed.length} not done. ${failed[0]!.message}`);
    } else {
      toast("success", `${done} updated.`);
    }
    router.refresh();
  }

  return (
    <form id={formId} onSubmit={run} className="flex flex-wrap items-end gap-2" noValidate>
      <div className="space-y-1">
        <Label htmlFor={`${formId}-action`}>With selected rows</Label>
        <Select
          id={`${formId}-action`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-48"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>
      <Button type="submit" variant="outline" disabled={busy}>
        Apply
      </Button>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
    </form>
  );
}

export function DashboardCustomize({
  agencySlug,
  hidden,
}: {
  agencySlug: string;
  hidden: string[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [off, setOff] = useState<string[]>(hidden);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const result = await setDashboardPartsAction(agencySlug, { hidden: off });
    if (!result.ok) return setError(result.error);
    toast("success", "Dashboard saved.");
    router.refresh();
  }

  return (
    <details className="rounded-lg border border-zinc-200 dark:border-zinc-800">
      <summary className="cursor-pointer px-4 py-2 text-sm font-medium">
        Customize dashboard
      </summary>
      <form onSubmit={save} className="space-y-3 border-t border-zinc-200 p-4 dark:border-zinc-800">
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">Show these parts</legend>
          {DASHBOARD_PARTS.map((p) => (
            <div key={p} className="flex items-center gap-2">
              <input
                id={`part-${p}`}
                type="checkbox"
                className="size-4"
                checked={!off.includes(p)}
                onChange={(e) =>
                  setOff(e.target.checked ? off.filter((x) => x !== p) : [...off, p])
                }
              />
              <Label htmlFor={`part-${p}`}>{DASHBOARD_PART_LABEL[p]}</Label>
            </div>
          ))}
        </fieldset>
        {error ? <FormMessage kind="error">{error}</FormMessage> : null}
        <Button type="submit" variant="outline">
          Save dashboard
        </Button>
      </form>
    </details>
  );
}
