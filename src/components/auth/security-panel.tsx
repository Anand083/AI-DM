"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormMessage, Field } from "@/components/auth/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { authClient } from "@/lib/auth-client";

type Step = "idle" | "password" | "verify";

/** Turn the authenticator-app step on or off. Without a QR library, the secret is shown as text. */
export function TwoFactorPanel({ enabled, required }: { enabled: boolean; required: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("idle");
  const [password, setPassword] = useState("");
  const [secret, setSecret] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error: failed } = await authClient.twoFactor.enable({ password });
    setBusy(false);
    if (failed || !data || !("totpURI" in data)) {
      return setError("That password is not right.");
    }
    const found = new URL(data.totpURI).searchParams.get("secret") ?? "";
    setSecret(found);
    setBackupCodes(data.backupCodes);
    setPassword("");
    setStep("verify");
  }

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: failed } = await authClient.twoFactor.verifyTotp({
      code: code.replace(/\s+/g, ""),
    });
    setBusy(false);
    if (failed)
      return setError("That code is not right. Check the time on your phone and try again.");
    toast("success", "Two-step sign in is on.");
    setStep("idle");
    setCode("");
    router.refresh();
  }

  async function turnOff(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: failed } = await authClient.twoFactor.disable({ password });
    setBusy(false);
    if (failed) return setError("That password is not right.");
    toast("success", "Two-step sign in is off.");
    setStep("idle");
    setPassword("");
    router.refresh();
  }

  return (
    <section aria-labelledby="2fa-h" className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="2fa-h" className="text-lg font-semibold">
          Two-step sign in
        </h2>
        <Badge tone={enabled ? "success" : "neutral"}>{enabled ? "On" : "Off"}</Badge>
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        After your password, you enter a 6-digit code from an authenticator app on your phone.
      </p>
      {required && !enabled ? (
        <FormMessage kind="error">
          Admins must turn on two-step sign in before using the admin area.
        </FormMessage>
      ) : null}
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}

      {step === "verify" ? (
        <div className="max-w-md space-y-4">
          <p className="text-sm">
            1. In your authenticator app, add an account by entering this key by hand:
          </p>
          <p
            className="break-all rounded bg-zinc-100 px-3 py-2 font-mono text-sm dark:bg-zinc-900"
            data-testid="totp-secret"
          >
            {secret}
          </p>
          <p className="text-sm">
            2. Save these backup codes somewhere safe. Each works once, and you will not see them
            again.
          </p>
          <ul
            className="grid grid-cols-2 gap-1 rounded bg-zinc-100 px-3 py-2 font-mono text-sm dark:bg-zinc-900"
            aria-label="Backup codes"
          >
            {backupCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <form onSubmit={confirm} className="space-y-3" noValidate>
            <Field
              id="totp-code"
              label="3. Enter the 6-digit code from the app"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <Button type="submit" disabled={busy || code.trim().length === 0}>
              {busy ? "Checking..." : "Turn on"}
            </Button>
          </form>
        </div>
      ) : step === "password" ? (
        <form onSubmit={enabled ? turnOff : start} className="max-w-md space-y-3" noValidate>
          <Field
            id="2fa-password"
            label="Your password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || password.length === 0}>
              {enabled ? "Turn off" : "Continue"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setStep("idle");
                setPassword("");
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button
          type="button"
          variant={enabled ? "outline" : "primary"}
          onClick={() => setStep("password")}
        >
          {enabled ? "Turn off two-step sign in" : "Set up two-step sign in"}
        </Button>
      )}
    </section>
  );
}
