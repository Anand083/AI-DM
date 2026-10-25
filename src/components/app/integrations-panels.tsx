"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  createApiKeyAction,
  createWebhookAction,
  deleteWebhookAction,
  revokeApiKeyAction,
  setWebhookEnabledAction,
  testWebhookAction,
} from "@/app/app/[agencySlug]/integrations/actions";
import { FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { API_SCOPES, SCOPE_LABEL, type ApiScope } from "@/lib/api-keys";

export type KeyRow = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsed: string | null;
  created: string;
  revoked: boolean;
};

export function ApiKeysPanel({ agencySlug, keys }: { agencySlug: string; keys: KeyRow[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiScope[]>(["read:clients", "read:projects"]);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFresh(null);
    const result = await createApiKeyAction(agencySlug, { name, scopes });
    setBusy(false);
    if (!result.ok) {
      setError(result.fieldErrors?.name ?? result.fieldErrors?.scopes ?? result.error);
      return;
    }
    setFresh(result.data.key);
    setName("");
    router.refresh();
  }

  async function revoke(id: string, keyName: string) {
    const result = await revokeApiKeyAction(agencySlug, id);
    if (!result.ok) return setError(result.error);
    toast("success", `Key "${keyName}" revoked.`);
    router.refresh();
  }

  return (
    <section aria-labelledby="keys-h" className="space-y-4">
      <h2 id="keys-h" className="text-lg font-semibold">
        API keys
      </h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        A key lets another tool read your data. Keys can only read. Send it as{" "}
        <code>Authorization: Bearer &lt;key&gt;</code>.
      </p>
      <form onSubmit={create} className="space-y-3" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="key-name">Key name</Label>
          <Input
            id="key-name"
            value={name}
            maxLength={60}
            placeholder="Reporting sheet"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">What it may read</legend>
          {API_SCOPES.map((s) => (
            <div key={s} className="flex items-center gap-2">
              <input
                id={`scope-${s}`}
                type="checkbox"
                className="size-4"
                checked={scopes.includes(s)}
                onChange={(e) =>
                  setScopes(e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s))
                }
              />
              <Label htmlFor={`scope-${s}`}>{SCOPE_LABEL[s]}</Label>
            </div>
          ))}
        </fieldset>
        {error ? <FormMessage kind="error">{error}</FormMessage> : null}
        <Button type="submit" disabled={busy}>
          Create key
        </Button>
      </form>
      {fresh ? (
        <div role="status" className="rounded-md border border-amber-400 p-3 text-sm">
          <p className="font-medium">Copy your key now. It will not be shown again.</p>
          <code data-testid="new-api-key" className="mt-2 block break-all">
            {fresh}
          </code>
        </div>
      ) : null}
      {keys.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">No keys yet.</p>
      ) : (
        <ul aria-label="API keys" className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {keys.map((k) => (
            <li
              key={k.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
            >
              <div>
                <p className="font-medium">
                  {k.name}{" "}
                  <span className="font-normal text-zinc-600 dark:text-zinc-400">
                    ({k.prefix}...)
                  </span>
                </p>
                <p className="text-xs text-zinc-600 dark:text-zinc-400">
                  {k.scopes.map((s) => SCOPE_LABEL[s as ApiScope] ?? s).join(", ")}. Created{" "}
                  {k.created}. {k.lastUsed ? `Last used ${k.lastUsed}.` : "Never used."}
                  {k.revoked ? " Revoked." : ""}
                </p>
              </div>
              {k.revoked ? null : (
                <Button
                  variant="outline"
                  onClick={() => revoke(k.id, k.name)}
                  aria-label={`Revoke ${k.name}`}
                >
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export type HookRow = {
  id: string;
  url: string;
  format: string;
  secret: string;
  enabled: boolean;
  lastError: string | null;
  recent: { id: string; event: string; status: string; httpStatus: number | null; when: string }[];
};

export function WebhooksPanel({ agencySlug, hooks }: { agencySlug: string; hooks: HookRow[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState("JSON");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await createWebhookAction(agencySlug, { url, format });
    setBusy(false);
    if (!result.ok) {
      setError(result.fieldErrors?.url ?? result.error);
      return;
    }
    toast("success", "Webhook added.");
    setUrl("");
    router.refresh();
  }

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    setError(null);
    const result = await fn();
    if (!result.ok) return setError(result.error ?? "Something went wrong.");
    toast("success", done);
    router.refresh();
  }

  return (
    <section aria-labelledby="hooks-h" className="space-y-4">
      <h2 id="hooks-h" className="text-lg font-semibold">
        Webhooks and Slack
      </h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        We send a message to a web address when a new alert is created. Choose Slack to post
        straight into a Slack channel with an incoming webhook address. Other tools get JSON with an{" "}
        <code>X-Signature</code> header you can check with the secret.
      </p>
      <form
        onSubmit={create}
        className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end"
        noValidate
      >
        <div className="space-y-1.5">
          <Label htmlFor="hook-url">Web address</Label>
          <Input
            id="hook-url"
            value={url}
            placeholder="https://hooks.slack.com/services/..."
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hook-format">Format</Label>
          <Select id="hook-format" value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="JSON">JSON</option>
            <option value="SLACK">Slack</option>
          </Select>
        </div>
        <Button type="submit" disabled={busy}>
          Add webhook
        </Button>
      </form>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      {hooks.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">No webhooks yet.</p>
      ) : (
        <ul aria-label="Webhooks" className="space-y-4">
          {hooks.map((h) => (
            <li
              key={h.id}
              className="space-y-2 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800"
            >
              <p className="break-all font-medium">
                {h.format === "SLACK" ? "Slack" : "JSON"}: {h.url}
              </p>
              {h.format === "JSON" ? (
                <p className="break-all text-xs text-zinc-600 dark:text-zinc-400">
                  Secret: {h.secret}
                </p>
              ) : null}
              <p className="text-xs">
                {h.enabled ? "On." : "Off."} {h.lastError ? `Problem: ${h.lastError}` : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() =>
                    run(() => testWebhookAction(agencySlug, h.id), "Test message queued.")
                  }
                  disabled={!h.enabled}
                  aria-label={`Send test to ${h.url}`}
                >
                  Send test
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    run(
                      () => setWebhookEnabledAction(agencySlug, h.id, !h.enabled),
                      h.enabled ? "Webhook turned off." : "Webhook turned on.",
                    )
                  }
                  aria-label={`${h.enabled ? "Turn off" : "Turn on"} ${h.url}`}
                >
                  {h.enabled ? "Turn off" : "Turn on"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    run(() => deleteWebhookAction(agencySlug, h.id), "Webhook deleted.")
                  }
                  aria-label={`Delete ${h.url}`}
                >
                  Delete
                </Button>
              </div>
              {h.recent.length > 0 ? (
                <ul
                  aria-label="Recent messages"
                  className="text-xs text-zinc-600 dark:text-zinc-400"
                >
                  {h.recent.map((d) => (
                    <li key={d.id}>
                      {d.when}: {d.event} {d.status.toLowerCase()}
                      {d.httpStatus ? ` (${d.httpStatus})` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
