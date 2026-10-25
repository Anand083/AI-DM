"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { setBudgetAction, setFlagAction, setMaintenanceAction } from "@/app/admin-actions";
import { Field, FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export function BudgetForm({ budgetUsd }: { budgetUsd: number }) {
  const router = useRouter();
  const { toast } = useToast();
  const [value, setValue] = useState(String(budgetUsd));
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const result = await setBudgetAction({ usd: Number(value) });
    if (!result.ok) return setError(result.error);
    toast("success", "Budget saved.");
    router.refresh();
  }
  return (
    <form
      onSubmit={save}
      className="flex max-w-md flex-wrap items-end gap-3"
      noValidate
      aria-label="Provider budget"
    >
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <Field
        id="budget"
        label="Provider budget per month (USD)"
        type="number"
        min={0}
        step="1"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button type="submit" variant="outline" className="h-10">
        Save budget
      </Button>
    </form>
  );
}

export function MaintenanceToggle({ on }: { on: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  async function toggle() {
    setBusy(true);
    const result = await setMaintenanceAction({ on: !on });
    setBusy(false);
    if (result.ok) {
      toast("success", on ? "Maintenance mode is off." : "Maintenance mode is on.");
      router.refresh();
    }
  }
  return (
    <Button type="button" variant={on ? "primary" : "outline"} onClick={toggle} disabled={busy}>
      {on ? "Turn maintenance mode off" : "Turn maintenance mode on"}
    </Button>
  );
}

export function FlagToggle({
  flagKey,
  label,
  enabled,
}: {
  flagKey: string;
  label: string;
  enabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function toggle() {
    setBusy(true);
    await setFlagAction({ key: flagKey, enabled: !enabled });
    setBusy(false);
    router.refresh();
  }
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={enabled} onChange={toggle} disabled={busy} />
      {label}
    </label>
  );
}
