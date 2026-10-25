"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { finishMockCheckoutAction } from "@/app/app/[agencySlug]/billing/actions";
import { FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";

export function MockCheckoutForm({
  agencySlug,
  sessionId,
  open,
}: {
  agencySlug: string;
  sessionId: string;
  open: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish(outcome: "pay" | "fail") {
    setBusy(true);
    setError(null);
    const result = await finishMockCheckoutAction(agencySlug, sessionId, outcome);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    router.push(`/app/${agencySlug}/billing?checkout=${result.data.paid ? "paid" : "failed"}`);
    router.refresh();
  }

  if (!open) {
    return <FormMessage kind="error">This checkout was already finished.</FormMessage>;
  }
  return (
    <div className="space-y-3">
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => finish("pay")} disabled={busy}>
          Pay
        </Button>
        <Button type="button" variant="outline" onClick={() => finish("fail")} disabled={busy}>
          Fail payment
        </Button>
      </div>
    </div>
  );
}
