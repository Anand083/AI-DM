"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { checkBacklinksAction } from "@/app/app/[agencySlug]/projects/[projectId]/backlinks/actions";
import { FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";

const POLL_MS = 3000;
const MAX_POLLS = 40;

/**
 * Asks for a backlink check, then refreshes the page every few seconds until the new numbers
 * arrive (the page passes `checkedToday`, which turns true when the worker has finished).
 */
export function CheckBacklinksButton({
  agencySlug,
  projectId,
  label,
  checkedToday,
}: {
  agencySlug: string;
  projectId: string;
  label: string;
  checkedToday: boolean;
}) {
  const router = useRouter();
  const [asked, setAsked] = useState(false);
  // Done as soon as the page says today's check exists.
  const waiting = asked && !checkedToday;
  const [error, setError] = useState<string | null>(null);
  const polls = useRef(0);

  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      polls.current += 1;
      if (polls.current > MAX_POLLS) {
        setAsked(false);
        setError("The check is taking longer than usual. Reload this page in a few minutes.");
        return;
      }
      router.refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, router]);

  async function start() {
    setError(null);
    const result = await checkBacklinksAction(agencySlug, projectId);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    polls.current = 0;
    setAsked(true);
  }

  return (
    <div className="space-y-2">
      <Button onClick={() => void start()} disabled={waiting || checkedToday}>
        {waiting ? "Checking..." : label}
      </Button>
      {checkedToday ? (
        <p className="text-xs text-zinc-600 dark:text-zinc-400">Already checked today.</p>
      ) : null}
      {waiting ? (
        <p role="status" className="text-xs text-zinc-600 dark:text-zinc-400">
          Checking backlinks. This page updates by itself.
        </p>
      ) : null}
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
    </div>
  );
}
