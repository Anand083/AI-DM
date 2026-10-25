"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";

type Result = { ok: true; data?: unknown } | { ok: false; error: string };

/** A button that runs an admin action, shows what happened, and refreshes the page. */
export function AdminButton({
  label,
  run,
  success,
  confirm,
  variant = "outline",
  onDone,
}: {
  label: string;
  run: () => Promise<Result>;
  success?: string;
  /** Ask first. */
  confirm?: { title: string; description: string };
  variant?: "primary" | "outline" | "ghost";
  onDone?: (data: unknown) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go(): Promise<string | null> {
    setBusy(true);
    setError(null);
    const result = await run();
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return result.error;
    }
    if (success) toast("success", success);
    onDone?.(result.data);
    router.refresh();
    return null;
  }

  if (confirm) {
    return (
      <ConfirmDialog
        trigger={label}
        title={confirm.title}
        description={confirm.description}
        confirmLabel={label}
        onConfirm={go}
      />
    );
  }
  return (
    <span className="inline-flex flex-col gap-1">
      <Button type="button" variant={variant} className="h-9 px-3" disabled={busy} onClick={go}>
        {busy ? "Please wait..." : label}
      </Button>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
    </span>
  );
}
