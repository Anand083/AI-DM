import { createHmac } from "node:crypto";
import { isIP } from "node:net";

/** True for addresses that are not on the public internet (private, loopback, link-local). */
export function isPrivateIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (kind === 6) {
    const v = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return isPrivateIp(mapped[1]!);
    return (
      v === "::" ||
      v === "::1" ||
      v.startsWith("fc") ||
      v.startsWith("fd") ||
      /^fe[89ab]/.test(v) ||
      v.startsWith("ff")
    );
  }
  return true;
}

const BLOCKED_SUFFIXES = [".local", ".localhost", ".internal", ".lan", ".home", ".corp"];

/**
 * Checks the address a webhook will call. Only https; no ports other than 443 in production;
 * no private or local hosts. Returns the cleaned address or a plain-English problem.
 * `allowLocalHttp` is for development and tests only.
 */
export function checkWebhookUrl(
  text: string,
  options: { allowLocalHttp?: boolean } = {},
): { ok: true; url: string } | { ok: false; message: string } {
  let u: URL;
  try {
    u = new URL(text.trim());
  } catch {
    return { ok: false, message: "Enter a full web address, like https://example.com/hook." };
  }
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (options.allowLocalHttp && local && (u.protocol === "http:" || u.protocol === "https:")) {
    return { ok: true, url: u.toString() };
  }
  if (u.protocol !== "https:")
    return { ok: false, message: "The address must start with https://." };
  if (u.username || u.password)
    return { ok: false, message: "Do not put a user name or password in the address." };
  if (u.port && u.port !== "443") return { ok: false, message: "Use the standard https port." };
  if (
    isIP(host)
      ? isPrivateIp(host)
      : !host.includes(".") || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))
  ) {
    return { ok: false, message: "That address points to a private or local place." };
  }
  if (text.length > 500) return { ok: false, message: "The address is too long." };
  return { ok: true, url: u.toString() };
}

/** Header value: t=<unix seconds>,v1=<hex hmac of "t.body">. */
export function signWebhook(secret: string, body: string, unixSeconds: number): string {
  const v1 = createHmac("sha256", secret).update(`${unixSeconds}.${body}`).digest("hex");
  return `t=${unixSeconds},v1=${v1}`;
}

export type AlertEvent = {
  id: string;
  type: string;
  severity: string;
  title: string;
  body: string;
  projectId: string | null;
  createdAt: Date;
};

export function buildJsonPayload(agencyId: string, alert: AlertEvent): string {
  return JSON.stringify({
    event: "alert.created",
    agencyId,
    createdAt: alert.createdAt.toISOString(),
    alert: {
      id: alert.id,
      type: alert.type,
      severity: alert.severity,
      title: alert.title,
      body: alert.body,
      projectId: alert.projectId,
    },
  });
}

const slackText = (s: string) =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

export function buildSlackPayload(agencyName: string, alert: AlertEvent): string {
  return JSON.stringify({
    text: `*${slackText(alert.title)}*\n${slackText(alert.body)}\n_${slackText(agencyName)} (${alert.severity.toLowerCase()})_`,
  });
}
