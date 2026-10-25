"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  createMilestoneAction,
  deleteMilestoneAction,
  setMilestoneDoneAction,
} from "@/app/app/[agencySlug]/projects/[projectId]/milestones/actions";
import { Field, FormMessage } from "@/components/auth/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";

export type MilestoneRow = {
  id: string;
  title: string;
  dueOn: string | null;
  reached: boolean;
  clientVisible: boolean;
  total: number;
  done: number;
  percent: number | null;
};

/** Milestones of a project: add one, mark one reached, delete one. */
export function MilestonePanel({
  agencySlug,
  projectId,
  milestones,
  canEdit,
  canDelete,
}: {
  agencySlug: string;
  projectId: string;
  milestones: MilestoneRow[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [visible, setVisible] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    const result = await createMilestoneAction(agencySlug, projectId, {
      title,
      dueOn: dueOn || null,
      clientVisible: visible,
    });
    setBusy(false);
    if (!result.ok) {
      const fields: Record<string, string> = {};
      for (const [key, message] of Object.entries(result.fieldErrors ?? {}))
        fields[key.replace(/^values\./, "")] = message;
      setFieldErrors(fields);
      return setError(result.error);
    }
    toast("success", "Milestone added.");
    setTitle("");
    setDueOn("");
    router.refresh();
  }

  async function toggle(m: MilestoneRow) {
    const result = await setMilestoneDoneAction(agencySlug, projectId, m.id, !m.reached);
    if (!result.ok) return setError(result.error);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {milestones.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No milestones yet. A milestone is a goal with a date, like &quot;Fix the basics&quot;.
          Link tasks to it and the progress shows here and in the client&apos;s portal.
        </p>
      ) : (
        <ul aria-label="Milestones" className="space-y-3">
          {milestones.map((m) => (
            <li key={m.id} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{m.title}</span>
                {m.reached ? <Badge tone="success">Reached</Badge> : null}
                {!m.clientVisible ? <Badge>Team only</Badge> : null}
                <span className="ml-auto text-sm text-zinc-600 dark:text-zinc-400">
                  {m.dueOn ? `Due ${m.dueOn}` : "No date"}
                </span>
              </div>
              <p className="mt-2 text-sm">
                {m.percent === null
                  ? "No tasks linked yet."
                  : `${m.done} of ${m.total} tasks done (${m.percent}%)`}
              </p>
              {m.percent !== null ? (
                <div
                  role="progressbar"
                  aria-label={`${m.title} progress`}
                  aria-valuenow={m.percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="mt-2 h-2 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-800"
                >
                  <div
                    className="h-full bg-zinc-700 dark:bg-zinc-300"
                    style={{ width: `${m.percent}%` }}
                  />
                </div>
              ) : null}
              {canEdit ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => void toggle(m)}>
                    {m.reached ? "Open again" : "Mark as reached"}
                  </Button>
                  {canDelete ? (
                    <ConfirmDialog
                      trigger="Delete"
                      title="Delete this milestone?"
                      description="Its tasks stay, but they will not belong to a milestone."
                      confirmLabel="Delete"
                      onConfirm={async () => {
                        const result = await deleteMilestoneAction(agencySlug, projectId, m.id);
                        if (!result.ok) return result.error;
                        router.refresh();
                        return null;
                      }}
                    />
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {error && !fieldErrors.title && !fieldErrors.dueOn ? (
        <FormMessage kind="error">{error}</FormMessage>
      ) : null}

      {canEdit ? (
        <form
          onSubmit={add}
          className="grid items-end gap-3 sm:grid-cols-[1fr_12rem_auto]"
          noValidate
        >
          <Field
            id="milestone-title"
            label="New milestone"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            error={fieldErrors.title}
            autoComplete="off"
          />
          <Field
            id="milestone-due"
            label="Due date (optional)"
            type="date"
            value={dueOn}
            onChange={(e) => setDueOn(e.target.value)}
            error={fieldErrors.dueOn}
          />
          <Button type="submit" disabled={busy || !title.trim()}>
            Add milestone
          </Button>
          <label className="flex items-center gap-2 text-sm sm:col-span-3">
            <input
              type="checkbox"
              checked={visible}
              onChange={(e) => setVisible(e.target.checked)}
            />
            Show this milestone to the client
          </label>
        </form>
      ) : null}
    </div>
  );
}
