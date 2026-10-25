"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  askAssistantAction,
  decideAssistantActionAction,
} from "@/app/app/[agencySlug]/projects/[projectId]/assistant/actions";
import { FormMessage } from "@/components/auth/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { SOURCE_LABELS, type AssistantSource } from "@/lib/assistant";
import type { ConversationItem } from "@/server/services/assistant";

const POLL_MS = 3000;
const MAX_POLLS = 30;

function ActionButtons({
  agencySlug,
  projectId,
  action,
  canEdit,
}: {
  agencySlug: string;
  projectId: string;
  action: ConversationItem["actions"][number];
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function decide(decision: "approve" | "dismiss") {
    setBusy(true);
    setError(null);
    const result = await decideAssistantActionAction(agencySlug, projectId, action.id, decision);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      router.refresh();
      return;
    }
    if (decision === "approve") toast("success", result.data.note ?? "Done.");
    router.refresh();
  }
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">{action.label}</p>
      {action.detail ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{action.detail}</p>
      ) : null}
      {action.status === "PENDING" ? (
        canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy} onClick={() => void decide("approve")}>
              Approve
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void decide("dismiss")}
            >
              Dismiss
            </Button>
          </div>
        ) : null
      ) : (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {action.status === "APPROVED"
            ? `Approved. ${action.resultNote ?? ""}`
            : action.status === "DISMISSED"
              ? "Dismissed."
              : `Could not be done. ${action.resultNote ?? ""}`}
        </p>
      )}
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
    </div>
  );
}

export function AssistantChat({
  agencySlug,
  projectId,
  items,
  canAsk,
  canEdit,
}: {
  agencySlug: string;
  projectId: string;
  items: ConversationItem[];
  canAsk: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const polls = useRef(0);
  const waiting = items.some((i) => i.role === "USER" && i.status === "PENDING");

  useEffect(() => {
    if (!waiting) {
      polls.current = 0;
      return;
    }
    const timer = setInterval(() => {
      polls.current += 1;
      if (polls.current <= MAX_POLLS) router.refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, router]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldError(undefined);
    const result = await askAssistantAction(agencySlug, projectId, { question });
    if (!result.ok) {
      setFieldError(result.fieldErrors?.["values.question"] ?? result.fieldErrors?.question);
      setError(result.error);
      return;
    }
    setQuestion("");
    polls.current = 0;
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {items.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No questions yet. Try &quot;What should I work on first?&quot; or &quot;Which pages lost
          traffic?&quot;.
        </p>
      ) : (
        <ol aria-label="Conversation" className="space-y-4">
          {items.map((m) =>
            m.role === "USER" ? (
              <li
                key={m.id}
                className="ml-auto max-w-2xl rounded-lg bg-zinc-100 p-3 text-sm dark:bg-zinc-800"
              >
                <p className="font-medium">You asked</p>
                <p>{m.content}</p>
                {m.status === "PENDING" ? (
                  <p role="status" className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                    Working on the answer. This page updates by itself.
                  </p>
                ) : null}
                {m.status === "FAILED" ? (
                  <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-300">
                    The answer could not be written. Please ask again.
                  </p>
                ) : null}
              </li>
            ) : (
              <li
                key={m.id}
                className="max-w-3xl space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">Assistant</span>
                  <Badge tone={m.confidence === "high" ? "success" : "neutral"}>
                    Confidence: {m.confidence ?? "low"}
                  </Badge>
                  {m.provider === "mock" ? <Badge>Sample answer (rule based)</Badge> : null}
                </div>
                <p className="whitespace-pre-line text-sm">{m.content}</p>
                {m.evidence.length > 0 ? (
                  <div>
                    <p className="text-sm font-medium">Based on</p>
                    <ul
                      aria-label="Evidence"
                      className="mt-1 list-disc pl-5 text-sm text-zinc-700 dark:text-zinc-300"
                    >
                      {m.evidence.map((e) => (
                        <li key={`${e.source}-${e.detail}`}>
                          {SOURCE_LABELS[e.source as AssistantSource] ?? e.source}: {e.detail}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    No data was found to back this up.
                  </p>
                )}
                {m.actions.length > 0 ? (
                  <div className="space-y-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                    <p className="text-sm font-medium">
                      Suggested next steps (nothing happens until you approve)
                    </p>
                    {m.actions.map((a) => (
                      <ActionButtons
                        key={a.id}
                        agencySlug={agencySlug}
                        projectId={projectId}
                        action={a}
                        canEdit={canEdit}
                      />
                    ))}
                  </div>
                ) : null}
              </li>
            ),
          )}
        </ol>
      )}

      {canAsk ? (
        <form onSubmit={submit} className="max-w-2xl space-y-2" noValidate>
          <Label htmlFor="assistant-question">Ask about this website</Label>
          <Textarea
            id="assistant-question"
            value={question}
            rows={3}
            maxLength={500}
            placeholder="What should I work on first this week?"
            onChange={(e) => setQuestion(e.target.value)}
          />
          {fieldError ? (
            <p className="text-sm text-red-700 dark:text-red-300">{fieldError}</p>
          ) : null}
          {error && !fieldError ? <FormMessage kind="error">{error}</FormMessage> : null}
          <Button type="submit" disabled={waiting || question.trim().length < 5}>
            {waiting ? "Working..." : "Ask"}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
