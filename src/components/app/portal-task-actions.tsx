"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  portalAnswerAction,
  portalCommentAction,
} from "@/app/portal/[agencySlug]/(portal)/tasks/actions";
import { FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** Approve, or ask for changes with a note. Shown only while the task waits for an answer. */
export function ApprovalButtons({ agencySlug, taskId }: { agencySlug: string; taskId: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function answer(decision: "APPROVE" | "CHANGES") {
    setBusy(true);
    setError(null);
    const result = await portalAnswerAction(agencySlug, taskId, { decision, note });
    setBusy(false);
    if (!result.ok)
      return setError(
        result.fieldErrors?.["values.note"] ?? result.fieldErrors?.note ?? result.error,
      );
    router.refresh();
  }

  return (
    <div className="space-y-3 rounded-lg border border-zinc-300 p-4 dark:border-zinc-700">
      <h2 className="text-base font-semibold">Your agency needs your answer</h2>
      <div className="space-y-1.5">
        <label htmlFor="approval-note" className="text-sm font-medium">
          Note (needed if you ask for changes)
        </label>
        <Textarea
          id="approval-note"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy} onClick={() => void answer("APPROVE")}>
          Approve
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => void answer("CHANGES")}
        >
          Ask for changes
        </Button>
      </div>
    </div>
  );
}

export function PortalCommentForm({ agencySlug, taskId }: { agencySlug: string; taskId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      noValidate
      className="space-y-2"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        const result = await portalCommentAction(agencySlug, taskId, { body });
        setBusy(false);
        if (!result.ok) return setError(result.error);
        setBody("");
        router.refresh();
      }}
    >
      <label htmlFor="portal-comment" className="text-sm font-medium">
        Write to your agency
      </label>
      <Textarea
        id="portal-comment"
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <Button type="submit" disabled={busy || !body.trim()}>
        Send comment
      </Button>
    </form>
  );
}
