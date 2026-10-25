"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { revokeOtherSessionsAction, revokeSessionAction } from "@/app/account-actions";
import { FormMessage } from "@/components/auth/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export type SessionItem = {
  id: string;
  device: string;
  ip: string | null;
  created: string;
  current: boolean;
};

export function SessionsList({ sessions }: { sessions: SessionItem[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const others = sessions.filter((s) => !s.current).length;

  async function revoke(id: string) {
    setBusy(id);
    setError(null);
    const result = await revokeSessionAction(id);
    setBusy(null);
    if (!result.ok) return setError(result.error);
    toast("success", "Signed out on that device.");
    router.refresh();
  }

  async function revokeOthers() {
    setBusy("others");
    setError(null);
    const result = await revokeOtherSessionsAction();
    setBusy(null);
    if (!result.ok) return setError(result.error);
    toast("success", "Signed out everywhere else.");
    router.refresh();
  }

  return (
    <section aria-labelledby="sessions-h" className="space-y-3">
      <h2 id="sessions-h" className="text-lg font-semibold">
        Where you are signed in
      </h2>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <ul
        className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800"
        aria-label="Sessions"
      >
        {sessions.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <span>
              <span className="font-medium">{s.device}</span>
              {s.current ? (
                <Badge tone="success" className="ml-2">
                  This device
                </Badge>
              ) : null}
              <span className="block text-xs text-zinc-600 dark:text-zinc-400">
                Signed in {s.created}
                {s.ip ? ` from ${s.ip}` : ""}
              </span>
            </span>
            {s.current ? null : (
              <Button
                type="button"
                variant="outline"
                className="h-8 px-3"
                disabled={busy !== null}
                onClick={() => revoke(s.id)}
              >
                {busy === s.id ? "Signing out..." : "Sign out"}
                <span className="sr-only"> {s.device}</span>
              </Button>
            )}
          </li>
        ))}
      </ul>
      {others > 0 ? (
        <Button type="button" variant="outline" disabled={busy !== null} onClick={revokeOthers}>
          Sign out everywhere else
        </Button>
      ) : null}
    </section>
  );
}
