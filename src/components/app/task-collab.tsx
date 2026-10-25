"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { addCommentAction, requestApprovalAction } from "@/app/app/[agencySlug]/tasks/actions";
import { FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { approvalLabel } from "@/lib/tasks";

/** Where the client's answer stands, and the button that asks for one. */
export function ApprovalPanel({
  agencySlug,
  taskId,
  status,
  note,
  answeredOn,
  canEdit,
  hasProject,
}: {
  agencySlug: string;
  taskId: string;
  status: string;
  note: string | null;
  answeredOn: string | null;
  canEdit: boolean;
  hasProject: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    setBusy(true);
    setError(null);
    const result = await requestApprovalAction(agencySlug, taskId);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    toast("success", "The client can now approve this task.");
    router.refresh();
  }

  return (
    <div className="space-y-2 text-sm">
      <p>
        <span className="font-medium">{approvalLabel(status)}</span>
        {answeredOn ? ` (${answeredOn})` : ""}
      </p>
      {note ? (
        <p className="rounded-md bg-zinc-50 p-3 dark:bg-zinc-900">The client wrote: {note}</p>
      ) : null}
      {canEdit && hasProject && status !== "REQUESTED" ? (
        <Button type="button" variant="outline" disabled={busy} onClick={() => void ask()}>
          {status === "NONE" ? "Ask the client to approve" : "Ask for approval again"}
        </Button>
      ) : null}
      {canEdit && !hasProject ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          Choose a project for this task to ask for approval.
        </p>
      ) : null}
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
    </div>
  );
}

/** A comment box. A team comment is private unless "visible to the client" is ticked. */
export function TeamCommentForm({
  agencySlug,
  taskId,
  clientCanSee,
}: {
  agencySlug: string;
  taskId: string;
  clientCanSee: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [shared, setShared] = useState(false);
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
        const result = await addCommentAction(agencySlug, taskId, {
          body,
          clientVisible: clientCanSee && shared,
        });
        setBusy(false);
        if (!result.ok) return setError(result.error);
        setBody("");
        router.refresh();
      }}
    >
      <label htmlFor="comment-body" className="text-sm font-medium">
        Add a comment
      </label>
      <Textarea id="comment-body" rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
      {clientCanSee ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
          Visible to the client
        </label>
      ) : (
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          Only your team can see this comment. Show the task to the client to write to them here.
        </p>
      )}
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <Button type="submit" disabled={busy || !body.trim()}>
        Post comment
      </Button>
    </form>
  );
}
