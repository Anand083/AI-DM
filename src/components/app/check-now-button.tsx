"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  checkNowAction,
  checkNowStatusAction,
  finishCheckNowAction,
} from "@/app/app/[agencySlug]/projects/[projectId]/rankings/actions";
import { FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/** Starts a live rank check and polls until the worker has finished. */
export function CheckNowButton({
  agencySlug,
  projectId,
  keywordIds,
  label = "Check now",
  disabled,
}: {
  agencySlug: string;
  projectId: string;
  /** Only these keywords. Leave out to check all. */
  keywordIds?: string[];
  label?: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [state, setState] = useState<"idle" | "starting" | "running">("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  async function poll(jobId: string) {
    const result = await checkNowStatusAction(agencySlug, jobId);
    if (!result.ok) {
      setState("idle");
      setError(result.error);
      return;
    }
    const status = result.data;
    setProgress(status.progress);
    if (status.state === "done") {
      setState("idle");
      toast("success", "Rankings are up to date.");
      await finishCheckNowAction(agencySlug, projectId);
      router.refresh();
    } else if (status.state === "failed") {
      setState("idle");
      setError(status.error ?? "The check could not be finished.");
    } else {
      timer.current = setTimeout(() => void poll(jobId), 1000);
    }
  }

  async function start() {
    setError(null);
    setProgress(0);
    setState("starting");
    const result = await checkNowAction(agencySlug, projectId, keywordIds);
    if (!result.ok) {
      setState("idle");
      setError(result.error);
      return;
    }
    setState("running");
    void poll(result.data.jobId);
  }

  const busy = state !== "idle";
  return (
    <div className="space-y-2">
      <Button onClick={start} disabled={busy || disabled}>
        {busy ? `Checking... ${progress}%` : label}
      </Button>
      <span className="sr-only" role="status">
        {busy ? `Checking rankings, ${progress} percent done` : ""}
      </span>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
    </div>
  );
}
