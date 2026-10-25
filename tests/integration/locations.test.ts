import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { MockSeoProvider } from "@/server/providers/seo/mock";
import {
  ConflictError,
  ForbiddenError,
  LimitExceededError,
  NotFoundError,
  ValidationError,
} from "@/server/services/errors";
import { runListingChecks, runLocalRanks, type LocalGateway } from "@/server/services/local-runner";
import {
  createLocation,
  deleteLocation,
  getLocalOverview,
  requestListingCheck,
  requestLocalRanks,
  updateLocation,
} from "@/server/services/locations";
import { pseudoLocationCode } from "@/lib/local";
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

async function setup(name?: string) {
  const { agency, members } = await createAgencyWithMembers(
    prisma,
    ["OWNER", "MEMBER"],
    name,
    "GROWTH",
  );
  const client = await prisma.client.create({ data: { agencyId: agency.id, name: "Acme Dental" } });
  const project = await prisma.project.create({
    data: {
      agencyId: agency.id,
      clientId: client.id,
      name: "Site",
      domain: "acmedental.com",
      locationCode: 2840,
      languageCode: "en",
    },
  });
  return { agency, project, owner: members[0]!.ctx, member: members[1]!.ctx };
}
type S = Awaited<ReturnType<typeof setup>>;

const place = (name: string, city = "Austin") => ({
  name,
  city,
  address: `12 North Main Street, ${city}`,
  phone: "(512) 555-0134",
});

function gatewayOf(): LocalGateway {
  const mock = new MockSeoProvider();
  const wrap = <T>(data: T) => ({ data, provider: "mock", cached: false, costMicros: 0 });
  return {
    getRankings: async (_c, i) =>
      wrap((await mock.getRankings({ ...i, priority: "standard" })).data),
    getListings: async (_c, i) => wrap((await mock.getListings(i)).data),
  };
}
const codeFor = (l: { city: string; locationCode: number | null }, project: number) =>
  l.locationCode ?? pseudoLocationCode(l.city) + project * 0;
const run = { date: "2026-03-10" };

describe("locations", () => {
  it("adds, changes and deletes with plain messages and the right permissions", async () => {
    const s = await setup();
    const { id } = await createLocation(s.member, s.project.id, place("Downtown"));
    await expect(createLocation(s.member, s.project.id, place("Downtown"))).rejects.toThrow(
      ConflictError,
    );
    await expect(
      createLocation(s.member, s.project.id, { ...place("Bad"), phone: "call us" }),
    ).rejects.toThrow(ValidationError);
    await expect(createLocation(s.member, s.project.id, { ...place("x") })).rejects.toThrow(
      ValidationError,
    );
    await expect(
      createLocation({ ...s.owner, role: "CLIENT" }, s.project.id, place("Nope")),
    ).rejects.toThrow(ForbiddenError);

    await updateLocation(s.member, s.project.id, id, {
      ...place("Downtown"),
      phone: "512-555-9999",
    });
    expect((await prisma.location.findUniqueOrThrow({ where: { id } })).phone).toBe("512-555-9999");
    await createLocation(s.member, s.project.id, place("Airport"));
    await expect(updateLocation(s.member, s.project.id, id, place("Airport"))).rejects.toThrow(
      ConflictError,
    );

    await expect(deleteLocation(s.member, s.project.id, id)).rejects.toThrow(ForbiddenError);
    await deleteLocation(s.owner, s.project.id, id);
    expect(await prisma.location.count({ where: { projectId: s.project.id } })).toBe(1);
  });

  it("allows up to 10 locations", async () => {
    const s = await setup();
    for (let i = 0; i < 10; i++) await createLocation(s.owner, s.project.id, place(`Place ${i}`));
    await expect(createLocation(s.owner, s.project.id, place("One too many"))).rejects.toThrow(
      LimitExceededError,
    );
  });

  it("stays inside the agency", async () => {
    const a = await setup();
    const b = await setup("Other Agency");
    const { id } = await createLocation(a.owner, a.project.id, place("Downtown"));
    await expect(createLocation(b.owner, a.project.id, place("X place"))).rejects.toThrow(
      NotFoundError,
    );
    await expect(updateLocation(b.owner, b.project.id, id, place("Hijack"))).rejects.toThrow(
      NotFoundError,
    );
    await expect(deleteLocation(b.owner, b.project.id, id)).rejects.toThrow(NotFoundError);
    await expect(getLocalOverview(b.owner, a.project.id)).rejects.toThrow(NotFoundError);
    expect(await prisma.location.count({ where: { id } })).toBe(1);
  });
});

