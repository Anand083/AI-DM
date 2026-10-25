"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  removeCustomDomainAction,
  setCustomDomainAction,
  verifyCustomDomainAction,
} from "@/app/app/[agencySlug]/branding/domain-actions";
import { Field, FormMessage } from "@/components/auth/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";

type Props = {
  agencySlug: string;
  domain: string | null;
  status: "NONE" | "PENDING" | "VERIFIED" | "FAILED";
  records: { type: string; name: string; value: string }[];
  allowedByPlan: boolean;
};

const STATUS = {
  NONE: { label: "Not set", tone: "neutral" },
  PENDING: { label: "Waiting for DNS", tone: "warning" },
  VERIFIED: { label: "Working", tone: "success" },
  FAILED: { label: "Not found yet", tone: "danger" },
} as const;

export function CustomDomainPanel({ agencySlug, domain, status, records, allowedByPlan }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await setCustomDomainAction(agencySlug, value);
    setBusy(false);
    if (!result.ok) return setError(result.fieldErrors?.domain ?? result.error);
    setValue("");
    router.refresh();
  }

  async function verify() {
    setBusy(true);
    setError(null);
    const result = await verifyCustomDomainAction(agencySlug);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    if (result.data.status === "VERIFIED") toast("success", "Your domain works.");
    else {
      const missing = [
        !result.data.txt ? "the TXT record" : null,
        !result.data.routing ? "the CNAME record" : null,
      ]
        .filter(Boolean)
        .join(" and ");
      setError(`We could not find ${missing} yet. DNS changes can take up to a few hours.`);
    }
    router.refresh();
  }

  return (
    <section
      aria-labelledby="domain-heading"
      className="space-y-4 border-t border-zinc-200 pt-6 dark:border-zinc-800"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="domain-heading" className="text-lg font-semibold">
          Your own domain
        </h2>
        {domain ? <Badge tone={STATUS[status].tone}>{STATUS[status].label}</Badge> : null}
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Show your client portal on your own address, for example reports.youragency.com.
      </p>
      {!allowedByPlan ? (
        <FormMessage kind="error">
          Your plan does not include a custom domain. Upgrade your plan to use one.
        </FormMessage>
      ) : null}
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}

      {domain ? (
        <div className="space-y-4">
          <p className="text-sm">
            Domain: <strong>{domain}</strong>
          </p>
          {status !== "VERIFIED" ? (
            <>
              <p className="text-sm">
                Add these two records at the company that manages your domain:
              </p>
              <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                <table className="w-full text-left text-sm" aria-label="DNS records">
                  <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                    <tr>
                      {["Type", "Name", "Value"].map((h) => (
                        <th key={h} scope="col" className="px-3 py-2 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {records.map((r) => (
                      <tr key={r.type}>
                        <td className="px-3 py-2 font-medium">{r.type}</td>
                        <td className="break-all px-3 py-2 font-mono text-xs">{r.name}</td>
                        <td className="break-all px-3 py-2 font-mono text-xs">{r.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Your client portal is available at https://{domain}.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {status !== "VERIFIED" ? (
              <Button type="button" onClick={verify} disabled={busy}>
                {busy ? "Checking..." : "Verify"}
              </Button>
            ) : null}
            <ConfirmDialog
              trigger="Remove domain"
              title="Remove your domain?"
              description="Your client portal will only work at our address again."
              confirmLabel="Remove domain"
              onConfirm={async () => {
                const result = await removeCustomDomainAction(agencySlug);
                if (!result.ok) return result.error;
                router.refresh();
                return null;
              }}
            />
          </div>
        </div>
      ) : (
        <form onSubmit={save} className="flex max-w-md flex-col gap-3" noValidate>
          <Field
            id="custom-domain"
            label="Domain"
            placeholder="reports.youragency.com"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={!allowedByPlan}
          />
          <Button type="submit" disabled={busy || !allowedByPlan} className="self-start">
            Save domain
          </Button>
        </form>
      )}
    </section>
  );
}
