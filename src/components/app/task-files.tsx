"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { MAX_ATTACHMENT_BYTES } from "@/lib/attachments";

export type FileRow = { id: string; name: string; size: string; added: string };

/** Files on a task: download, add and remove. Uploads go to a route handler, not an action. */
export function TaskFiles({
  agencySlug,
  taskId,
  files,
  canEdit,
}: {
  agencySlug: string;
  taskId: string;
  files: FileRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/app/${agencySlug}/tasks/${taskId}/attachments`;

  async function upload(event: React.FormEvent) {
    event.preventDefault();
    const file = input.current?.files?.[0];
    if (!file) return setError("Choose a file first.");
    if (file.size > MAX_ATTACHMENT_BYTES)
      return setError("That file is too big. Use 5 MB or less.");
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("file", file);
    const res = await fetch(base, { method: "POST", body: form });
    setBusy(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return setError(body.error ?? "The file could not be uploaded.");
    }
    if (input.current) input.current.value = "";
    toast("success", "File added.");
    router.refresh();
  }

  async function remove(f: FileRow) {
    setError(null);
    const res = await fetch(`${base}/${f.id}`, { method: "DELETE" });
    if (!res.ok) return setError("The file could not be removed.");
    toast("success", `Removed ${f.name}.`);
    router.refresh();
  }

  return (
    <section aria-labelledby="files-heading" className="space-y-3">
      <h2 id="files-heading" className="text-lg font-semibold">
        Files
      </h2>
      {files.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">No files yet.</p>
      ) : (
        <ul
          aria-label="Task files"
          className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800"
        >
          {files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <a href={`${base}/${f.id}`} className="font-medium underline underline-offset-4">
                  {f.name}
                </a>{" "}
                <span className="text-xs text-zinc-600 dark:text-zinc-400">
                  {f.size}, added {f.added}
                </span>
              </span>
              {canEdit ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => remove(f)}
                  aria-label={`Remove ${f.name}`}
                >
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canEdit ? (
        <form onSubmit={upload} className="space-y-2" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="task-file">Add a file</Label>
            <input
              id="task-file"
              ref={input}
              type="file"
              accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.csv"
              className="block text-sm"
            />
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              PNG, JPG, WebP, GIF, PDF, TXT or CSV, up to 5 MB. Up to 10 files. Clients cannot see
              these files.
            </p>
          </div>
          {error ? <FormMessage kind="error">{error}</FormMessage> : null}
          <Button type="submit" variant="outline" disabled={busy}>
            Upload
          </Button>
        </form>
      ) : error ? (
        <FormMessage kind="error">{error}</FormMessage>
      ) : null}
    </section>
  );
}
