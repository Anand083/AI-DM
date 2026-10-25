"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  createAnnotationAction,
  createGoalAction,
  deleteAnnotationAction,
  deleteGoalAction,
} from "@/app/app/[agencySlug]/projects/[projectId]/goals/actions";
import { Field, FormMessage } from "@/components/auth/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { GOAL_KINDS, formatGoalValue, goalInfo, goalStatus } from "@/lib/goals";
import { KIND_LABELS } from "@/lib/report-extras";

export type GoalRow = {
  id: string;
  kind: string;
  start: number | null;
  current: number | null;
  target: number;
  dueOn: string | null;
  percent: number;
  onTrack: boolean | null;
  reachedOn: string | null;
  points: number;
};
export type NoteRow = { id: string; on: string; kind: string; title: string; allProjects: boolean };

const fieldKey = (key: string) => key.replace(/^values\./, "");

export function GoalPanel({
  agencySlug,
  projectId,
  goals,
  notes,
  canEdit,
  canDelete,
}: {
  agencySlug: string;
  projectId: string;
  goals: GoalRow[];
  notes: NoteRow[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [kind, setKind] = useState<string>(GOAL_KINDS[0].key);
  const [target, setTarget] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [goalError, setGoalError] = useState<string | null>(null);
  const [goalFields, setGoalFields] = useState<Record<string, string>>({});

  const [noteOn, setNoteOn] = useState("");
  const [noteKind, setNoteKind] = useState("CAMPAIGN");
  const [title, setTitle] = useState("");
  const [allProjects, setAllProjects] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [noteFields, setNoteFields] = useState<Record<string, string>>({});

  const used = new Set(goals.map((g) => g.kind));
  const free = GOAL_KINDS.filter((k) => !used.has(k.key));
  const chosen = free.some((k) => k.key === kind) ? kind : (free[0]?.key ?? kind);

  async function addGoal(event: React.FormEvent) {
    event.preventDefault();
    setGoalError(null);
    setGoalFields({});
    const result = await createGoalAction(agencySlug, projectId, {
      kind: chosen,
      target: target === "" ? Number.NaN : Number(target),
      dueOn: dueOn || null,
    });
    if (!result.ok) {
      const fields: Record<string, string> = {};
      for (const [k, m] of Object.entries(result.fieldErrors ?? {})) fields[fieldKey(k)] = m;
      setGoalFields(fields);
      return setGoalError(result.error);
    }
    toast("success", "Goal added.");
    setTarget("");
    setDueOn("");
    router.refresh();
  }

  async function addNote(event: React.FormEvent) {
    event.preventDefault();
    setNoteError(null);
    setNoteFields({});
    const result = await createAnnotationAction(agencySlug, projectId, {
      on: noteOn,
      kind: noteKind,
      title,
      allProjects,
    });
    if (!result.ok) {
      const fields: Record<string, string> = {};
      for (const [k, m] of Object.entries(result.fieldErrors ?? {})) fields[fieldKey(k)] = m;
      setNoteFields(fields);
      return setNoteError(result.error);
    }
    toast("success", "Note added.");
    setTitle("");
    router.refresh();
  }

  const info = goalInfo(chosen);

  return (
    <div className="space-y-10">
      <section aria-labelledby="goals-title" className="space-y-4">
        <h3 id="goals-title" className="text-base font-semibold">
          Goals
        </h3>
        {goals.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            No goals yet. Pick something to measure and a target, and we track it every day.
          </p>
        ) : (
          <ul aria-label="Goals" className="space-y-3">
            {goals.map((g) => {
              const meta = goalInfo(g.kind);
              return (
                <li
                  key={g.id}
                  className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{meta?.label ?? g.kind}</span>
                    {g.percent >= 100 ? <Badge tone="success">Reached</Badge> : null}
                    <span className="ml-auto text-sm text-zinc-600 dark:text-zinc-400">
                      {g.dueOn ? `Due ${g.dueOn}` : "No due date"}
                    </span>
                  </div>
                  <p className="mt-2 text-sm">
                    Now {formatGoalValue(g.kind, g.current)}, target{" "}
                    {formatGoalValue(g.kind, g.target)}
                    {g.start !== null ? `, started at ${formatGoalValue(g.kind, g.start)}` : ""}
                  </p>
                  <div
                    role="progressbar"
                    aria-label={`${meta?.label ?? g.kind} progress`}
                    aria-valuenow={g.percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className="mt-2 h-2 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-800"
                  >
                    <div
                      className="h-full bg-zinc-700 dark:bg-zinc-300"
                      style={{ width: `${g.percent}%` }}
                    />
                  </div>
                  <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                    {goalStatus(g.percent, g.onTrack)}
                    {g.reachedOn && g.percent < 100 ? `. At this pace: about ${g.reachedOn}` : ""}
                  </p>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    Based on {g.points} saved {g.points === 1 ? "day" : "days"}. Estimates need at
                    least 5.
                  </p>
                  {canDelete ? (
                    <div className="mt-3">
                      <ConfirmDialog
                        trigger="Delete"
                        title="Delete this goal?"
                        description="Its saved daily numbers are deleted too."
                        confirmLabel="Delete"
                        onConfirm={async () => {
                          const result = await deleteGoalAction(agencySlug, projectId, g.id);
                          if (!result.ok) return result.error;
                          router.refresh();
                          return null;
                        }}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {canEdit && free.length > 0 ? (
          <form
            onSubmit={addGoal}
            className="grid items-end gap-3 sm:grid-cols-[1fr_9rem_11rem_auto]"
            noValidate
          >
            <div className="space-y-1.5">
              <Label htmlFor="goal-kind">What to measure</Label>
              <Select id="goal-kind" value={chosen} onChange={(e) => setKind(e.target.value)}>
                {free.map((k) => (
                  <option key={k.key} value={k.key}>
                    {k.label}
                  </option>
                ))}
              </Select>
            </div>
            <Field
              id="goal-target"
              label="Target"
              type="number"
              step="any"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              error={goalFields.target}
            />
            <Field
              id="goal-due"
              label="Due date (optional)"
              type="date"
              value={dueOn}
              onChange={(e) => setDueOn(e.target.value)}
              error={goalFields.dueOn}
            />
            <Button type="submit" disabled={target === ""}>
              Add goal
            </Button>
            {info ? (
              <p className="text-xs text-zinc-600 sm:col-span-4 dark:text-zinc-400">{info.hint}</p>
            ) : null}
          </form>
        ) : null}
        {goalError && !goalFields.target && !goalFields.dueOn ? (
          <FormMessage kind="error">{goalError}</FormMessage>
        ) : null}
      </section>

      <section aria-labelledby="notes-title" className="space-y-4">
        <h3 id="notes-title" className="text-base font-semibold">
          Timeline notes
        </h3>
        {notes.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            No notes yet. Write down campaigns, Google updates and site changes so you can explain
            ups and downs later.
          </p>
        ) : (
          <ul aria-label="Timeline notes" className="space-y-2">
            {notes.map((n) => (
              <li
                key={n.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
              >
                <span className="tabular-nums">{n.on}</span>
                <Badge>{KIND_LABELS[n.kind] ?? "Note"}</Badge>
                <span>{n.title}</span>
                {n.allProjects ? <Badge>All projects</Badge> : null}
                {canDelete ? (
                  <span className="ml-auto">
                    <ConfirmDialog
                      trigger="Delete"
                      title="Delete this note?"
                      description="It will no longer appear in new reports."
                      confirmLabel="Delete"
                      onConfirm={async () => {
                        const result = await deleteAnnotationAction(agencySlug, projectId, n.id);
                        if (!result.ok) return result.error;
                        router.refresh();
                        return null;
                      }}
                    />
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {canEdit ? (
          <form
            onSubmit={addNote}
            className="grid items-end gap-3 sm:grid-cols-[11rem_12rem_1fr_auto]"
            noValidate
          >
            <Field
              id="note-date"
              label="Date"
              type="date"
              value={noteOn}
              onChange={(e) => setNoteOn(e.target.value)}
              error={noteFields.on}
            />
            <div className="space-y-1.5">
              <Label htmlFor="note-kind">Type</Label>
              <Select id="note-kind" value={noteKind} onChange={(e) => setNoteKind(e.target.value)}>
                {Object.entries(KIND_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <Field
              id="note-title"
              label="What happened"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              error={noteFields.title}
              autoComplete="off"
            />
            <Button type="submit" disabled={!noteOn || !title.trim()}>
              Add note
            </Button>
            <label className="flex items-center gap-2 text-sm sm:col-span-4">
              <input
                type="checkbox"
                checked={allProjects}
                onChange={(e) => setAllProjects(e.target.checked)}
              />
              Applies to all projects (for example a Google update)
            </label>
          </form>
        ) : null}
        {noteError && !noteFields.on && !noteFields.title ? (
          <FormMessage kind="error">{noteError}</FormMessage>
        ) : null}
      </section>
    </div>
  );
}
