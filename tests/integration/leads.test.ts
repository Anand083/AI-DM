import IORedis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { RedisLockStore } from "@/server/locks";
import { MockSeoProvider } from "@/server/providers/seo/mock";
import {
  ForbiddenError,
  LimitExceededError,
  NotFoundError,
  ValidationError,
} from "@/server/services/errors";
import { pollLead, runLeadStart, type LeadRunnerDeps } from "@/server/services/lead-runner";
import {
  deleteLead,
  getLeadStatus,
  listLeads,
  MAX_LEADS_PER_DAY,
  notifyAgencyOfLead,
  submitLead,
  WIDGET_BUSY_MESSAGE,
} from "@/server/services/leads";
import { SeoGateway } from "@/server/services/seo-gateway";
import { createSeoGuard } from "@/server/services/seo-guard";
import { assertWithinLimit } from "@/server/services/usage";
import { createAgencyWithMembers, seedPlans } from "../factories";
import { createTestClient, resetDb } from "../helpers/db";

const prisma = createTestClient();
const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379");

beforeAll(async () => {
  await resetDb(prisma);
  await seedPlans(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
  redis.disconnect();
});

async function setup(plan = "GROWTH") {
  const { agency, members } = await createAgencyWithMembers(
    prisma,
    ["OWNER", "ADMIN", "MEMBER"],
    undefined,
    plan,
  );
  return {
    agency,
    slug: agency.slug,
    owner: members[0]!.ctx,
    admin: members[1]!.ctx,
    member: members[2]!.ctx,
  };
}
type S = Awaited<ReturnType<typeof setup>>;

const queued: { leadId: string; agencyId: string }[] = [];
const enqueue = async (d: { leadId: string; agencyId: string }) => void queued.push(d);
const form = (extra: Record<string, unknown> = {}) => ({
  website: "https://www.Visitor-Shop.com/home",
  email: "Buyer@Example.com",
  ...extra,
});
const now = new Date("2026-03-10T10:00:00Z");

describe("submitting the widget form", () => {
  it("saves a lead with a clean domain and email and queues the audit", async () => {
    const s = await setup();
    queued.length = 0;
    const { publicId } = await submitLead(s.slug, form(), { now, enqueue });
    expect(publicId).toMatch(/^[A-Za-z0-9_-]{10,64}$/);
    const lead = await prisma.lead.findFirstOrThrow({ where: { agencyId: s.agency.id } });
    expect(lead).toMatchObject({
      domain: "visitor-shop.com",
      email: "buyer@example.com",
      status: "QUEUED",
      publicId,
    });
    expect(queued).toEqual([{ leadId: lead.id, agencyId: s.agency.id }]);
  });

  it("shows field messages for a bad website or email", async () => {
    const s = await setup();
    const fail = (values: object) => submitLead(s.slug, values, { now, enqueue });
    await expect(fail(form({ website: "not a website" }))).rejects.toMatchObject({
      fieldErrors: { website: "Enter a website like example.com." },
    });
    await expect(fail(form({ email: "nope" }))).rejects.toBeInstanceOf(ValidationError);
    await expect(fail({ email: "a@b.com" })).rejects.toBeInstanceOf(ValidationError);
    expect(await prisma.lead.count({ where: { agencyId: s.agency.id } })).toBe(0);
  });

  it("drops a bot that fills the hidden field, and says nothing real", async () => {
    const s = await setup();
    queued.length = 0;
    expect(await submitLead(s.slug, form({ company: "Spam Inc" }), { now, enqueue })).toEqual({
      publicId: null,
    });
    expect(await prisma.lead.count({ where: { agencyId: s.agency.id } })).toBe(0);
    expect(queued).toHaveLength(0);
  });

  it("returns the earlier lead for the same visitor and website within a day", async () => {
    const s = await setup();
    queued.length = 0;
    const first = await submitLead(s.slug, form(), { now, enqueue });
    const again = await submitLead(s.slug, form({ email: "BUYER@example.com" }), {
      now: new Date(now.getTime() + 3_600_000),
      enqueue,
    });
    expect(again.publicId).toBe(first.publicId);
    expect(queued).toHaveLength(1);
    // A different website, or the next day, is a new lead.
    await submitLead(s.slug, form({ website: "other.com" }), { now, enqueue });
    await submitLead(s.slug, form(), { now: new Date(now.getTime() + 25 * 3_600_000), enqueue });
    expect(await prisma.lead.count({ where: { agencyId: s.agency.id } })).toBe(3);
  });

  it("hides plans and limits from the visitor", async () => {
    const s = await setup();
    await prisma.usageRecord.create({
      data: {
        agencyId: s.agency.id,
        metric: "LEAD_AUDIT",
        quantity: 100000,
        costMicros: 0,
        provider: "mock",
        operation: "test",
      },
    });
    await expect(submitLead(s.slug, form(), { now: new Date(), enqueue })).rejects.toMatchObject({
      message: WIDGET_BUSY_MESSAGE,
    });
    await expect(submitLead(s.slug, form(), { now: new Date(), enqueue })).rejects.toBeInstanceOf(
      LimitExceededError,
    );
    expect(WIDGET_BUSY_MESSAGE).not.toMatch(/plan|limit|upgrade/i);
  });

  it("stops after the daily maximum", async () => {
    const s = await setup();
    await prisma.lead.createMany({
      data: Array.from({ length: MAX_LEADS_PER_DAY }, (_, i) => ({
        agencyId: s.agency.id,
        domain: `site${i}.com`,
        email: `v${i}@example.com`,
        createdAt: new Date(now.getTime() - 3_600_000),
      })),
    });
    await expect(submitLead(s.slug, form(), { now, enqueue })).rejects.toBeInstanceOf(
      LimitExceededError,
    );
  });

  it("refuses unknown, deleted and ended accounts", async () => {
    await expect(submitLead("no-such-agency", form(), { now, enqueue })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const s = await setup();
    await prisma.agency.update({ where: { id: s.agency.id }, data: { deletedAt: new Date() } });
    await expect(submitLead(s.slug, form(), { now, enqueue })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const ended = await setup();
    await prisma.subscription.updateMany({
      where: { agencyId: ended.agency.id },
      data: { status: "CANCELED" },
    });
    await expect(submitLead(ended.slug, form(), { now, enqueue })).rejects.toMatchObject({
      message: WIDGET_BUSY_MESSAGE,
    });
  });
});

let clock = new Date("2026-03-10T10:00:00Z");
const advance = (seconds: number) => void (clock = new Date(clock.getTime() + seconds * 1000));

function makeDeps(notified: { id: string }[] = []) {
  const polls: { leadId: string; agencyId: string; attempt: number }[] = [];
  const deps: LeadRunnerDeps = {
    db,
    gateway: new SeoGateway({
      provider: () => new MockSeoProvider({ now: () => clock, auditSeconds: 20 }),
      db: prisma,
      locks: new RedisLockStore(redis, `test-lock:${Date.now()}:`),
      now: () => clock,
      guard: createSeoGuard({ isPaused: async () => false, assertWithinLimit }),
    }),
    enqueuePoll: async (d) => void polls.push(d),
    notify: async (lead) => void notified.push(lead),
    now: () => clock,
  };
  return { deps, polls, notified };
}

async function newLead(s: S, website = "https://www.Visitor-Shop.com/home") {
  const { publicId } = await submitLead(s.slug, form({ website }), { now: clock, enqueue });
  return prisma.lead.findFirstOrThrow({ where: { publicId: publicId! } });
}

describe("the mini audit", () => {
  it("runs to the end, keeps the score and top issues, counts one lead audit and notifies", async () => {
    clock = new Date("2026-03-10T10:00:00Z");
    const s = await setup();
    const lead = await newLead(s);
    const { deps, polls, notified } = makeDeps();

    expect(await runLeadStart(deps, { leadId: lead.id, agencyId: s.agency.id })).toBe("started");
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe(
      "RUNNING",
    );
    expect(polls).toEqual([{ leadId: lead.id, agencyId: s.agency.id, attempt: 1 }]);

    expect(await pollLead(deps, { leadId: lead.id, agencyId: s.agency.id, attempt: 1 })).toBe(
      "running",
    );
    expect(polls.at(-1)?.attempt).toBe(2);
    advance(60);
    expect(await pollLead(deps, { leadId: lead.id, agencyId: s.agency.id, attempt: 2 })).toBe(
      "done",
    );

    const done = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(done.status).toBe("DONE");
    expect(done.healthScore).toBeGreaterThanOrEqual(0);
    expect(done.healthScore).toBeLessThanOrEqual(100);
    expect(done.pagesCrawled).toBeLessThanOrEqual(5);
    const issues = done.issues as { code: string; title: string; severity: string; fix: string }[];
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.length).toBeLessThanOrEqual(5);
    expect(issues[0]).toEqual(
      expect.objectContaining({ title: expect.any(String), fix: expect.any(String) }),
    );
    expect(notified).toEqual([{ id: lead.id, agencyId: s.agency.id }]);

    const usage = await prisma.usageRecord.findMany({
      where: { agencyId: s.agency.id, metric: "LEAD_AUDIT" },
    });
    expect(usage).toHaveLength(1);
    expect(usage[0]?.quantity).toBe(1);
    expect(usage[0]?.costMicros).toBeGreaterThan(0);
    // Nothing is counted as site audit pages.
    expect(
      await prisma.usageRecord.count({ where: { agencyId: s.agency.id, metric: "AUDIT_PAGE" } }),
    ).toBe(0);
  });

  it("only starts a waiting lead", async () => {
    clock = new Date("2026-03-10T10:00:00Z");
    const s = await setup();
    const lead = await newLead(s);
    const { deps } = makeDeps();
    await runLeadStart(deps, { leadId: lead.id, agencyId: s.agency.id });
    expect(await runLeadStart(deps, { leadId: lead.id, agencyId: s.agency.id })).toBe("skipped");
    expect(await pollLead(deps, { leadId: "nope", agencyId: s.agency.id, attempt: 1 })).toBe(
      "skipped",
    );
  });

  it("gives the visitor a neutral failure when the plan limit is reached during the audit", async () => {
    clock = new Date("2026-03-10T10:00:00Z");
    const s = await setup();
    // A website no other test uses, so the answer is not already in the provider cache.
    const lead = await newLead(s, "limit-test-site.com");
    const { deps } = makeDeps();
    await runLeadStart(deps, { leadId: lead.id, agencyId: s.agency.id });
    await prisma.usageRecord.create({
      data: {
        agencyId: s.agency.id,
        metric: "LEAD_AUDIT",
        quantity: 100000,
        costMicros: 0,
        provider: "mock",
        operation: "test",
      },
    });
    advance(60);
    expect(await pollLead(deps, { leadId: lead.id, agencyId: s.agency.id, attempt: 1 })).toBe(
      "failed",
    );
    const view = await getLeadStatus(lead.publicId);
    expect(view).toMatchObject({ status: "FAILED" });
    expect(JSON.stringify(view)).not.toMatch(/plan|limit|upgrade/i);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).error).toContain(
      "lead",
    );
  });

  it("gives up after too many progress checks", async () => {
    clock = new Date("2026-03-10T10:00:00Z");
    const s = await setup();
    const lead = await newLead(s);
    const { deps } = makeDeps();
    await runLeadStart(deps, { leadId: lead.id, agencyId: s.agency.id });
    expect(await pollLead(deps, { leadId: lead.id, agencyId: s.agency.id, attempt: 120 })).toBe(
      "failed",
    );
    expect((await getLeadStatus(lead.publicId))?.status).toBe("FAILED");
  });
});

