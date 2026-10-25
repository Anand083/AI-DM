import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getEnv } from "@/env";
import { daysInRange, syncRanges } from "@/lib/google-metrics";
import { open, seal } from "@/server/crypto/secret-box";
import { db } from "@/server/db/client";
import { runGoogleScheduler } from "@/server/jobs/system/google-scheduler";
import {
  MOCK_CODE,
  MOCK_REVOKED_REFRESH_TOKEN,
  MockGoogleProvider,
} from "@/server/providers/google/mock";
import { GoogleAuthError, GoogleTemporaryError } from "@/server/providers/google/types";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/server/services/errors";
import {
  chooseGoogleSources,
  completeGoogleConnect,
  disconnectGoogle,
  getAnalyticsOverview,
  getGoogleStatus,
  loadAnalyticsNumbers,
  requestGoogleSync,
} from "@/server/services/google";
import { runGoogleSync } from "@/server/services/google-sync";
import { createAgencyWithMembers, seedPlans } from "../factories";
import { createTestClient, resetDb } from "../helpers/db";

const prisma = createTestClient();
const secret = () => getEnv().ENCRYPTION_KEY;

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
      name: "Site",
      domain: "example.com",
      locationCode: 2840,
      languageCode: "en",
    },
  });
  return { agency, project, owner: members[0]!.ctx, member: members[1]!.ctx };
}
type S = Awaited<ReturnType<typeof setup>>;

const connect = (s: S) => completeGoogleConnect(s.owner, s.project.id, MOCK_CODE);
const choose = (s: S) =>
  chooseGoogleSources(s.owner, s.project.id, {
    gscSite: "sc-domain:example.com",
    ga4PropertyId: "123456789",
  });
const connection = (s: S) =>
  prisma.googleConnection.findFirstOrThrow({ where: { projectId: s.project.id } });

let clock = new Date("2026-03-10T10:00:00Z");
const provider = (over: Partial<MockGoogleProvider> = {}) =>
  Object.assign(new MockGoogleProvider({ now: () => clock }), over) as MockGoogleProvider;
const sync = (s: S, p: MockGoogleProvider = provider()) =>
  runGoogleSync(
    { db, provider: p, secret: secret(), now: () => clock },
    { projectId: s.project.id, agencyId: s.agency.id },
  );

