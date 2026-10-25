import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as getAlerts } from "@/app/api/v1/alerts/route";
import { GET as getClients } from "@/app/api/v1/clients/route";
import { GET as getProjects } from "@/app/api/v1/projects/route";
import { GET as getRankings } from "@/app/api/v1/projects/[projectId]/rankings/route";
import { sendDigest } from "@/server/services/alert-digest";
import {
  authenticateApiKey,
  createApiKey,
  listApiKeys,
  revokeApiKey,
} from "@/server/services/api-keys";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/server/services/errors";
import { getMyNotifications, setMyDigest } from "@/server/services/notifications";
import {
  createWebhook,
  deleteWebhook,
  listWebhooks,
  setWebhookEnabled,
} from "@/server/services/webhooks";
import {
  runWebhookDeliveries,
  runWebhookTest,
  type SendResult,
} from "@/server/services/webhook-runner";
import { createAgencyWithMembers, seedPlans } from "../factories";
import { createTestClient, resetDb } from "../helpers/db";

const prisma = createTestClient();
beforeAll(async () => {
  await resetDb(prisma);
  await seedPlans(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function setup(plan = "GROWTH") {
  const { agency, members } = await createAgencyWithMembers(
    prisma,
    ["OWNER", "ADMIN", "MEMBER"],
    undefined,
    plan,
  );
  return { agency, owner: members[0]!.ctx, admin: members[1]!.ctx, member: members[2]!.ctx };
}
type S = Awaited<ReturnType<typeof setup>>;

const req = (path: string, key?: string) =>
  new Request(`http://localhost${path}`, {
    headers: key ? { authorization: `Bearer ${key}` } : {},
  });

async function seedData(s: S, tag: string) {
  const client = await prisma.client.create({
    data: { agencyId: s.agency.id, name: `Client ${tag}` },
  });
  const project = await prisma.project.create({
    data: {
      agencyId: s.agency.id,
      clientId: client.id,
      name: `Project ${tag}`,
      domain: `${tag}.example.com`,
      locationCode: 2840,
      languageCode: "en",
    },
  });
  await prisma.keyword.create({
    data: {
      agencyId: s.agency.id,
      projectId: project.id,
      phrase: `kw ${tag}`,
      currentPosition: 7,
    },
  });
  await prisma.alert.create({
    data: {
      agencyId: s.agency.id,
      projectId: project.id,
      type: "RANK_DROP",
      severity: "WARNING",
      title: `Alert ${tag}`,
      body: "Body",
      dedupeKey: `k-${tag}-${Math.random()}`,
    },
  });
  return { client, project };
}

describe("api keys", () => {
  it("are shown once, stored hashed, and listed without the secret", async () => {
    const s = await setup();
    const made = await createApiKey(s.owner, { name: "Sheet", scopes: ["read:clients"] });
    const row = await prisma.apiKey.findUniqueOrThrow({ where: { id: made.id } });
    expect(row.keyHash).not.toContain(made.key);
    expect(JSON.stringify(row)).not.toContain(made.key);
    expect(made.key.startsWith(row.prefix)).toBe(true);
    const list = await listApiKeys(s.owner);
    expect(JSON.stringify(list)).not.toContain(made.key);
    expect(list[0]).not.toHaveProperty("keyHash");
  });

  it("need owner or admin rights and valid input", async () => {
    const s = await setup();
    await expect(
      createApiKey(s.member, { name: "Nope", scopes: ["read:clients"] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listApiKeys(s.member)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createApiKey(s.admin, { name: "A", scopes: [] })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      createApiKey(s.admin, { name: "Okay", scopes: ["write:x"] }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("stop working when revoked, and only the owning agency can revoke", async () => {
    const a = await setup();
    const b = await setup();
    const made = await createApiKey(a.owner, { name: "Tool", scopes: ["read:clients"] });
    expect(await authenticateApiKey(made.key)).toMatchObject({ agencyId: a.agency.id });
    await expect(revokeApiKey(b.owner, made.id)).rejects.toBeInstanceOf(NotFoundError);
    await revokeApiKey(a.owner, made.id);
    expect(await authenticateApiKey(made.key)).toBeNull();
    expect(await authenticateApiKey("aidm_does-not-exist-1234")).toBeNull();
  });

  it("stop working for suspended and read-only agencies", async () => {
    const s = await setup();
    const made = await createApiKey(s.owner, { name: "Tool", scopes: ["read:clients"] });
    await prisma.agency.update({ where: { id: s.agency.id }, data: { status: "SUSPENDED" } });
    expect(await authenticateApiKey(made.key)).toBeNull();
    await prisma.agency.update({ where: { id: s.agency.id }, data: { status: "ACTIVE" } });
    await prisma.subscription.updateMany({
      where: { agencyId: s.agency.id },
      data: { status: "EXPIRED" },
    });
    expect(await authenticateApiKey(made.key)).toBeNull();
  });

  it("are limited to 20 active keys", async () => {
    const s = await setup();
    for (let i = 0; i < 20; i++)
      await createApiKey(s.owner, { name: `Key ${i}`, scopes: ["read:alerts"] });
    await expect(
      createApiKey(s.owner, { name: "One more", scopes: ["read:alerts"] }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("public API v1", () => {
  it("answers 401 without a valid key and 403 without the scope", async () => {
    const s = await setup();
    expect((await getClients(req("/api/v1/clients"))).status).toBe(401);
    expect((await getClients(req("/api/v1/clients", "aidm_wrong-wrong-wrong"))).status).toBe(401);
    const { key } = await createApiKey(s.owner, { name: "Narrow", scopes: ["read:alerts"] });
    const res = await getClients(req("/api/v1/clients", key));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("forbidden");
    expect((await getAlerts(req("/api/v1/alerts", key))).status).toBe(200);
  });

  it("returns only the key's own agency, with fixed fields", async () => {
    const a = await setup();
    const b = await setup();
    const da = await seedData(a, "alpha");
    const db_ = await seedData(b, "bravo");
    const { key } = await createApiKey(a.owner, {
      name: "All",
      scopes: ["read:clients", "read:projects", "read:rankings", "read:alerts"],
    });
    const clients = await (await getClients(req("/api/v1/clients", key))).json();
    expect(clients.total).toBe(1);
    expect(clients.data[0]).toMatchObject({ id: da.client.id, name: "Client alpha" });
    expect(clients.data[0]).not.toHaveProperty("agencyId");
    expect(clients.data[0]).not.toHaveProperty("notes");

    const projects = await (await getProjects(req("/api/v1/projects", key))).json();
    expect(projects.data.map((p: { id: string }) => p.id)).toEqual([da.project.id]);
    const filtered = await (await getProjects(req("/api/v1/projects?client_id=nope", key))).json();
    expect(filtered.total).toBe(0);

    const ranks = await (
      await getRankings(req(`/api/v1/projects/${da.project.id}/rankings`, key), {
        params: Promise.resolve({ projectId: da.project.id }),
      })
    ).json();
    expect(ranks.data[0]).toMatchObject({ phrase: "kw alpha", currentPosition: 7 });
    const other = await getRankings(req(`/api/v1/projects/${db_.project.id}/rankings`, key), {
      params: Promise.resolve({ projectId: db_.project.id }),
    });
    expect(other.status).toBe(404);

    const alerts = await (await getAlerts(req("/api/v1/alerts?unread=1", key))).json();
    expect(alerts.data.map((x: { title: string }) => x.title)).toEqual(["Alert alpha"]);
  });

  it("pages lists and caps the page size", async () => {
    const s = await setup();
    for (const n of ["a", "b", "c"]) await seedData(s, n);
    const { key } = await createApiKey(s.owner, { name: "Pager", scopes: ["read:clients"] });
    const first = await (await getClients(req("/api/v1/clients?per_page=2", key))).json();
    const second = await (await getClients(req("/api/v1/clients?per_page=2&page=2", key))).json();
    expect(first.data).toHaveLength(2);
    expect(second.data).toHaveLength(1);
    expect(first.total).toBe(3);
    const big = await (await getClients(req("/api/v1/clients?per_page=5000", key))).json();
    expect(big.perPage).toBe(100);
  });
});

describe("webhook settings", () => {
  it("need owner or admin rights, safe addresses and a limit", async () => {
    const s = await setup();
    await expect(
      createWebhook(s.member, { url: "https://example.com/h", format: "JSON" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    for (const url of [
      "http://example.com/h",
      "https://10.0.0.5/h",
      "https://printer.local/h",
      "nope",
    ])
      await expect(createWebhook(s.owner, { url, format: "JSON" })).rejects.toBeInstanceOf(
        ValidationError,
      );
    for (let i = 0; i < 5; i++)
      await createWebhook(s.owner, { url: `https://example.com/h${i}`, format: "JSON" });
    await expect(
      createWebhook(s.owner, { url: "https://example.com/x", format: "SLACK" }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await listWebhooks(s.admin)).toHaveLength(5);
  });

  it("can be turned off, on and deleted only by the owning agency", async () => {
    const a = await setup();
    const b = await setup();
    const { id } = await createWebhook(a.owner, { url: "https://example.com/h", format: "JSON" });
    await expect(setWebhookEnabled(b.owner, id, false)).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteWebhook(b.owner, id)).rejects.toBeInstanceOf(NotFoundError);
    await setWebhookEnabled(a.owner, id, false);
    expect((await prisma.webhook.findUniqueOrThrow({ where: { id } })).enabled).toBe(false);
    await setWebhookEnabled(a.owner, id, true);
    await deleteWebhook(a.owner, id);
    expect(await prisma.webhook.count({ where: { id } })).toBe(0);
  });
});

describe("webhook deliveries", () => {
  const NOW = new Date("2026-03-10T12:00:00Z");
  type Call = { url: string; headers: Record<string, string>; body: string };

  function deps(send: (c: Call) => SendResult, allowed = true) {
    const calls: Call[] = [];
    return {
      calls,
      d: {
        db: prisma,
        now: NOW,
        send: async (url: string, headers: Record<string, string>, body: string) => {
          const c = { url, headers, body };
          calls.push(c);
          return send(c);
        },
        addressAllowed: async () => allowed,
      },
    };
  }

  async function hookWithAlerts(s: S, format = "JSON", count = 3) {
    const hook = await prisma.webhook.create({
      data: {
        agencyId: s.agency.id,
        url: `https://example.com/hook-${Math.random().toString(36).slice(2)}`,
        format,
        secret: "topsecret",
        cursorAt: new Date("2026-03-09T00:00:00Z"),
      },
    });
    for (let i = 0; i < count; i++)
      await prisma.alert.create({
        data: {
          agencyId: s.agency.id,
          type: "RANK_DROP",
          severity: "WARNING",
          title: `Drop ${i}`,
          body: "x",
          dedupeKey: `w-${hook.id}-${i}`,
          createdAt: new Date(`2026-03-10T0${i + 1}:00:00Z`),
        },
      });
    return hook;
  }

  it("sends new alerts in order, signed, and does not repeat them", async () => {
    const s = await setup();
    const hook = await hookWithAlerts(s);
    const { calls, d } = deps(() => ({ status: 200 }));
    const out = await runWebhookDeliveries(d);
    expect(out.sent).toBeGreaterThanOrEqual(3);
    const mine = calls.filter((c) => c.url === hook.url);
    expect(mine.map((c) => JSON.parse(c.body).alert.title).slice(0, 3)).toEqual([
      "Drop 0",
      "Drop 1",
      "Drop 2",
    ]);
    expect(mine[0]!.headers["X-Signature"]).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(mine[0]!.headers["X-Event"]).toBe("alert.created");
    expect(JSON.parse(mine[0]!.body).agencyId).toBe(s.agency.id);
    calls.length = 0;
    await runWebhookDeliveries(d);
    expect(calls.filter((c) => c.url === hook.url)).toHaveLength(0);
    const row = await prisma.webhook.findUniqueOrThrow({ where: { id: hook.id } });
    expect(row.cursorAt.toISOString()).toBe("2026-03-10T03:00:00.000Z");
    expect(
      await prisma.webhookDelivery.count({ where: { webhookId: hook.id, status: "SUCCESS" } }),
    ).toBe(3);
  });

  it("never sends another agency's alerts", async () => {
    const a = await setup();
    const b = await setup();
    const hook = await hookWithAlerts(a, "JSON", 1);
    await hookWithAlerts(b, "JSON", 2);
    const { calls, d } = deps(() => ({ status: 200 }));
    await runWebhookDeliveries(d);
    const mine = calls.filter((c) => JSON.parse(c.body).agencyId === a.agency.id);
    expect(mine).toHaveLength(1);
    expect(
      calls.every((c) => [a.agency.id, b.agency.id].includes(JSON.parse(c.body).agencyId)),
    ).toBe(true);
    expect(hook.agencyId).toBe(a.agency.id);
  });

  it("stops on a server error and tries again later without losing messages", async () => {
    const s = await setup();
    const hook = await hookWithAlerts(s);
    let fail = true;
    const { d } = deps(() => (fail ? { status: 503 } : { status: 200 }));
    await runWebhookDeliveries(d);
    let row = await prisma.webhook.findUniqueOrThrow({ where: { id: hook.id } });
    expect(row.cursorAt.toISOString()).toBe("2026-03-09T00:00:00.000Z");
    expect(row.failureStreak).toBe(1);
    expect(row.lastError).toContain("503");
    fail = false;
    const { calls, d: d2 } = deps(() => ({ status: 200 }));
    await runWebhookDeliveries(d2);
    expect(calls.filter((c) => c.url === hook.url)).toHaveLength(3);
    row = await prisma.webhook.findUniqueOrThrow({ where: { id: hook.id } });
    expect(row.failureStreak).toBe(0);
    expect(row.lastError).toBeNull();
  });

  it("skips a message the receiver refuses and keeps going", async () => {
    const s = await setup();
    const hook = await hookWithAlerts(s);
    const { d } = deps((c) => (c.body.includes("Drop 1") ? { status: 400 } : { status: 200 }));
    await runWebhookDeliveries(d);
    const rows = await prisma.webhookDelivery.findMany({
      where: { webhookId: hook.id },
      orderBy: { createdAt: "asc" },
    });
    expect(rows.map((r) => r.status)).toEqual(["SUCCESS", "REJECTED", "SUCCESS"]);
    expect(
      (await prisma.webhook.findUniqueOrThrow({ where: { id: hook.id } })).cursorAt.toISOString(),
    ).toBe("2026-03-10T03:00:00.000Z");
  });

  it("switches a webhook off after too many failures in a row", async () => {
    const s = await setup();
    const hook = await hookWithAlerts(s, "JSON", 1);
    const { d } = deps(() => ({ error: "connection refused" }));
    for (let i = 0; i < 3; i++) await runWebhookDeliveries({ ...d, maxFailures: 3 });
    const row = await prisma.webhook.findUniqueOrThrow({ where: { id: hook.id } });
    expect(row.enabled).toBe(false);
    expect(row.lastError).toContain("Switched off");
  });

  it("does not send to private addresses", async () => {
    const s = await setup();
    const hook = await hookWithAlerts(s, "JSON", 1);
    const { calls, d } = deps(() => ({ status: 200 }), false);
    await runWebhookDeliveries(d);
    expect(calls.filter((c) => c.url === hook.url)).toHaveLength(0);
    expect(
      (await prisma.webhook.findUniqueOrThrow({ where: { id: hook.id } })).lastError,
    ).toContain("private");
  });

  it("posts Slack text without a signature, and sends a test message", async () => {
    const s = await setup();
    const hook = await hookWithAlerts(s, "SLACK", 1);
    const { calls, d } = deps(() => ({ status: 200 }));
    await runWebhookDeliveries(d);
    const slack = calls.find((c) => c.url === hook.url)!;
    expect(JSON.parse(slack.body).text).toContain("Drop 0");
    expect(slack.headers["X-Signature"]).toBeUndefined();
    const t = await runWebhookTest(d, { webhookId: hook.id, agencyId: s.agency.id });
    expect(t.ok).toBe(true);
    const other = await setup();
    expect((await runWebhookTest(d, { webhookId: hook.id, agencyId: other.agency.id })).ok).toBe(
      false,
    );
  });
});

describe("my notifications", () => {
  it("lets a person opt out of the digest", async () => {
    const s = await setup();
    await prisma.agency.update({ where: { id: s.agency.id }, data: { dailyDigest: true } });
    await prisma.alert.create({
      data: {
        agencyId: s.agency.id,
        type: "RANK_DROP",
        severity: "INFO",
        title: "T",
        body: "B",
        dedupeKey: "digest-1",
      },
    });
    expect((await getMyNotifications(s.owner)).emailDigest).toBe(true);
    await setMyDigest(s.admin, false);
    expect((await getMyNotifications(s.admin)).emailDigest).toBe(false);
    expect((await getMyNotifications(s.owner)).emailDigest).toBe(true);
    const sentTo: string[] = [];
    await sendDigest({
      db: prisma,
      agencyId: s.agency.id,
      date: "2026-03-10",
      now: new Date(),
      appUrl: "http://localhost",
      send: async (email) => {
        sentTo.push(email.to);
      },
    });
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: s.owner.userId } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { id: s.admin.userId } });
    expect(sentTo).toContain(owner.email);
    expect(sentTo).not.toContain(admin.email);
  });
});
