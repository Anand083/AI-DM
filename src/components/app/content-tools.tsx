"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  createContentTasksAction,
  deleteContentUpdateAction,
  logContentUpdateAction,
} from "@/app/app/[agencySlug]/projects/[projectId]/content/actions";
import { Field, FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";

/** Pick pages and make "refresh this page" tasks for them. */
export function ContentTaskButton({
  agencySlug,
  projectId,
  urls,
  label = "Create update tasks",
}: {
  agencySlug: string;
  projectId: string;
  urls: string[];
  label?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setError(null);
    const result = await createContentTasksAction(agencySlug, projectId, { urls });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    const { created, existing } = result.data;
    toast(
      "success",
      `${created} ${created === 1 ? "task" : "tasks"} created${existing > 0 ? `, ${existing} already had one` : ""}.`,
    );
    router.refresh();
  }
  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="outline"
        disabled={busy || urls.length === 0}
        onClick={() => void run()}
      >
        {label}
      </Button>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
    </div>
  );
}

/** Log that a page was updated, so the effect can be read later. */
export function LogUpdateForm({
  agencySlug,
  projectId,
  defaultUrl = "",
}: {
  agencySlug: string;
  projectId: string;
  defaultUrl?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [url, setUrl] = useState(defaultUrl);
  const [updatedOn, setUpdatedOn] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    const result = await logContentUpdateAction(agencySlug, projectId, {
      url,
      updatedOn,
      note: note.trim() || null,
    });
    setBusy(false);
    if (!result.ok) {
      const next: Record<string, string> = {};
      for (const [k, m] of Object.entries(result.fieldErrors ?? {}))
        next[k.replace(/^values\./, "")] = m;
      setFields(next);
      return setError(result.error);
    }
    toast("success", "Update logged.");
    setUrl("");
    setNote("");
    router.refresh();
  }

  return (
    <form
      onSubmit={submit}
      className="grid items-end gap-3 sm:grid-cols-[2fr_11rem_2fr_auto]"
      noValidate
    >
      <Field
        id="update-url"
        label="Page address"
        value={url}
        placeholder="https://example.com/page"
        onChange={(e) => setUrl(e.target.value)}
        error={fields.url}
      />
      <Field
        id="update-date"
        label="Updated on"
        type="date"
        value={updatedOn}
        onChange={(e) => setUpdatedOn(e.target.value)}
        error={fields.updatedOn}
      />
      <Field
        id="update-note"
        label="What changed (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <Button type="submit" disabled={busy || url.trim() === ""}>
        Log update
      </Button>
      {error && Object.keys(fields).length === 0 ? (
        <div className="sm:col-span-4">
          <FormMessage kind="error">{error}</FormMessage>
        </div>
      ) : null}
    </form>
  );
}

export function DeleteUpdateButton({
  agencySlug,
  projectId,
  id,
}: {
  agencySlug: string;
  projectId: string;
  id: string;
}) {
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger="Delete"
      title="Delete this logged update?"
      description="The before and after for this page will no longer be shown."
      confirmLabel="Delete"
      onConfirm={async () => {
        const result = await deleteContentUpdateAction(agencySlug, projectId, id);
        if (!result.ok) return result.error;
        router.refresh();
        return null;
      }}
    />
  );
}