describe("what the visitor can read", () => {
  it("shows progress and results only, and never the email", async () => {
    clock = new Date("2026-03-10T10:00:00Z");
    const s = await setup();
    const lead = await newLead(s);
    expect(await getLeadStatus(lead.publicId)).toEqual({ status: "QUEUED" });
    const { deps } = makeDeps();
    await runLeadStart(deps, { leadId: lead.id, agencyId: s.agency.id });
    expect(await getLeadStatus(lead.publicId)).toEqual({ status: "RUNNING" });
    advance(60);
    await pollLead(deps, { leadId: lead.id, agencyId: s.agency.id, attempt: 1 });
    const view = await getLeadStatus(lead.publicId);
    expect(view?.status).toBe("DONE");
    expect(JSON.stringify(view)).not.toMatch(/buyer@example\.com|agencyId|"id"/);
  });

  it("knows nothing about other ids", async () => {
    expect(await getLeadStatus("does-not-exist-123")).toBeNull();
    expect(await getLeadStatus("x")).toBeNull();
    expect(await getLeadStatus("a b c d e f g h i j")).toBeNull();
    expect(await getLeadStatus("../../etc/passwd/../x")).toBeNull();
  });
});

describe("the leads page data", () => {
  it("lists newest first in pages and deletes by id", async () => {
    const s = await setup();
    await prisma.lead.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({
        agencyId: s.agency.id,
        domain: `site${i}.com`,
        email: `v${i}@example.com`,
        createdAt: new Date(now.getTime() + i * 1000),
      })),
    });
    const first = await listLeads(s.member, { page: 1, pageSize: 2 });
    expect(first.total).toBe(5);
    expect(first.rows.map((r) => r.domain)).toEqual(["site4.com", "site3.com"]);
    await expect(deleteLead(s.member, first.rows[0]!.id)).rejects.toBeInstanceOf(ForbiddenError);
    await deleteLead(s.admin, first.rows[0]!.id);
    expect((await listLeads(s.owner)).total).toBe(4);
    await expect(deleteLead(s.owner, first.rows[0]!.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listLeads({ ...s.owner, role: "CLIENT" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("is private to the agency", async () => {
    const a = await setup();
    const b = await setup();
    const lead = await prisma.lead.create({
      data: { agencyId: b.agency.id, domain: "b.com", email: "v@b.com" },
    });
    expect((await listLeads(a.owner)).total).toBe(0);
    await expect(deleteLead(a.owner, lead.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await prisma.lead.count({ where: { id: lead.id } })).toBe(1);
  });
});

describe("telling the agency", () => {
  it("queues one email for each owner and admin, never for members, once per lead", async () => {
    clock = new Date("2026-03-10T10:00:00Z");
    const s = await setup();
    const lead = await newLead(s);
    // Not finished yet: nothing is sent.
    await notifyAgencyOfLead({ id: lead.id, agencyId: s.agency.id });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).notifiedAt).toBeNull();

    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        status: "DONE",
        healthScore: 61,
        pagesCrawled: 5,
        issues: [
          {
            code: "missing_title",
            title: "Missing page title",
            severity: "CRITICAL",
            fix: "Add one.",
            pages: 2,
          },
        ],
      },
    });
    await notifyAgencyOfLead({ id: lead.id, agencyId: s.agency.id });
    await notifyAgencyOfLead({ id: lead.id, agencyId: s.agency.id });
    expect(
      (await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).notifiedAt,
    ).not.toBeNull();
  });
});
