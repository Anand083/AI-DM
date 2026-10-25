"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  saveFinanceSettingsAction,
  setRetainerAction,
} from "@/app/app/[agencySlug]/profitability/actions";
import { FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { CURRENCIES } from "@/lib/money";

const selectClass =
  "h-10 rounded-md border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-950";

export function FinanceSettingsForm({
  agencySlug,
  initial,
}: {
  agencySlug: string;
  initial: { baseCurrency: string; hourlyCost: string; rates: Record<string, string> };
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [base, setBase] = useState(initial.baseCurrency);
  const [hourly, setHourly] = useState(initial.hourlyCost);
  const [rates, setRates] = useState(initial.rates);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await saveFinanceSettingsAction(agencySlug, {
      baseCurrency: base,
      hourlyCost: hourly,
      rates,
    });
    setBusy(false);
    if (!result.ok) {
      const first = result.fieldErrors ? Object.values(result.fieldErrors)[0] : undefined;
      setError(first ?? result.error);
      return;
    }
    toast("success", "Money settings saved.");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="base-currency">Your currency</Label>
          <select
            id="base-currency"
            value={base}
            onChange={(e) => setBase(e.target.value)}
            className={`${selectClass} w-full`}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hourly-cost">Cost of one team hour ({base})</Label>
          <Input
            id="hourly-cost"
            inputMode="decimal"
            value={hourly}
            onChange={(e) => setHourly(e.target.value)}
            placeholder="35"
          />
        </div>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Exchange rates</legend>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          How many {base} one unit of each currency is worth. Leave blank if you do not use it. USD
          is needed to count provider costs.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {CURRENCIES.filter((c) => c !== base).map((c) => (
            <div key={c} className="space-y-1">
              <Label htmlFor={`rate-${c}`}>1 {c}</Label>
              <Input
                id={`rate-${c}`}
                inputMode="decimal"
                value={rates[c] ?? ""}
                onChange={(e) => setRates({ ...rates, [c]: e.target.value })}
              />
            </div>
          ))}
        </div>
      </fieldset>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <Button type="submit" disabled={busy}>
        Save money settings
      </Button>
    </form>
  );
}

export function RetainerForm({
  agencySlug,
  clientId,
  clientName,
  initialAmount,
  initialCurrency,
}: {
  agencySlug: string;
  clientId: string;
  clientName: string;
  initialAmount: string;
  initialCurrency: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [amount, setAmount] = useState(initialAmount);
  const [currency, setCurrency] = useState(initialCurrency);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await setRetainerAction(agencySlug, clientId, { amount, currency });
    setBusy(false);
    if (!result.ok) {
      setError(result.fieldErrors?.["values.amount"] ?? result.fieldErrors?.amount ?? result.error);
      return;
    }
    toast("success", `Retainer saved for ${clientName}.`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2" noValidate>
      <Input
        aria-label={`Monthly retainer for ${clientName}`}
        inputMode="decimal"
        className="w-28"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <select
        aria-label={`Retainer currency for ${clientName}`}
        value={currency}
        onChange={(e) => setCurrency(e.target.value)}
        className={selectClass}
      >
        {CURRENCIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <Button type="submit" variant="outline" disabled={busy}>
        Save
      </Button>
      {error ? <span className="text-xs text-red-700 dark:text-red-400">{error}</span> : null}
    </form>
  );
}