describe("connecting", () => {
  it("saves the account and the lists, with the tokens encrypted", async () => {
    const s = await setup();
    await connect(s);
    const row = await connection(s);
    expect(row.accountEmail).toBe("owner@example.com");
    expect(row.status).toBe("ACTIVE");
    expect(row.accessTokenEnc).toMatch(/^v1\./);
    expect(JSON.stringify(row)).not.toMatch(/mock-access|mock-refresh/);
    expect(open(row.accessTokenEnc, secret())).toMatch(/^mock-access-/);
    expect(open(row.refreshTokenEnc!, secret())).toBe("mock-refresh");

    const status = await getGoogleStatus(s.owner, s.project.id);
    expect(status.connection).toMatchObject({ accountEmail: "owner@example.com", gscSite: null });
    expect(status.connection?.sites.map((x) => x.siteUrl)).toContain("sc-domain:example.com");
    expect(status.connection?.properties).toHaveLength(2);
    // The status never carries a token.
    expect(JSON.stringify(status)).not.toMatch(/Enc|mock-access|mock-refresh/);
  });

  it("refuses a bad code and people who may not edit", async () => {
    const s = await setup();
    await expect(completeGoogleConnect(s.owner, s.project.id, "wrong")).rejects.toBeInstanceOf(
      GoogleAuthError,
    );
    expect(await prisma.googleConnection.count({ where: { projectId: s.project.id } })).toBe(0);
    const client = { ...s.owner, role: "CLIENT" as const };
    await expect(completeGoogleConnect(client, s.project.id, MOCK_CODE)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(getGoogleStatus(client, s.project.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("connecting again keeps the choice, and brings an ended connection back", async () => {
    const s = await setup();
    await connect(s);
    await choose(s);
    await prisma.googleConnection.updateMany({
      where: { projectId: s.project.id },
      data: { status: "NEEDS_RECONNECT", lastError: "Access was taken back." },
    });
    await connect(s);
    const row = await connection(s);
    expect(row).toMatchObject({
      status: "ACTIVE",
      lastError: null,
      gscSite: "sc-domain:example.com",
      ga4PropertyId: "123456789",
      ga4PropertyName: "Example website (GA4)",
    });
    expect(await prisma.googleConnection.count({ where: { projectId: s.project.id } })).toBe(1);
  });
});

describe("choosing what to read", () => {
  it("accepts only values from the list and needs at least one", async () => {
    const s = await setup();
    await expect(choose(s)).rejects.toBeInstanceOf(NotFoundError);
    await connect(s);
    const bad = (values: object) => chooseGoogleSources(s.owner, s.project.id, values);
    await expect(
      bad({ gscSite: "https://evil.example/", ga4PropertyId: null }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(bad({ gscSite: null, ga4PropertyId: "5" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(bad({ gscSite: null, ga4PropertyId: null })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await choose(s);
    expect(await connection(s)).toMatchObject({
      gscSite: "sc-domain:example.com",
      ga4PropertyId: "123456789",
      lastSyncedOn: null,
    });
  });
});

describe("sync", () => {
  it("reads 90 days the first time, replaces overlapping days later and adds new ones", async () => {
    clock = new Date("2026-03-10T10:00:00Z");
    const s = await setup();
    await connect(s);
    await choose(s);

    const first = await sync(s);
    const ranges = syncRanges(null, "2026-03-10");
    expect(first).toEqual({
      status: "done",
      searchDays: daysInRange(ranges.gsc!.start, ranges.gsc!.end),
      analyticsDays: daysInRange(ranges.ga4!.start, ranges.ga4!.end),
    });
    const count = () =>
      Promise.all([
        prisma.searchConsoleDay.count({ where: { projectId: s.project.id } }),
        prisma.ga4Day.count({ where: { projectId: s.project.id } }),
      ]);
    expect(await count()).toEqual([
      first.status === "done" ? first.searchDays : 0,
      first.status === "done" ? first.analyticsDays : 0,
    ]);
    expect((await connection(s)).lastSyncedOn).toEqual(new Date("2026-03-10T00:00:00Z"));

    const before = await count();
    await sync(s); // the same day again: the overlap is replaced, not added twice
    expect(await count()).toEqual(before);

    clock = new Date("2026-03-11T10:00:00Z");
    await sync(s);
    expect(await count()).toEqual([before[0]! + 1, before[1]! + 1]);
    const last = await prisma.searchConsoleDay.findFirstOrThrow({
      where: { projectId: s.project.id },
      orderBy: { date: "desc" },
    });
    expect(last.date).toEqual(new Date("2026-03-09T00:00:00Z"));
  });

  it("refreshes an access token that is about to end and saves the new one encrypted", async () => {
    clock = new Date("2026-03-10T10:00:00Z");
    const s = await setup();
    await connect(s);
    await choose(s);
    await prisma.googleConnection.updateMany({
      where: { projectId: s.project.id },
      data: { accessExpiresAt: new Date("2026-03-10T10:00:30Z") },
    });
    const before = open((await connection(s)).accessTokenEnc, secret());
    await sync(s);
    const row = await connection(s);
    expect(open(row.accessTokenEnc, secret())).not.toBe(before);
    expect(row.accessExpiresAt.getTime()).toBe(clock.getTime() + 3600_000);
  });

  it("marks the connection when access was taken back, and stops asking Google", async () => {
    clock = new Date("2026-03-10T10:00:00Z");
    const s = await setup();
    await connect(s);
    await choose(s);
    await prisma.googleConnection.updateMany({
      where: { projectId: s.project.id },
      data: {
        accessExpiresAt: new Date("2026-03-10T09:00:00Z"),
        refreshTokenEnc: seal(MOCK_REVOKED_REFRESH_TOKEN, secret()),
      },
    });
    expect(await sync(s)).toEqual({ status: "needs-reconnect" });
    expect(await connection(s)).toMatchObject({ status: "NEEDS_RECONNECT" });
    expect((await connection(s)).lastError).toContain("Connect again");

    let asked = 0;
    const counting = provider({
      getSearchConsoleDaily: async () => (asked++, []),
    });
    expect(await sync(s, counting)).toEqual({ status: "needs-reconnect" });
    expect(asked).toBe(0);
    await expect(requestGoogleSync(s.owner, s.project.id)).rejects.toBeInstanceOf(ValidationError);
  });

  it("marks the connection when there is no refresh token to renew with", async () => {
    clock = new Date("2026-03-10T10:00:00Z");
    const s = await setup();
    await connect(s);
    await choose(s);
    await prisma.googleConnection.updateMany({
      where: { projectId: s.project.id },
      data: { accessExpiresAt: new Date("2026-03-10T09:00:00Z"), refreshTokenEnc: null },
    });
    expect(await sync(s)).toEqual({ status: "needs-reconnect" });
  });

  it("throws a temporary Google problem so the job is tried again, and keeps the connection", async () => {
    clock = new Date("2026-03-10T10:00:00Z");
    const s = await setup();
    await connect(s);
    await choose(s);
    const busy = provider({
      getSearchConsoleDaily: async () => {
        throw new GoogleTemporaryError("Google is busy (503). Try again later.");
      },
    });
    await expect(sync(s, busy)).rejects.toBeInstanceOf(GoogleTemporaryError);
    expect(await connection(s)).toMatchObject({ status: "ACTIVE", lastSyncedOn: null });
  });

  it("does nothing without a connection, a choice or an active project", async () => {
    clock = new Date("2026-03-10T10:00:00Z");
    const s = await setup();
    expect((await sync(s)).status).toBe("not-connected");
    await connect(s);
    expect((await sync(s)).status).toBe("nothing-selected");
    await prisma.project.update({ where: { id: s.project.id }, data: { deletedAt: new Date() } });
    expect((await sync(s)).status).toBe("inactive");
  });
});

describe("numbers", () => {
  it("sums a period and compares it with the period before", async () => {
    clock = new Date("2026-03-10T10:00:00Z");
    const s = await setup();
    await connect(s);
    await choose(s);
    await sync(s);

    const range = { start: "2026-02-09", end: "2026-03-08" };
    const numbers = await loadAnalyticsNumbers(s.agency.id, s.project.id, range);
    const rows = await prisma.searchConsoleDay.findMany({
      where: {
        projectId: s.project.id,
        date: { gte: new Date("2026-02-09T00:00:00Z"), lte: new Date("2026-03-08T00:00:00Z") },
      },
    });
    expect(rows).toHaveLength(28);
    expect(numbers.search.now.clicks).toBe(rows.reduce((a, r) => a + r.clicks, 0));
    expect(numbers.search.before.clicks).toBeGreaterThan(0);
    expect(numbers.hasSearch && numbers.hasAnalytics).toBe(true);

    const overview = await getAnalyticsOverview(s.owner, s.project.id);
    // Search Console ends a day before Analytics, and each source has 28 full days.
    expect(overview?.search?.range).toEqual(range);
    expect(overview?.analytics?.range).toEqual({ start: "2026-02-10", end: "2026-03-09" });
    expect(overview?.search?.now.clicks).toBe(numbers.search.now.clicks);
    expect(overview?.searchDays).toHaveLength(14);
    expect(overview?.searchDays[0]?.date).toBe("2026-03-08");
    expect(overview?.analyticsDays[0]?.date).toBe("2026-03-09");
  });

  it("has no overview before the first sync", async () => {
    const s = await setup();
    expect(await getAnalyticsOverview(s.owner, s.project.id)).toBeNull();
  });
});

describe("sync requests and disconnecting", () => {
  it("asks for a sync once a day and only when something is chosen", async () => {
    const s = await setup();
    await expect(requestGoogleSync(s.owner, s.project.id)).rejects.toThrow("Connect Google first.");
    await connect(s);
    await expect(requestGoogleSync(s.owner, s.project.id)).rejects.toThrow(
      "Choose what to read first.",
    );
    await choose(s);
    expect((await requestGoogleSync(s.member, s.project.id)).queued).toBe(false); // choosing already queued it today
    await prisma.googleConnection.updateMany({
      where: { projectId: s.project.id },
      data: { lastSyncedOn: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`) },
    });
    await expect(requestGoogleSync(s.owner, s.project.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("disconnecting deletes the connection and the saved numbers", async () => {
    clock = new Date("2026-03-10T10:00:00Z");
    const s = await setup();
    await connect(s);
    await choose(s);
    await sync(s);
    await disconnectGoogle(s.owner, s.project.id);
    expect(await prisma.googleConnection.count({ where: { projectId: s.project.id } })).toBe(0);
    expect(await prisma.searchConsoleDay.count({ where: { projectId: s.project.id } })).toBe(0);
    expect(await prisma.ga4Day.count({ where: { projectId: s.project.id } })).toBe(0);
    await expect(disconnectGoogle(s.owner, s.project.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("daily scheduler", () => {
  it("queues working connections with a choice that were not synced today", async () => {
    const s = await setup();
    await connect(s);
    await choose(s);
    const other = await setup();
    await connect(other); // connected, nothing chosen
    const stale = await setup();
    await connect(stale);
    await choose(stale);
    await prisma.googleConnection.updateMany({
      where: { projectId: stale.project.id },
      data: { status: "NEEDS_RECONNECT" },
    });
    const done = await setup();
    await connect(done);
    await choose(done);
    await prisma.googleConnection.updateMany({
      where: { projectId: done.project.id },
      data: { lastSyncedOn: new Date("2026-03-10T00:00:00Z") },
    });

    const queued: string[] = [];
    await runGoogleScheduler({
      db: prisma,
      now: new Date("2026-03-10T00:05:00Z"),
      enqueue: async (j) => (queued.push(j.projectId), true),
    });
    expect(queued).toContain(s.project.id);
    expect(queued).not.toContain(other.project.id);
    expect(queued).not.toContain(stale.project.id);
    expect(queued).not.toContain(done.project.id);
  });
});

describe("tenant isolation: Google", () => {
  it("another agency's project is not found for every call", async () => {
    clock = new Date("2026-03-10T10:00:00Z");
    const a = await setup();
    const b = await setup();
    await connect(b);
    await choose(b);
    await sync(b);
    await expect(getGoogleStatus(a.owner, b.project.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(completeGoogleConnect(a.owner, b.project.id, MOCK_CODE)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      chooseGoogleSources(a.owner, b.project.id, {
        gscSite: "sc-domain:example.com",
        ga4PropertyId: null,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(requestGoogleSync(a.owner, b.project.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(disconnectGoogle(a.owner, b.project.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getAnalyticsOverview(a.owner, b.project.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await prisma.googleConnection.count({ where: { projectId: b.project.id } })).toBe(1);
    expect(
      await prisma.searchConsoleDay.count({ where: { projectId: b.project.id } }),
    ).toBeGreaterThan(0);
  });

  it("the sync of one agency never reads another agency's connection", async () => {
    clock = new Date("2026-03-10T10:00:00Z");
    const a = await setup();
    const b = await setup();
    await connect(b);
    await choose(b);
    const result = await runGoogleSync(
      { db, provider: provider(), secret: secret(), now: () => clock },
      { projectId: b.project.id, agencyId: a.agency.id },
    );
    expect(result.status).toBe("inactive");
    expect(await prisma.searchConsoleDay.count({ where: { projectId: b.project.id } })).toBe(0);
  });
});
