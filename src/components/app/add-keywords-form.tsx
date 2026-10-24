"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { addKeywordsAction } from "@/app/app/[agencySlug]/projects/[projectId]/rankings/actions";
import { Field, FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";

export function AddKeywordsForm({
  agencySlug,
  projectId,
}: {
  agencySlug: string;
  projectId: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [tags, setTags] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    const result = await addKeywordsAction(agencySlug, projectId, { text, tags, targetUrl });
    setBusy(false);
    if (!result.ok) {
      // The server reports field names as "values.text", "values.targetUrl".
      const fields: Record<string, string> = {};
      for (const [key, message] of Object.entries(result.fieldErrors ?? {}))
        fields[key.replace(/^values\./, "")] = message;
      setFieldErrors(fields);
      setError(result.error);
      return;
    }
    const r = result.data;
    const notes = [
      r.alreadyTracked ? `${r.alreadyTracked} already tracked` : "",
      r.duplicatesInPaste ? `${r.duplicatesInPaste} listed twice` : "",
      r.tooLong ? `${r.tooLong} too long` : "",
    ].filter(Boolean);
    toast(
      "success",
      `Added ${r.added} ${r.added === 1 ? "keyword" : "keywords"}${notes.length ? ` (${notes.join(", ")})` : ""}.`,
    );
    setText("");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <div className="space-y-1.5">
        <Label htmlFor="keywords-text">Keywords (one per line)</Label>
        <Textarea
          id="keywords-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder={"dentist near me\nteeth whitening cost"}
          aria-invalid={fieldErrors.text ? true : undefined}
        />
        {fieldErrors.text ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {fieldErrors.text}
          </p>
        ) : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="keywords-tags"
          label="Tags (optional, separated by commas)"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="brand, services"
          error={fieldErrors.tags}
        />
        <Field
          id="keywords-url"
          label="Target page (optional)"
          value={targetUrl}
          onChange={(e) => setTargetUrl(e.target.value)}
          placeholder="https://example.com/page"
          error={fieldErrors.targetUrl}
        />
      </div>
      <Button type="submit" disabled={busy || text.trim() === ""}>
        {busy ? "Adding..." : "Add keywords"}
      </Button>
    </form>
  );
}
