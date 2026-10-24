"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { acceptInvitationAction } from "@/app/invite-actions";

export function AcceptInvitationButton({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function accept() {
    setBusy(true);
    setError(null);
    const result = await acceptInvitationAction(token);
    if (result.ok) {
      router.push(`/app/${result.data.agencySlug}`);
      router.refresh();
    } else {
      setError(result.error);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <Button className="w-full" onClick={accept} disabled={busy}>
        {busy ? "Joining..." : "Accept invitation"}
      </Button>
    </div>
  );
}
