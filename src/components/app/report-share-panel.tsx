"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { revokeShareAction, shareReportAction } from "@/app/app/[agencySlug]/reports/actions";
import { FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { SHARE_DAY_OPTIONS } from "@/lib/schemas/report";

export function ReportSharePanel({
  agencySlug,
  reportId,
  shareUrl,
  expiresLabel,
}: {
  agencySlug: string;
  reportId: string;
  /** The full public link, or null when sharing is off. */
  shareUrl: string | null;
  expiresLabel: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [days, setDays] = useState<number>(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function turnOn() {
    setBusy(true);
    setError(null);
    const result = await shareReportAction(agencySlug, reportId, days);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    toast("success", shareUrl ? "The link was renewed." : "The link is ready.");
    router.refresh();
  }

  async function turnOff() {
    setBusy(true);
    setError(null);
    const result = await revokeShareAction(agencySlug, reportId);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    toast("success", "The link no longer works.");
    router.refresh();
  }

  async function copy() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast("success", "Link copied.");
    } catch {
      toast("error", "Could not copy. Select the link and copy it by hand.");
    }
  }

  return (
    <section
      aria-labelledby="share-heading"
      className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <h2 id="share-heading" className="text-base font-semibold">
        Share link
      </h2>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      {shareUrl ? (
        <div className="space-y-2">
          <input
            readOnly
            aria-label="Public link"
            value={shareUrl}
            onFocus={(e) => e.currentTarget.select()}
            className="h-10 w-full rounded-md border border-zinc-300 bg-transparent px-3 font-mono text-xs dark:border-zinc-700"
          />
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Anyone with this link can see the report. It works until {expiresLabel}.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={copy}>
              Copy link
            </Button>
            <Button type="button" variant="ghost" onClick={turnOff} disabled={busy}>
              Turn off link
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Make a link your client can open without signing in.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="share-days">Link works for</Label>
          <Select id="share-days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {SHARE_DAY_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </Select>
        </div>
        <Button type="button" onClick={turnOn} disabled={busy}>
          {shareUrl ? "Renew link" : "Create link"}
        </Button>
      </div>
    </section>
  );
}
