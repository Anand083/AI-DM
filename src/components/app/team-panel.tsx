"use client";

import { useState, useTransition } from "react";
import {
  changeRoleAction,
  inviteAction,
  removeMemberAction,
  resendInvitationAction,
  revokeInvitationAction,
} from "@/app/app/[agencySlug]/team/actions";
import { FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Member = {
  id: string;
  name: string;
  email: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  isYou: boolean;
  editable: boolean;
};
type Invitation = { id: string; email: string; role: string; expiresAt: string };

const ROLE_NAME: Record<string, string> = { OWNER: "Owner", ADMIN: "Admin", MEMBER: "Member" };

export function TeamPanel({
  agencySlug,
  canManage,
  members,
  invitations,
}: {
  agencySlug: string;
  canManage: boolean;
  members: Member[];
  invitations: Invitation[];
}) {
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("MEMBER");

  function run(
    action: () => Promise<{ ok: boolean; error?: string }>,
    success: string,
    after?: () => void,
  ) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        setMessage({ kind: "success", text: success });
        after?.();
      } else {
        setMessage({ kind: "error", text: result.error ?? "Something went wrong." });
      }
    });
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Team</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          People who work in this agency.
        </p>
      </div>

      {message ? <FormMessage kind={message.kind}>{message.text}</FormMessage> : null}

      {canManage ? (
        <Card>
          <h2 className="text-base font-semibold">Invite a team member</h2>
          <form
            className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () => inviteAction(agencySlug, { email, role }),
                "Invitation sent.",
                () => setEmail(""),
              );
            }}
          >
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-role">Role</Label>
              <select
                id="invite-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="h-10 rounded-md border border-zinc-300 bg-transparent px-3 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              >
                <option value="MEMBER">Member</option>
                <option value="ADMIN">Admin</option>
              </select>
            </div>
            <Button type="submit" disabled={pending}>
              Send invitation
            </Button>
          </form>
        </Card>
      ) : null}

      <section aria-labelledby="members-heading">
        <h2 id="members-heading" className="text-base font-semibold">
          Members ({members.length})
        </h2>
        <ul className="mt-3 divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {m.name} {m.isYou ? <span className="text-zinc-500">(you)</span> : null}
                </p>
                <p className="truncate text-sm text-zinc-600 dark:text-zinc-400">{m.email}</p>
              </div>
              {m.editable && m.role !== "OWNER" ? (
                <>
                  <label className="sr-only" htmlFor={`role-${m.id}`}>
                    Role for {m.name}
                  </label>
                  <select
                    id={`role-${m.id}`}
                    value={m.role}
                    disabled={pending}
                    onChange={(e) =>
                      run(() => changeRoleAction(agencySlug, m.id, e.target.value), "Role updated.")
                    }
                    className="h-9 rounded-md border border-zinc-300 bg-transparent px-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                  >
                    <option value="MEMBER">Member</option>
                    <option value="ADMIN">Admin</option>
                  </select>
                </>
              ) : (
                <span className="text-sm">{ROLE_NAME[m.role]}</span>
              )}
              {m.editable ? (
                <Button
                  variant="outline"
                  className="h-9"
                  disabled={pending}
                  aria-label={`Remove ${m.name}`}
                  onClick={() => {
                    if (confirm(`Remove ${m.name} from this agency?`)) {
                      run(() => removeMemberAction(agencySlug, m.id), "Member removed.");
                    }
                  }}
                >
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {canManage ? (
        <section aria-labelledby="invites-heading">
          <h2 id="invites-heading" className="text-base font-semibold">
            Pending invitations ({invitations.length})
          </h2>
          {invitations.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">No pending invitations.</p>
          ) : (
            <ul className="mt-3 divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {invitations.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{i.email}</p>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">
                      {ROLE_NAME[i.role] ?? i.role} · expires{" "}
                      {new Date(i.expiresAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    className="h-9"
                    disabled={pending}
                    onClick={() =>
                      run(() => resendInvitationAction(agencySlug, i.id), "Invitation sent again.")
                    }
                  >
                    Resend
                  </Button>
                  <Button
                    variant="ghost"
                    className="h-9"
                    disabled={pending}
                    onClick={() =>
                      run(() => revokeInvitationAction(agencySlug, i.id), "Invitation canceled.")
                    }
                  >
                    Cancel
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
