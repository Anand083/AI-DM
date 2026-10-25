"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { inspectUrlAction } from "@/app/app/[agencySlug]/projects/[projectId]/analytics/actions";
import { Field, FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";

const POLL_MS = 3000;
const MAX_POLLS = 15;

/** Ask Google how one page is indexed. The worker asks Google; this page refreshes until it is back. */
export function InspectUrlForm({
  agencySlug,
  projectId,
}: {
  agencySlug: string;
  projectId: string;
}) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [waiting, setWaiting] = useState(false);
  const polls = useRef(0);

  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      polls.current += 1;
      if (polls.current > MAX_POLLS) {
        setWaiting(false);
        return;
      }
      router.refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, router]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldError(undefined);
    const result = await inspectUrlAction(agencySlug, projectId, url);
    if (!result.ok) {
      setFieldError(result.fieldErrors?.url);
      setError(result.error);
      return;
    }
    polls.current = 0;
    setWaiting(true);
  }

  return (
    <form onSubmit={submit} className="max-w-xl space-y-3" noValidate>
      <Field
        id="inspect-url"
        label="Page address"
        type="url"
        value={url}
        placeholder="https://example.com/page"
        error={fieldError}
        onChange={(e) => setUrl(e.target.value)}
      />
      <Button type="submit" disabled={waiting || url.trim() === ""}>
        {waiting ? "Asking Google..." : "Check with Google"}
      </Button>
      {waiting ? (
        <p role="status" className="text-xs text-zinc-600 dark:text-zinc-400">
          Asking Google. This page updates by itself.
        </p>
      ) : null}
      {error && !fieldError ? <FormMessage kind="error">{error}</FormMessage> : null}
    </form>
  );
}
