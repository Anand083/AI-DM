"use client";

import { useState } from "react";
import { FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function ResendVerification({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function resend() {
    setState("sending");
    const { error } = await authClient.sendVerificationEmail({ email, callbackURL: "/app" });
    setState(error ? "error" : "sent");
  }

  return (
    <div className="space-y-3">
      {state === "sent" ? <FormMessage kind="success">We sent a new link.</FormMessage> : null}
      {state === "error" ? (
        <FormMessage kind="error">
          We could not send the email. Please try again in a few minutes.
        </FormMessage>
      ) : null}
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={resend}
        disabled={state === "sending"}
      >
        {state === "sending" ? "Sending..." : "Send the link again"}
      </Button>
    </div>
  );
}
