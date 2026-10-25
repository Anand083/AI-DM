"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { portalReportCommentAction } from "@/app/portal/[agencySlug]/(portal)/tasks/actions";
import { addReportCommentAction } from "@/app/app/[agencySlug]/reports/actions";
import { FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export type ReportCommentView = {
  id: string;
  author: string;
  body: string;
  fromClient: boolean;
  createdAt: string;
};

/**
 * Comments on a report, shared by the team and the client. The same list shows on both sides, so
 * nothing written here is private.
 */
export function ReportCommentThread({
  kind,
  agencySlug,
  reportId,
  comments,
  canPost,
}: {
  kind: "team" | "portal";
  agencySlug: string;
  reportId: string;
  comments: ReportCommentView[];
  canPost: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stamp = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
  return (
    <section aria-labelledby="report-comments-heading" className="space-y-3">
      <h2 id="report-comments-heading" className="text-lg font-semibold">
        Comments on this report
      </h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {kind === "team"
          ? "The client can read and answer these comments in their portal."
          : "Ask a question or leave a note. Your agency will be told."}
      </p>
      {comments.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">No comments yet.</p>
      ) : (
        <ul aria-label="Report comments" className="space-y-3">
          {comments.map((c) => (
            <li
              key={c.id}
              className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800"
            >
              <p className="font-medium">
                {c.author}{" "}
                <span className="text-xs font-normal text-zinc-600 dark:text-zinc-400">
                  {stamp.format(new Date(c.createdAt))} UTC
                  {kind === "team" && c.fromClient ? " (client)" : ""}
                </span>
              </p>
              <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
      {canPost ? (
        <form
          noValidate
          className="space-y-2"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            const result =
              kind === "team"
                ? await addReportCommentAction(agencySlug, reportId, { body })
                : await portalReportCommentAction(agencySlug, reportId, { body });
            setBusy(false);
            if (!result.ok) return setError(result.error);
            setBody("");
            router.refresh();
          }}
        >
          <label htmlFor="report-comment" className="text-sm font-medium">
            Add a comment
          </label>
          <Textarea
            id="report-comment"
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          {error ? <FormMessage kind="error">{error}</FormMessage> : null}
          <Button type="submit" disabled={busy || !body.trim()}>
            Post comment
          </Button>
        </form>
      ) : null}
    </section>
  );
}