describe("local positions", () => {
  async function withKeywords(s: S) {
    await createLocation(s.owner, s.project.id, place("Downtown", "Austin"));
    await createLocation(s.owner, s.project.id, place("Airport", "Dallas"));
    for (const [phrase, tags] of [
      ["dentist near me", ["local"]],
      ["teeth whitening", ["local"]],
      ["dental history", []],
    ] as const) {
      await prisma.keyword.create({
        data: { agencyId: s.agency.id, projectId: s.project.id, phrase, tags: [...tags] },
      });
    }
  }

  it("checks tagged keywords from each location, once a day, and shows them side by side", async () => {
    const s = await setup();
    await withKeywords(s);
    const deps = { db, gateway: gatewayOf(), codeFor };
    const first = await runLocalRanks(deps, {
      agencyId: s.agency.id,
      projectId: s.project.id,
      ...run,
    });
    expect(first).toMatchObject({ status: "done", locations: 2, saved: 4 });
    const again = await runLocalRanks(deps, {
      agencyId: s.agency.id,
      projectId: s.project.id,
      ...run,
    });
    expect(again).toMatchObject({ status: "done", saved: 0 });
    expect(await prisma.localRank.count({ where: { projectId: s.project.id } })).toBe(4);

    await runLocalRanks(deps, {
      agencyId: s.agency.id,
      projectId: s.project.id,
      date: "2026-03-11",
    });
    const overview = await getLocalOverview(s.owner, s.project.id);
    expect(overview.ranks.on).toBe("2026-03-11");
    expect(overview.ranks.sample).toBe(true);
    expect(overview.ranks.rows.map((r) => r.phrase)).toEqual([
      "dentist near me",
      "teeth whitening",
    ]);
    const row = overview.ranks.rows[0]!;
    expect(Object.keys(row.byLocation)).toHaveLength(2);
    for (const cell of Object.values(row.byLocation)) {
      expect(cell.position === null || cell.position >= 1).toBe(true);
    }
  });

  it("uses the first keywords when none are tagged, and says when there is nothing to do", async () => {
    const s = await setup();
    const empty = await runLocalRanks(
      { db, gateway: gatewayOf(), codeFor },
      { agencyId: s.agency.id, projectId: s.project.id, ...run },
    );
    expect(empty.status).toBe("no-locations");
    await createLocation(s.owner, s.project.id, place("Downtown"));
    expect(
      (
        await runLocalRanks(
          { db, gateway: gatewayOf(), codeFor },
          { agencyId: s.agency.id, projectId: s.project.id, ...run },
        )
      ).status,
    ).toBe("no-keywords");
    await prisma.keyword.create({
      data: { agencyId: s.agency.id, projectId: s.project.id, phrase: "untagged one" },
    });
    expect(
      await runLocalRanks(
        { db, gateway: gatewayOf(), codeFor },
        { agencyId: s.agency.id, projectId: s.project.id, ...run },
      ),
    ).toMatchObject({ status: "done", saved: 1 });
    const other = await setup("Other Agency");
    expect(
      (
        await runLocalRanks(
          { db, gateway: gatewayOf(), codeFor },
          { agencyId: other.agency.id, projectId: s.project.id, ...run },
        )
      ).status,
    ).toBe("inactive");
  });

  it("is requested only by people who may run tools, with locations and keywords", async () => {
    const s = await setup();
    await expect(requestLocalRanks(s.owner, s.project.id)).rejects.toThrow(ValidationError);
    await createLocation(s.owner, s.project.id, place("Downtown"));
    await expect(requestLocalRanks(s.owner, s.project.id)).rejects.toThrow(ValidationError);
    await prisma.keyword.create({
      data: { agencyId: s.agency.id, projectId: s.project.id, phrase: "k" },
    });
    expect((await requestLocalRanks(s.owner, s.project.id)).queued).toBeTypeOf("boolean");
    await expect(requestLocalRanks({ ...s.owner, role: "CLIENT" }, s.project.id)).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe("listing consistency", () => {
  it("compares each directory with the right details and scores the result", async () => {
    const s = await setup();
    const { id } = await createLocation(s.owner, s.project.id, place("Downtown"));
    const result = await runListingChecks(
      { db, gateway: gatewayOf() },
      { agencyId: s.agency.id, projectId: s.project.id, ...run },
    );
    expect(result).toMatchObject({ status: "done", locations: 1, saved: 5 });
    // A second check replaces the first.
    await runListingChecks(
      { db, gateway: gatewayOf() },
      { agencyId: s.agency.id, projectId: s.project.id, ...run },
    );
    expect(await prisma.listingCheck.count({ where: { locationId: id } })).toBe(5);

    const [view] = (await getLocalOverview(s.owner, s.project.id)).locations;
    expect(view!.listings.length).toBe(5);
    expect(view!.listingsCheckedOn).toBe("2026-03-10");
    for (const l of view!.listings) {
      expect(["match", "differs", "missing"]).toContain(l.comparison.status);
    }
    const found = view!.listings.filter((l) => l.comparison.status !== "missing");
    const matches = found.filter((l) => l.comparison.status === "match").length;
    expect(view!.score).toBe(
      found.length === 0 ? null : Math.round((matches / found.length) * 100),
    );
  });

  it("marks wrong details exactly, and forgets old results when the details change", async () => {
    const s = await setup();
    const { id } = await createLocation(s.owner, s.project.id, place("Downtown"));
    await prisma.listingCheck.createMany({
      data: [
        {
          agencyId: s.agency.id,
          projectId: s.project.id,
          locationId: id,
          source: "Yelp",
          found: true,
          name: "Downtown",
          address: "12 N. Main St., Austin",
          phone: "512-555-0134",
          checkedOn: new Date("2026-03-10"),
          provider: "mock",
        },
        {
          agencyId: s.agency.id,
          projectId: s.project.id,
          locationId: id,
          source: "Facebook",
          found: true,
          name: "Downtown Clinic",
          address: "12 N. Main St., Austin",
          phone: "512-555-9999",
          checkedOn: new Date("2026-03-10"),
          provider: "mock",
        },
        {
          agencyId: s.agency.id,
          projectId: s.project.id,
          locationId: id,
          source: "Bing Places",
          found: false,
          checkedOn: new Date("2026-03-10"),
          provider: "mock",
        },
      ],
    });
    const [view] = (await getLocalOverview(s.owner, s.project.id)).locations;
    const bySource = Object.fromEntries(view!.listings.map((l) => [l.source, l.comparison]));
    expect(bySource["Yelp"]).toEqual({ status: "match", wrong: [] });
    expect(bySource["Facebook"]).toEqual({ status: "differs", wrong: ["name", "phone"] });
    expect(bySource["Bing Places"]).toEqual({ status: "missing", wrong: [] });
    expect(view!.score).toBe(50);

    await updateLocation(s.owner, s.project.id, id, {
      ...place("Downtown"),
      phone: "512-555-1111",
    });
    expect((await getLocalOverview(s.owner, s.project.id)).locations[0]!.listings).toEqual([]);
  });

  it("is requested only with a location, and only by people who may run tools", async () => {
    const s = await setup();
    await expect(requestListingCheck(s.owner, s.project.id)).rejects.toThrow(ValidationError);
    await createLocation(s.owner, s.project.id, place("Downtown"));
    expect((await requestListingCheck(s.owner, s.project.id)).queued).toBeTypeOf("boolean");
    await expect(requestListingCheck({ ...s.owner, role: "CLIENT" }, s.project.id)).rejects.toThrow(
      ForbiddenError,
    );
  });
});
