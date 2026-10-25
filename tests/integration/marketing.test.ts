import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { submitContactMessage } from "@/server/services/contact";
import { ValidationError } from "@/server/services/errors";
import { getOnboardingState } from "@/server/services/onboarding";
import { listPublicPlans } from "@/server/services/public-plans";
import { createAgencyWithMembers, createUser, seedPlans } from "../factories";
import { createTestClient, resetDb } from "../helpers/db";

const prisma = createTestClient();

beforeEach(async () => {
  await resetDb(prisma);
  await seedPlans(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("public plans", () => {
  it("lists only public plans, in order, with their prices", async () => {
    await prisma.plan.create({
      data: {
        code: "SECRET",
        name: "Secret",
        priceMonthlyCents: 1,
        priceYearlyCents: 1,
        limits: {},
        isPublic: false,
        sortOrder: 0,
      },
    });
    const plans = await listPublicPlans();
    expect(plans.map((p) => p.code)).toEqual(["STARTER", "GROWTH", "AGENCY"]);
    const starter = await prisma.plan.findUniqueOrThrow({ where: { code: "STARTER" } });
    expect(plans[0]).toMatchObject({
      name: starter.name,
      priceMonthlyCents: starter.priceMonthlyCents,
      priceYearlyCents: starter.priceYearlyCents,
    });
  });
});

describe("onboarding checklist", () => {
  async function setup() {
    const { agency, members } = await createAgencyWithMembers(
      prisma,
      ["OWNER", "MEMBER"],
      "Agency One",
      "STARTER",
    );
    return { agency, owner: members[0]!, member: members[1]! };
  }
  const states = async (ctx: Parameters<typeof getOnboardingState>[0]) => {
    const state = await getOnboardingState(ctx);
    return state!.items.map((i) => [i.key, i.done] as const);
  };

  it("starts empty and fills in as the agency works", async () => {
    const { agency, owner } = await setup();
    expect(await getOnboardingState(owner.ctx)).toMatchObject({
      done: 0,
      total: 6,
      complete: false,
    });
    expect((await getOnboardingState(owner.ctx))!.next?.key).toBe("client");

    const client = await prisma.client.create({ data: { agencyId: agency.id, name: "C" } });
    expect(await states(owner.ctx)).toEqual([
      ["client", true],
      ["project", false],
      ["keywords", false],
      ["audit", false],
      ["branding", false],
      ["report", false],
    ]);

    const project = await prisma.project.create({
      data: {
        agencyId: agency.id,
        clientId: client.id,
        name: "P",
        domain: "p.test",
        locationCode: 2840,
        languageCode: "en",
      },
    });
    await prisma.keyword.create({
      data: { agencyId: agency.id, projectId: project.id, phrase: "k" },
    });
    await prisma.audit.create({
      data: { agencyId: agency.id, projectId: project.id, maxPages: 10 },
    });
    await prisma.branding.create({ data: { agencyId: agency.id, displayName: "Agency One" } });
    expect((await getOnboardingState(owner.ctx))!.done).toBe(5);

    await prisma.report.create({
      data: {
        agencyId: agency.id,
        projectId: project.id,
        title: "R",
        periodStart: new Date("2026-03-01"),
        periodEnd: new Date("2026-03-31"),
        sections: ["summary"],
      },
    });
    const finished = await getOnboardingState(owner.ctx);
    expect(finished).toMatchObject({ done: 6, complete: true, next: null });
  });

  it("ignores deleted clients and other agencies, and hides from client users", async () => {
    const a = await setup();
    const b = await setup();
    await prisma.client.create({ data: { agencyId: b.agency.id, name: "Other" } });
    await prisma.client.create({
      data: { agencyId: a.agency.id, name: "Gone", deletedAt: new Date() },
    });
    expect((await getOnboardingState(a.owner.ctx))!.done).toBe(0);
    expect(await getOnboardingState({ ...a.owner.ctx, role: "CLIENT" })).toBeNull();
    // Members can add things, so they see it too.
    expect(await getOnboardingState(a.member.ctx)).not.toBeNull();
  });

  it("links use the agency address", async () => {
    const { agency, owner } = await setup();
    const slug = (await prisma.agency.findUniqueOrThrow({ where: { id: agency.id } })).slug;
    expect((await getOnboardingState(owner.ctx))!.items[0]!.href).toBe(`/app/${slug}/clients/new`);
  });
});

describe("contact form", () => {
  const valid = {
    name: "Pat",
    email: "Pat@Example.com",
    message: "I would like to know more about plans.",
  };

  it("stores a message and emails the super admins", async () => {
    const admin = await createUser(prisma);
    await prisma.user.update({ where: { id: admin.id }, data: { isSuperAdmin: true } });
    const result = await submitContactMessage(valid, { ip: "1.2.3.4" });
    expect(result).toEqual({ stored: true });
    const rows = await prisma.contactMessage.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Pat", email: "pat@example.com", ip: "1.2.3.4" });
  });

  it("explains what is wrong in plain words", async () => {
    const bad = await submitContactMessage({ name: "", email: "nope", message: "short" }).catch(
      (e: unknown) => e,
    );
    expect(bad).toBeInstanceOf(ValidationError);
    expect((bad as ValidationError).fieldErrors).toMatchObject({
      name: "Enter your name.",
      email: "Enter a valid email address.",
      message: expect.stringContaining("at least 10"),
    });
    expect(await prisma.contactMessage.count()).toBe(0);
    await expect(submitContactMessage({ ...valid, message: "x".repeat(4001) })).rejects.toThrow(
      ValidationError,
    );
  });

  it("drops messages that fill the hidden field, without telling the sender", async () => {
    expect(await submitContactMessage({ ...valid, company: "Buy cheap links" })).toEqual({
      stored: false,
    });
    expect(await prisma.contactMessage.count()).toBe(0);
    expect(await submitContactMessage({ ...valid, company: "  " })).toEqual({ stored: true });
  });

  it("keeps markup in a message from becoming markup in the email", async () => {
    const admin = await createUser(prisma);
    await prisma.user.update({ where: { id: admin.id }, data: { isSuperAdmin: true } });
    await submitContactMessage({ ...valid, message: "<script>alert(1)</script> hello there" });
    expect((await prisma.contactMessage.findFirstOrThrow()).message).toContain("<script>");
  });
});
