"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  addCompetitorAction,
  removeCompetitorAction,
} from "@/app/app/[agencySlug]/projects/[projectId]/competitors/actions";
import { Field, FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/** The list of competitors with a form to add one. People who cannot edit only see the list. */
export function CompetitorPanel({
  agencySlug,
  projectId,
  competitors,
  max,
  canEdit,
}: {
  agencySlug: string;
  projectId: string;
  competitors: { id: string; domain: string }[];
  max: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldError(undefined);
    const result = await addCompetitorAction(agencySlug, projectId, { domain });
    setBusy(false);
    if (!result.ok) {
      setFieldError(result.fieldErrors?.["values.domain"] ?? result.fieldErrors?.domain);
      setError(result.error);
      return;
    }
    toast("success", "Competitor added.");
    setDomain("");
    router.refresh();
  }

  async function remove(id: string, name: string) {
    const result = await removeCompetitorAction(agencySlug, projectId, id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast("success", `${name} removed.`);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {competitors.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No competitors yet. Add the websites you want to compare with.
        </p>
      ) : (
        <ul aria-label="Competitors" className="flex flex-wrap gap-2">
          {competitors.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-2 rounded-full border border-zinc-300 py-1 pl-3 pr-1 text-sm dark:border-zinc-700"
            >
              <span>{c.domain}</span>
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => void remove(c.id, c.domain)}
                  aria-label={`Remove ${c.domain}`}
                  className="rounded-full px-2 py-0.5 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canEdit && competitors.length < max ? (
        <form onSubmit={add} className="flex flex-wrap items-end gap-3" noValidate>
          <div className="w-full max-w-sm">
            <Field
              id="competitor-domain"
              label="Competitor website"
              placeholder="rival-site.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              error={fieldError}
              autoComplete="off"
            />
          </div>
          <Button type="submit" disabled={busy || !domain.trim()}>
            {busy ? "Adding..." : "Add competitor"}
          </Button>
        </form>
      ) : null}
      {canEdit && competitors.length >= max ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          You have reached the limit of {max} competitors for this project.
        </p>
      ) : null}
      {error && !fieldError ? <FormMessage kind="error">{error}</FormMessage> : null}
    </div>
  );
}
