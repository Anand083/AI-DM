"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

/** The second step of signing in, for people with an authenticator app. */
export function TwoFactorStep({ next }: { next: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [backup, setBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const clean = code.replace(/\s+/g, "");
    const { error: failed } = backup
      ? await authClient.twoFactor.verifyBackupCode({ code: clean })
      : await authClient.twoFactor.verifyTotp({ code: clean });
    if (!failed) {
      router.push(next);
      router.refresh();
      return;
    }
    setBusy(false);
    setError(
      failed.status === 429
        ? "Too many attempts. Please wait a few minutes and try again."
        : "That code is not right. Please try again.",
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate aria-label="Two-step sign in">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {backup
          ? "Enter one of your backup codes. Each code works once."
          : "Open your authenticator app and enter the 6-digit code."}
      </p>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <Field
        id="code"
        label={backup ? "Backup code" : "6-digit code"}
        inputMode={backup ? "text" : "numeric"}
        autoComplete="one-time-code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      <Button type="submit" className="w-full" disabled={busy || code.trim().length === 0}>
        {busy ? "Checking..." : "Continue"}
      </Button>
      <button
        type="button"
        className="text-sm underline"
        onClick={() => {
          setBackup((b) => !b);
          setCode("");
          setError(null);
        }}
      >
        {backup ? "Use my authenticator app" : "Use a backup code"}
      </button>
    </form>
  );
}
