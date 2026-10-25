import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { runReviewScheduler } from "@/server/jobs/system/review-scheduler";
import type { Review, ReviewSummary } from "@/server/providers/seo/types";
import { MockSummaryProvider } from "@/server/providers/summary/mock";
import {
  runReviewRefresh,
  type ReplyWriter,
  type ReviewGateway,
} from "@/server/services/review-runner";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/server/services/errors";
import {
  getBusiness,
  getReviewOverview,
  listReviews,
  requestReviewCheck,
  saveBusiness,
  unlinkBusiness,
} from "@/server/services/reviews";
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

async function setup() {
  const { agency, members } = await createAgencyWithMembers(
    prisma,
    ["OWNER", "MEMBER"],
    undefined,
    "GROWTH",
  );
  const client = await prisma.client.create({ data: { agencyId: agency.id, name: "Client" } });
  const project = await prisma.project.create({
    data: {
      agencyId: agency.id,
      clientId: client.id,
      name: "Clinic",
      domain: "clinic.com",
      locationCode: 2840,
      languageCode: "en",
    },
  });
  return { agency, project, owner: members[0]!.ctx, member: members[1]!.ctx };
}
type S = Awaited<ReturnType<typeof setup>>;

const review = (
  author: string,
  rating: number,
  text: string,
  publishedAt = "2026-03-01",
): Review => ({
  author,
  rating,
  text,
  publishedAt,
});

function fakeGateway(get: () => ReviewSummary) {
  const calls: { businessName: string; locationCode: number }[] = [];
  const gateway = {
    calls,
    getReviews: async (_caller: unknown, input: { businessName: string; locationCode: number }) => {
      calls.push(input);
      return { data: get(), provider: "mock", cached: false };
    },
  };
  return gateway as typeof gateway & ReviewGateway;
}

const replies: ReplyWriter = new MockSummaryProvider();
const run = (s: S, gateway: ReviewGateway, date: string) =>
  runReviewRefresh(
    { db, gateway, replies },
    { projectId: s.project.id, agencyId: s.agency.id, date },
  );
const summary = (rating: number, reviewCount: number, recent: Review[]): ReviewSummary => ({
  businessName: "Bright Dental",
  rating,
  reviewCount,
  recent,
});

