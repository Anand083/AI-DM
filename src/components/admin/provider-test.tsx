"use client";

import { useState } from "react";
import { testConnectionAction } from "@/app/admin-actions";
import { Button } from "@/components/ui/button";

type Outcome = { ok: boolean; balanceUsd?: number; message?: string };

export function ProviderTest({ provider }: { provider: string }) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function test() {
    setBusy(true);
    const result = await testConnectionAction({ provider });
    setBusy(false);
    setOutcome(result.ok ? result.data : { ok: false, message: result.error });
  }

  return (
    <div className="space-y-1">
      <Button type="button" variant="outline" className="h-9 px-3" onClick={test} disabled={busy}>
        {busy ? "Testing..." : `Test connection (${provider})`}
      </Button>
      {outcome ? (
        <p
          role="status"
          className={`text-sm ${outcome.ok ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}
        >
          {outcome.ok ? "Connection works." : "Connection failed."}
          {outcome.balanceUsd !== undefined ? ` Balance: $${outcome.balanceUsd.toFixed(2)}.` : ""}
          {outcome.message ? ` ${outcome.message}` : ""}
        </p>
      ) : null}
    </div>
  );
}
