"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createTaskAction, updateTaskAction } from "@/app/app/[agencySlug]/tasks/actions";
import { Field, FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { TASK_PRIORITIES, TASK_RECURRENCES, TASK_STATUSES } from "@/lib/tasks";

export type TaskFormValues = {
  title: string;
  description: string;
  priority: string;
  status: string;
  assigneeId: string;
  dueOn: string;
  estimateMinutes: string;
  recurrence: string;
  projectId: string;
};

export const EMPTY_TASK: TaskFormValues = {
  title: "",
  description: "",
  priority: "MEDIUM",
  status: "TODO",
  assigneeId: "",
  dueOn: "",
  estimateMinutes: "",
  recurrence: "NONE",
  projectId: "",
};

/** One form for adding a task and for changing one. */
export function TaskForm({
  agencySlug,
  taskId,
  initial = EMPTY_TASK,
  assignees,
  projects,
}: {
  agencySlug: string;
  /** Set when changing a task. Leave out when adding one. */
  taskId?: string;
  initial?: TaskFormValues;
  assignees: { id: string; name: string }[];
  projects: { id: string; name: string }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const set = (key: keyof TaskFormValues) => (e: { target: { value: string } }) =>
    setV((current) => ({ ...current, [key]: e.target.value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    const minutes = v.estimateMinutes.trim() === "" ? null : Number(v.estimateMinutes);
    const values = {
      title: v.title,
      description: v.description,
      priority: v.priority,
      assigneeId: v.assigneeId || null,
      dueOn: v.dueOn || null,
      estimateMinutes: Number.isFinite(minutes) ? minutes : null,
      recurrence: v.recurrence,
      ...(taskId ? { status: v.status } : { projectId: v.projectId || null }),
    };
    const result = taskId
      ? await updateTaskAction(agencySlug, taskId, values)
      : await createTaskAction(agencySlug, values);
    setBusy(false);
    if (!result.ok) {
      const fields: Record<string, string> = {};
      for (const [key, message] of Object.entries(result.fieldErrors ?? {}))
        fields[key.replace(/^values\./, "")] = message;
      setFieldErrors(fields);
      setError(result.error);
      return;
    }
    toast("success", taskId ? "Task saved." : "Task added.");
    if (!taskId) setV(initial);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <Field
        id={`title-${taskId ?? "new"}`}
        label="Title"
        value={v.title}
        onChange={set("title")}
        error={fieldErrors.title}
        autoComplete="off"
      />
      <div className="space-y-1.5">
        <Label htmlFor={`desc-${taskId ?? "new"}`}>Description</Label>
        <Textarea
          id={`desc-${taskId ?? "new"}`}
          rows={5}
          value={v.description}
          onChange={set("description")}
        />
        {fieldErrors.description ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {fieldErrors.description}
          </p>
        ) : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {taskId ? (
          <div className="space-y-1.5">
            <Label htmlFor={`status-${taskId}`}>Status</Label>
            <Select id={`status-${taskId}`} value={v.status} onChange={set("status")}>
              {TASK_STATUSES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="project-new">Project (optional)</Label>
            <Select id="project-new" value={v.projectId} onChange={set("projectId")}>
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor={`priority-${taskId ?? "new"}`}>Priority</Label>
          <Select id={`priority-${taskId ?? "new"}`} value={v.priority} onChange={set("priority")}>
            {TASK_PRIORITIES.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`assignee-${taskId ?? "new"}`}>Assigned to</Label>
          <Select
            id={`assignee-${taskId ?? "new"}`}
            value={v.assigneeId}
            onChange={set("assigneeId")}
          >
            <option value="">Nobody</option>
            {assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          {fieldErrors.assigneeId ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {fieldErrors.assigneeId}
            </p>
          ) : null}
        </div>
        <Field
          id={`due-${taskId ?? "new"}`}
          label="Due date"
          type="date"
          value={v.dueOn}
          onChange={set("dueOn")}
          error={fieldErrors.dueOn}
        />
        <Field
          id={`effort-${taskId ?? "new"}`}
          label="Estimated minutes"
          type="number"
          min={5}
          value={v.estimateMinutes}
          onChange={set("estimateMinutes")}
          error={fieldErrors.estimateMinutes}
        />
        <div className="space-y-1.5">
          <Label htmlFor={`repeat-${taskId ?? "new"}`}>Repeats</Label>
          <Select
            id={`repeat-${taskId ?? "new"}`}
            value={v.recurrence}
            onChange={set("recurrence")}
          >
            {TASK_RECURRENCES.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <Button type="submit" disabled={busy || !v.title.trim()}>
        {busy ? "Saving..." : taskId ? "Save task" : "Add task"}
      </Button>
    </form>
  );
}
