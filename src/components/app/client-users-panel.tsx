"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  inviteClientUserAction,
  removeClientUserAction,
  revokeClientInviteAction,
} from "@/app/app/[agencySlug]/clients/client-user-actions";
import { Field, FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";

export function ClientUsersPanel({
  agencySlug,
  clientId,
  portalUrl,
  users,
  pending,
  canInvite,
}: {
  agencySlug: string;
  clientId: string;
  portalUrl: string;
  users: { id: string; name: string; email: string }[];
  pending: { id: string; email: string; expires: string }[];
  canInvite: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await inviteClientUserAction(agencySlug, clientId, email);
    setBusy(false);
    if (!result.ok) {
      setError(result.fieldErrors?.email ?? result.error);
      return;
    }
    toast("success", "Invitation sent.");
    setEmail("");
    router.refresh();
  }

  return (
    <section aria-labelledby="client-users-heading" className="space-y-3">
      <h2 id="client-users-heading" className="text-lg font-semibold">
        Client access
      </h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        People you invite can see this client&apos;s websites, rankings and reports. They cannot
        change anything. They sign in at <span className="font-mono text-xs">{portalUrl}</span>.
      </p>
      {users.length === 0 && pending.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">No one has access yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
          {users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span>
                {u.name} <span className="text-zinc-600 dark:text-zinc-400">({u.email})</span>
              </span>
              {canInvite ? (
                <ConfirmDialog
                  trigger="Remove access"
                  title={`Remove access for ${u.name}?`}
                  description="They will no longer be able to see this client. Their account is kept."
                  confirmLabel="Remove access"
                  onConfirm={async () => {
                    const result = await removeClientUserAction(agencySlug, clientId, u.id);
                    if (!result.ok) return result.error;
                    router.refresh();
                    return null;
                  }}
                />
              ) : null}
            </li>
          ))}
          {pending.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span>
                {p.email}{" "}
                <span className="text-zinc-600 dark:text-zinc-400">
                  (invited, link works until {p.expires})
                </span>
              </span>
              {canInvite ? (
                <ConfirmDialog
                  trigger="Cancel invitation"
                  title={`Cancel the invitation for ${p.email}?`}
                  description="The link in the email will stop working."
                  confirmLabel="Cancel invitation"
                  onConfirm={async () => {
                    const result = await revokeClientInviteAction(agencySlug, clientId, p.id);
                    if (!result.ok) return result.error;
                    router.refresh();
                    return null;
                  }}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canInvite ? (
        <form onSubmit={invite} className="flex max-w-md flex-col gap-3" noValidate>
          {error ? <FormMessage kind="error">{error}</FormMessage> : null}
          <Field
            id="client-user-email"
            label="Invite by email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button type="submit" disabled={busy} className="self-start">
            {busy ? "Sending..." : "Send invitation"}
          </Button>
        </form>
      ) : null}
    </section>
  );
}
