import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { getEnv } from "@/env";
import { checkWebhookUrl, isPrivateIp } from "@/lib/webhook";
import type { SendResult } from "./webhook-runner";

/** Development and tests may call local addresses over http. Production never does. */
const allowLocal = () => getEnv().NODE_ENV !== "production";

/**
 * True when the address is allowed and every IP it resolves to is public. The name is looked up
 * again by fetch, so a hostile DNS server could still answer differently the second time; this
 * guard stops the common cases (private names, private IPs, redirects) but is not complete.
 */
export async function addressAllowed(url: string): Promise<boolean> {
  const local = allowLocal();
  const checked = checkWebhookUrl(url, { allowLocalHttp: local });
  if (!checked.ok) return false;
  const host = new URL(checked.url).hostname.replace(/^\[|\]$/g, "");
  if (local && (host === "localhost" || host === "127.0.0.1" || host === "::1")) return true;
  if (isIP(host)) return !isPrivateIp(host);
  try {
    const found = await lookup(host, { all: true });
    return found.length > 0 && found.every((f) => !isPrivateIp(f.address));
  } catch {
    return false;
  }
}

export async function sendWebhook(
  url: string,
  headers: Record<string, string>,
  body: string,
): Promise<SendResult> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    await res.body?.cancel().catch(() => undefined);
    return { status: res.status };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not reach the address." };
  }
}
