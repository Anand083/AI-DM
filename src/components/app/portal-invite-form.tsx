"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { acceptPortalInviteAction } from "@/app/portal-actions";
import { Field, FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";

/** For a new person: name and password. For someone already signed in: one button. */
export function PortalInviteForm({
  agencySlug,
  token,
  email,
  needsAccount,
}: {
  agencySlug: string;
  token: string;
  email: string;
  needsAccount: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    const result = await acceptPortalInviteAction({
      agencySlug,
      token,
      ...(needsAccount ? { name, password } : {}),
    });
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      setFields(result.fieldErrors ?? {});
      return;
    }
    router.push(`/portal/${agencySlug}`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      {needsAccount ? (
        <>
          <Field id="email" label="Email" value={email} readOnly disabled />
          <Field
            id="name"
            label="Your name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={fields.name}
          />
          <Field
            id="password"
            label="Choose a password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fields.password}
          />
          <p className="text-xs text-zinc-600 dark:text-zinc-400">Use at least 10 characters.</p>
        </>
      ) : null}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "Opening..." : needsAccount ? "Create my access" : "Open my page"}
      </Button>
    </form>
  );
}
