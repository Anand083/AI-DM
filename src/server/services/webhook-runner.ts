import type { PrismaClient } from "@prisma/client";
import { buildJsonPayload, buildSlackPayload, signWebhook, type AlertEvent } from "@/lib/webhook";

export type SendResult = { status: number } | { error: string };

export type WebhookRunnerDeps = {
  /** System-wide read of all agencies' webhooks, so it uses the plain client. */
  db: Pick<PrismaClient, "webhook" | "webhookDelivery" | "alert">;
  now: Date;
  /** Sends one message. Must not follow redirects and must stop after a short time. */
  send: (url: string, headers: Record<string, string>, body: string) => Promise<SendResult>;
  /** False when the address points to a private place (checked again right before sending). */
  addressAllowed: (url: string) => Promise<boolean>;
  batchSize?: number;
  /** Failed deliveries in a row before the webhook is switched off. */
  maxFailures?: number;
};

const DEFAULT_MAX_FAILURES = 10;
const ALERTS_PER_RUN = 200;

type HookRow = {
  id: string;
  agencyId: string;
  url: string;
  format: string;
  secret: string;
};

/** Builds and sends one message. Returns how it went. */
async function deliver(
  deps: WebhookRunnerDeps,
  hook: HookRow,
  agencyName: string,
  alert: AlertEvent,
): Promise<{ ok: boolean; permanent: boolean; status?: number; error?: string }> {
  if (!(await deps.addressAllowed(hook.url)))
    return { ok: false, permanent: false, error: "The address points to a private place." };
  const body =
    hook.format === "SLACK"
      ? buildSlackPayload(agencyName, alert)
      : buildJsonPayload(hook.agencyId, alert);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Webhook-Sender/1",
  };
  if (hook.format !== "SLACK") {
    headers["X-Event"] = "alert.created";
    headers["X-Signature"] = signWebhook(hook.secret, body, Math.floor(deps.now.getTime() / 1000));
  }
  const result = await deps.send(hook.url, headers, body);
  if ("error" in result) return { ok: false, permanent: false, error: result.error.slice(0, 200) };
  if (result.status >= 200 && result.status < 300)
    return { ok: true, permanent: false, status: result.status };
  // A 4xx will not get better by trying again, except "too slow" and "too many".
  const permanent =
    result.status >= 400 && result.status < 500 && ![408, 429].includes(result.status);
  return {
    ok: false,
    permanent,
    status: result.status,
    error: `The address answered ${result.status}.`,
  };
}

/**
 * Sends new alerts to every enabled webhook, oldest first. A message that fails because of the
 * network or a server error stops that webhook for this run and is tried again on the next run.
 * A message the receiver refuses (4xx) is recorded and skipped. After many failures in a row the
 * webhook is switched off. It runs inside the single maintenance tick, so runs do not overlap.
 */
export async function runWebhookDeliveries(
  deps: WebhookRunnerDeps,
): Promise<{ webhooks: number; sent: number; failed: number }> {
  const maxFailures = deps.maxFailures ?? DEFAULT_MAX_FAILURES;
  const hooks = await deps.db.webhook.findMany({
    where: {
      enabled: true,
      agency: { status: "ACTIVE", deletedAt: null },
    },
    select: {
      id: true,
      agencyId: true,
      url: true,
      format: true,
      secret: true,
      cursorAt: true,
      failureStreak: true,
      agency: { select: { name: true } },
    },
    orderBy: [{ cursorAt: "asc" }, { id: "asc" }],
    take: deps.batchSize ?? 100,
  });

  let sent = 0;
  let failed = 0;
  for (const hook of hooks) {
    const rows = await deps.db.alert.findMany({
      where: { agencyId: hook.agencyId, createdAt: { gt: hook.cursorAt, lte: deps.now } },
      select: {
        id: true,
        type: true,
        severity: true,
        title: true,
        body: true,
        projectId: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: ALERTS_PER_RUN + 1,
    });
    // Do not cut a group of alerts made at the same moment in half.
    let alerts = rows;
    if (rows.length > ALERTS_PER_RUN) {
      const lastTime = rows[rows.length - 1]!.createdAt.getTime();
      const whole = rows.filter((r) => r.createdAt.getTime() < lastTime);
      alerts = whole.length > 0 ? whole : rows.slice(0, ALERTS_PER_RUN);
    }
    let cursor = hook.cursorAt;
    let streak = hook.failureStreak;
    let lastError: string | null = null;
    let stop = false;
    for (const alert of alerts) {
      const out = await deliver(deps, hook, hook.agency.name, alert);
      await deps.db.webhookDelivery.create({
        data: {
          agencyId: hook.agencyId,
          webhookId: hook.id,
          event: "alert.created",
          alertId: alert.id,
          status: out.ok ? "SUCCESS" : out.permanent ? "REJECTED" : "FAILED",
          httpStatus: out.status ?? null,
          error: out.error ?? null,
        },
      });
      if (out.ok) {
        sent++;
        streak = 0;
        cursor = alert.createdAt;
        continue;
      }
      failed++;
      streak++;
      lastError = out.error ?? null;
      if (out.permanent) {
        cursor = alert.createdAt;
        continue;
      }
      stop = true;
      break;
    }
    const off = streak >= maxFailures;
    const message = off
      ? `Switched off after ${streak} failures in a row. ${lastError ?? ""}`.trim()
      : lastError !== null || stop
        ? lastError
        : alerts.length > 0
          ? null
          : undefined;
    await deps.db.webhook.update({
      where: { id: hook.id },
      data: {
        cursorAt: cursor,
        failureStreak: streak,
        ...(alerts.length > 0 ? { lastDeliveryAt: deps.now } : {}),
        ...(message !== undefined ? { lastError: message } : {}),
        ...(off ? { enabled: false } : {}),
      },
    });
  }
  return { webhooks: hooks.length, sent, failed };
}

/** Sends a sample message so the receiver can be checked. Used by the "Send test" button. */
export async function runWebhookTest(
  deps: WebhookRunnerDeps,
  data: { webhookId: string; agencyId: string },
): Promise<{ ok: boolean; error?: string }> {
  const hook = await deps.db.webhook.findFirst({
    where: { id: data.webhookId, agencyId: data.agencyId },
    select: {
      id: true,
      agencyId: true,
      url: true,
      format: true,
      secret: true,
      agency: { select: { name: true } },
    },
  });
  if (!hook) return { ok: false, error: "Webhook not found." };
  const sample: AlertEvent = {
    id: "test",
    type: "TEST",
    severity: "INFO",
    title: "Test message",
    body: "This is a test message from your webhook settings.",
    projectId: null,
    createdAt: deps.now,
  };
  const out = await deliver(deps, hook, hook.agency.name, sample);
  await deps.db.webhookDelivery.create({
    data: {
      agencyId: hook.agencyId,
      webhookId: hook.id,
      event: "test",
      status: out.ok ? "SUCCESS" : "FAILED",
      httpStatus: out.status ?? null,
      error: out.error ?? null,
    },
  });
  return { ok: out.ok, error: out.error };
}
