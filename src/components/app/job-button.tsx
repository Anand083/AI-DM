"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";

const POLL_MS = 3000;
const MAX_POLLS = 40;

/**
 * Starts a background job, then refreshes the page every few seconds until the result is there.
 * The page tells us it is finished by passing `doneToday`. The job itself runs in the worker.
 */
export function JobButton({
  run,
  label,
  busyText,
  doneToday,
  doneText,
}: {
  run: () => Promise<{ ok: boolean; error?: string }>;
  label: string;
  /** Shown while the worker is busy, for example "Checking backlinks. This page updates by itself." */
  busyText: string;
  doneToday: boolean;
  doneText: string;
}) {
  const router = useRouter();
  const [asked, setAsked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const polls = useRef(0);
  // Finished as soon as the page says today's result exists.
  const waiting = asked && !doneToday;

  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      polls.current += 1;
      if (polls.current > MAX_POLLS) {
        setAsked(false);
        setError("This is taking longer than usual. Reload the page in a few minutes.");
        return;
      }
      router.refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, router]);

  async function start() {
    setError(null);
    const result = await run();
    if (!result.ok) {
      setError(result.error ?? "Something went wrong. Try again.");
      return;
    }
    polls.current = 0;
    setAsked(true);
  }

  return (
    <div className="space-y-2">
      <Button onClick={() => void start()} disabled={waiting || doneToday}>
        {waiting ? "Working..." : label}
      </Button>
      {doneToday ? <p className="text-xs text-zinc-600 dark:text-zinc-400">{doneText}</p> : null}
      {waiting ? (
        <p role="status" className="text-xs text-zinc-600 dark:text-zinc-400">
          {busyText}
        </p>
      ) : null}
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
    </div>
  );
}