describe("linking a business", () => {
  it("links, changes and unlinks, and cleans up the saved reviews", async () => {
    const s = await setup();
    expect(await getBusiness(s.owner, s.project.id)).toBeNull();
    await saveBusiness(s.member, s.project.id, { name: "  Bright Dental ", city: " Austin " });
    expect(await getBusiness(s.owner, s.project.id)).toMatchObject({
      name: "Bright Dental",
      city: "Austin",
    });
    await saveBusiness(s.owner, s.project.id, { name: "Bright Dental Clinic", city: "" });
    const business = await getBusiness(s.owner, s.project.id);
    expect(business).toMatchObject({ name: "Bright Dental Clinic", city: null });
    expect(await prisma.localBusiness.count({ where: { projectId: s.project.id } })).toBe(1);

    await run(
      s,
      fakeGateway(() => summary(4.5, 10, [review("Sam", 5, "Great")])),
      "2026-03-02",
    );
    expect(await prisma.review.count({ where: { projectId: s.project.id } })).toBe(1);
    await unlinkBusiness(s.owner, s.project.id);
    expect(await getBusiness(s.owner, s.project.id)).toBeNull();
    expect(await prisma.review.count({ where: { projectId: s.project.id } })).toBe(0);
    expect(await prisma.reviewSnapshot.count({ where: { projectId: s.project.id } })).toBe(0);
    await expect(unlinkBusiness(s.owner, s.project.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("checks the name and who may change it", async () => {
    const s = await setup();
    await expect(saveBusiness(s.owner, s.project.id, { name: "A" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    const client = { ...s.owner, role: "CLIENT" as const };
    await expect(
      saveBusiness(client, s.project.id, { name: "Bright Dental" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getReviewOverview(client, s.project.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(requestReviewCheck(client, s.project.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(requestReviewCheck(s.owner, s.project.id)).rejects.toThrow(
      "Link a business first.",
    );
  });
});

describe("review check", () => {
  it("saves reviews with suggested replies and sends no alert the first time", async () => {
    const s = await setup();
    await saveBusiness(s.owner, s.project.id, { name: "Bright Dental" });
    const gateway = fakeGateway(() =>
      summary(4.3, 120, [review("Sam", 5, "Great"), review("Lee", 1, "Awful", "2026-03-02")]),
    );
    const result = await run(s, gateway, "2026-03-03");
    expect(result).toEqual({ status: "done", newReviews: 0, lowReviews: 0, alerted: false });
    expect(gateway.calls).toEqual([{ businessName: "Bright Dental", locationCode: 2840 }]);

    const rows = await prisma.review.findMany({
      where: { projectId: s.project.id },
      orderBy: { author: "asc" },
    });
    expect(rows.map((r) => r.author)).toEqual(["Lee", "Sam"]);
    expect(rows[0]?.suggestedReply).toContain("sorry");
    expect(rows[1]?.suggestedReply).toContain("thank you");
    expect(await prisma.alert.count({ where: { agencyId: s.agency.id } })).toBe(0);
    const snap = await prisma.reviewSnapshot.findFirstOrThrow({
      where: { projectId: s.project.id },
    });
    expect(snap).toMatchObject({ ratingTenths: 43, reviewCount: 120, newReviews: 0 });
    expect(
      (await prisma.localBusiness.findFirstOrThrow({ where: { projectId: s.project.id } }))
        .lastCheckedOn,
    ).toEqual(new Date("2026-03-03T00:00:00Z"));
  });

  it("does nothing new when run again for the same day", async () => {
    const s = await setup();
    await saveBusiness(s.owner, s.project.id, { name: "Bright Dental" });
    const gateway = fakeGateway(() => summary(4, 5, [review("Sam", 5, "Great")]));
    await run(s, gateway, "2026-03-03");
    expect((await run(s, gateway, "2026-03-03")).status).toBe("already-checked");
    expect(gateway.calls).toHaveLength(1);
  });

  it("finds only the new reviews later and warns about low ones", async () => {
    const s = await setup();
    await saveBusiness(s.owner, s.project.id, { name: "Bright Dental" });
    const first = [review("Sam", 5, "Great"), review("Kim", 4, "Good")];
    let current = summary(4.5, 10, first);
    const gateway = fakeGateway(() => current);
    await run(s, gateway, "2026-03-03");

    current = summary(4.3, 12, [
      review("Lee", 1, "Terrible wait", "2026-03-08"),
      review("Pat", 5, "Lovely", "2026-03-09"),
      ...first,
    ]);
    const second = await run(s, gateway, "2026-03-10");
    expect(second).toEqual({ status: "done", newReviews: 2, lowReviews: 1, alerted: true });
    expect(await prisma.review.count({ where: { projectId: s.project.id } })).toBe(4);

    const alert = await prisma.alert.findFirstOrThrow({ where: { agencyId: s.agency.id } });
    expect(alert).toMatchObject({
      type: "NEW_REVIEW",
      severity: "WARNING",
      projectId: s.project.id,
      dedupeKey: `new_review:${s.project.id}:2026-03-10`,
    });
    expect(alert.body).toContain("Lee gave 1 star");

    // A third day with nothing new: no alert.
    const third = await run(s, gateway, "2026-03-11");
    expect(third).toMatchObject({ status: "done", newReviews: 0, alerted: false });
    expect(await prisma.alert.count({ where: { agencyId: s.agency.id } })).toBe(1);

    const overview = await getReviewOverview(s.owner, s.project.id);
    expect(overview.latest).toMatchObject({ takenOn: "2026-03-11", ratingTenths: 43 });
    expect(overview.history.map((h) => [h.takenOn, h.newReviews])).toEqual([
      ["2026-03-11", 0],
      ["2026-03-10", 2],
      ["2026-03-03", 0],
    ]);
    expect(overview.change).toEqual({ ratingTenths: 0, reviewCount: 0 });
    expect(overview.stars).toEqual([1, 0, 0, 1, 2]);
    expect(overview.storedReviews).toBe(4);
  });

  it("skips deleted projects and projects without a business", async () => {
    const s = await setup();
    expect(
      (
        await run(
          s,
          fakeGateway(() => summary(4, 1, [])),
          "2026-03-03",
        )
      ).status,
    ).toBe("no-business");
    await prisma.project.update({ where: { id: s.project.id }, data: { deletedAt: new Date() } });
    expect(
      (
        await run(
          s,
          fakeGateway(() => summary(4, 1, [])),
          "2026-03-03",
        )
      ).status,
    ).toBe("inactive");
  });
});

describe("listing reviews", () => {
  it("pages the list newest first and can show only 1 and 2 star reviews", async () => {
    const s = await setup();
    await saveBusiness(s.owner, s.project.id, { name: "Bright Dental" });
    const many = Array.from({ length: 12 }, (_, i) =>
      review(
        `Person ${i}`,
        i % 4 === 0 ? 1 : 5,
        `text ${i}`,
        `2026-02-${String(i + 1).padStart(2, "0")}`,
      ),
    );
    await run(
      s,
      fakeGateway(() => summary(4, 12, many)),
      "2026-03-03",
    );

    const all = await listReviews(s.owner, s.project.id, "all", { page: 1, pageSize: 5 });
    expect(all.total).toBe(12);
    expect(all.rows.map((r) => r.author)).toEqual([
      "Person 11",
      "Person 10",
      "Person 9",
      "Person 8",
      "Person 7",
    ]);
    const low = await listReviews(s.owner, s.project.id, "low");
    expect(low.total).toBe(3);
    expect(low.rows.every((r) => r.rating <= 2)).toBe(true);
  });
});

describe("daily scheduler", () => {
  it("queues linked projects that were not checked today", async () => {
    const s = await setup();
    await saveBusiness(s.owner, s.project.id, { name: "Bright Dental" });
    const checked = await prisma.project.create({
      data: {
        agencyId: s.agency.id,
        clientId: (await prisma.client.findFirstOrThrow({ where: { agencyId: s.agency.id } })).id,
        name: "Checked",
        domain: "checked.com",
        locationCode: 2840,
        languageCode: "en",
      },
    });
    await prisma.localBusiness.create({
      data: {
        agencyId: s.agency.id,
        projectId: checked.id,
        name: "Done today",
        lastCheckedOn: new Date("2026-03-10T00:00:00Z"),
      },
    });
    const unlinked = await prisma.project.create({
      data: {
        agencyId: s.agency.id,
        clientId: checked.clientId,
        name: "No business",
        domain: "nobiz.com",
        locationCode: 2840,
        languageCode: "en",
      },
    });
    const queued: string[] = [];
    const now = new Date("2026-03-10T00:05:00Z");
    await runReviewScheduler({
      db: prisma,
      now,
      enqueue: async (j) => (queued.push(j.projectId), true),
    });
    expect(queued).toContain(s.project.id);
    expect(queued).not.toContain(checked.id);
    expect(queued).not.toContain(unlinked.id);

    const paused = await runReviewScheduler({
      db: prisma,
      now,
      enqueue: async () => true,
      paused: async () => true,
    });
    expect(paused).toMatchObject({ queued: 0, paused: true });
  });
});

describe("check requests", () => {
  it("refuses a second check on the same day", async () => {
    const s = await setup();
    await saveBusiness(s.owner, s.project.id, { name: "Bright Dental" });
    await prisma.localBusiness.updateMany({
      where: { projectId: s.project.id },
      data: { lastCheckedOn: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`) },
    });
    await expect(requestReviewCheck(s.owner, s.project.id)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("tenant isolation: reviews", () => {
  it("another agency's project is not found for every call", async () => {
    const a = await setup();
    const b = await setup();
    await saveBusiness(b.owner, b.project.id, { name: "Bright Dental" });
    await run(
      b,
      fakeGateway(() => summary(4, 1, [review("Sam", 5, "Great")])),
      "2026-03-03",
    );
    await expect(getBusiness(a.owner, b.project.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(saveBusiness(a.owner, b.project.id, { name: "Hacked Co" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(unlinkBusiness(a.owner, b.project.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getReviewOverview(a.owner, b.project.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listReviews(a.owner, b.project.id, "all")).rejects.toBeInstanceOf(NotFoundError);
    await expect(requestReviewCheck(a.owner, b.project.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await prisma.review.count({ where: { projectId: b.project.id } })).toBe(1);
    expect((await getBusiness(b.owner, b.project.id))?.name).toBe("Bright Dental");
  });
});
