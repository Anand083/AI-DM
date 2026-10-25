"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  applyTemplateAction,
  createTemplateAction,
  deleteTemplateAction,
} from "@/app/app/[agencySlug]/tasks/actions";
import { Field, FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";

type Template = { key: string; name: string; custom: boolean; tasks: number };

/** Start a set of tasks from a template, and keep the agency's own templates. */
export function TemplatePanel({
  agencySlug,
  templates,
  projects,
  assignees,
  today,
  canDelete,
}: {
  agencySlug: string;
  templates: Template[];
  projects: { id: string; name: string }[];
  assignees: { id: string; name: string }[];
  today: string;
  canDelete: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [templateKey, setTemplateKey] = useState(templates[0]?.key ?? "");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [startOn, setStartOn] = useState(today);
  const [assigneeId, setAssigneeId] = useState("");
  const [name, setName] = useState("");
  const [lines, setLines] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function apply(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await applyTemplateAction(agencySlug, {
      templateKey,
      projectId,
      startOn,
      assigneeId: assigneeId || null,
    });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    toast("success", `${result.data.created} tasks added.`);
    router.refresh();
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setSaveError(null);
    const result = await createTemplateAction(agencySlug, { name, lines });
    setBusy(false);
    if (!result.ok)
      return setSaveError(
        result.fieldErrors?.lines ?? result.fieldErrors?.["values.lines"] ?? result.error,
      );
    toast("success", "Template saved.");
    setName("");
    setLines("");
    router.refresh();
  }

  return (
    <div className="space-y-8">
      <form onSubmit={apply} className="space-y-4" noValidate aria-label="Start from a template">
        {projects.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Add a website (project) first to use a template.
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="tpl-key">Template</Label>
            <Select
              id="tpl-key"
              value={templateKey}
              onChange={(e) => setTemplateKey(e.target.value)}
            >
              {templates.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.name} ({t.tasks} tasks)
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tpl-project">Website</Label>
            <Select
              id="tpl-project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <Field
            id="tpl-start"
            label="Start day"
            type="date"
            value={startOn}
            onChange={(e) => setStartOn(e.target.value)}
          />
          <div className="space-y-1.5">
            <Label htmlFor="tpl-assignee">Assign all to</Label>
            <Select
              id="tpl-assignee"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
            >
              <option value="">Nobody</option>
              {assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {error ? <FormMessage kind="error">{error}</FormMessage> : null}
        <Button type="submit" disabled={busy || !templateKey || !projectId}>
          Add the tasks
        </Button>
      </form>

      <div className="space-y-3">
        <h3 className="text-base font-semibold">Your own templates</h3>
        {templates.filter((t) => t.custom).length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            You have not saved a template yet.
          </p>
        ) : (
          <ul aria-label="Your templates" className="space-y-2">
            {templates
              .filter((t) => t.custom)
              .map((t) => (
                <li
                  key={t.key}
                  className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
                >
                  <span>
                    {t.name} ({t.tasks} tasks)
                  </span>
                  {canDelete ? (
                    <ConfirmDialog
                      trigger="Delete"
                      title="Delete this template?"
                      description="Tasks that were already made from it stay."
                      confirmLabel="Delete"
                      onConfirm={async () => {
                        const result = await deleteTemplateAction(
                          agencySlug,
                          t.key.replace("custom:", ""),
                        );
                        if (!result.ok) return result.error;
                        router.refresh();
                        return null;
                      }}
                    />
                  ) : null}
                </li>
              ))}
          </ul>
        )}
        <form onSubmit={save} className="space-y-3" noValidate aria-label="Save a template">
          <Field
            id="tpl-name"
            label="Template name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
          />
          <div className="space-y-1.5">
            <Label htmlFor="tpl-lines">Tasks, one a line</Label>
            <Textarea
              id="tpl-lines"
              rows={5}
              value={lines}
              onChange={(e) => setLines(e.target.value)}
              placeholder={"Pull the numbers | 2 | high\nWrite the plan | 5"}
            />
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Write the title, then the days after the start day, then the priority (low, medium,
              high or urgent). Days and priority are optional.
            </p>
          </div>
          {saveError ? <FormMessage kind="error">{saveError}</FormMessage> : null}
          <Button type="submit" variant="outline" disabled={busy || !name.trim() || !lines.trim()}>
            Save template
          </Button>
        </form>
      </div>
    </div>
  );
}
