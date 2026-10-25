"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  addPromptAction,
  removePromptAction,
  saveAiSettingsAction,
} from "@/app/app/[agencySlug]/projects/[projectId]/ai-visibility/actions";
import { Field, FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { AI_ENGINES } from "@/lib/ai-visibility";

/** The questions to ask the AI engines, plus the brand name and engines used. */
export function AiSetupPanel({
  agencySlug,
  projectId,
  prompts,
  maxPrompts,
  brandName,
  engines,
  canEdit,
}: {
  agencySlug: string;
  projectId: string;
  prompts: { id: string; text: string }[];
  maxPrompts: number;
  brandName: string;
  engines: string[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [promptError, setPromptError] = useState<string | undefined>();
  const [brand, setBrand] = useState(brandName);
  const [picked, setPicked] = useState<Set<string>>(new Set(engines));
  const [settingsError, setSettingsError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setPromptError(undefined);
    setError(null);
    const result = await addPromptAction(agencySlug, projectId, { text });
    setBusy(false);
    if (!result.ok) {
      setPromptError(
        result.fieldErrors?.["values.text"] ?? result.fieldErrors?.text ?? result.error,
      );
      return;
    }
    toast("success", "Question added.");
    setText("");
    router.refresh();
  }

  async function remove(id: string) {
    setError(null);
    const result = await removePromptAction(agencySlug, projectId, id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setSettingsError(undefined);
    setError(null);
    const result = await saveAiSettingsAction(agencySlug, projectId, {
      brandName: brand,
      engines: AI_ENGINES.map((e) => e.key).filter((key) => picked.has(key)),
    });
    setBusy(false);
    if (!result.ok) {
      setSettingsError(
        result.fieldErrors?.["values.brandName"] ??
          result.fieldErrors?.["values.engines"] ??
          result.error,
      );
      return;
    }
    toast("success", "Settings saved.");
    router.refresh();
  }

  const toggle = (key: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <section aria-labelledby="questions-heading" className="space-y-3">
        <h3 id="questions-heading" className="text-base font-semibold">
          Questions to ask ({prompts.length} of {maxPrompts})
        </h3>
        {prompts.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Add questions a customer might ask an AI assistant, like &quot;best dentist in
            Austin&quot;.
          </p>
        ) : (
          <ul aria-label="Questions" className="space-y-2">
            {prompts.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
              >
                <span>{p.text}</span>
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => void remove(p.id)}
                    aria-label={`Remove question: ${p.text}`}
                    className="shrink-0 text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-400"
                  >
                    Remove
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canEdit && prompts.length < maxPrompts ? (
          <form onSubmit={add} className="flex flex-wrap items-end gap-3" noValidate>
            <div className="w-full max-w-md">
              <Field
                id="ai-question"
                label="New question"
                placeholder="best dentist in Austin"
                value={text}
                onChange={(e) => setText(e.target.value)}
                error={promptError}
                autoComplete="off"
              />
            </div>
            <Button type="submit" disabled={busy || !text.trim()}>
              Add question
            </Button>
          </form>
        ) : null}
      </section>

      <section aria-labelledby="settings-heading" className="space-y-3">
        <h3 id="settings-heading" className="text-base font-semibold">
          Brand and engines
        </h3>
        <form onSubmit={save} className="space-y-4" noValidate>
          <Field
            id="ai-brand"
            label="Brand name to look for"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            disabled={!canEdit}
          />
          <fieldset className="space-y-2" disabled={!canEdit}>
            <legend className="text-sm font-medium">AI engines to ask</legend>
            {AI_ENGINES.map((e) => (
              <label key={e.key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={picked.has(e.key)} onChange={() => toggle(e.key)} />
                {e.label}
              </label>
            ))}
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Each question is asked once per engine. More engines use more of your monthly AI
              checks.
            </p>
          </fieldset>
          {settingsError ? <FormMessage kind="error">{settingsError}</FormMessage> : null}
          {canEdit ? (
            <Button type="submit" disabled={busy}>
              Save settings
            </Button>
          ) : null}
        </form>
      </section>
      {error ? (
        <div className="lg:col-span-2">
          <FormMessage kind="error">{error}</FormMessage>
        </div>
      ) : null}
    </div>
  );
}
