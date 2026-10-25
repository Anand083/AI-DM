import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getEnv } from "@/env";
import { seal } from "@/server/crypto/secret-box";
import { db } from "@/server/db/client";
import {
  MOCK_CODE,
  MOCK_REVOKED_REFRESH_TOKEN,
  MockGoogleProvider,
} from "@/server/providers/google/mock";
import {
  ForbiddenError,
  LimitExceededError,
  NotFoundError,
  ValidationError,
} from "@/server/services/errors";
import { runUrlInspection } from "@/server/services/google-inspect";
import { chooseGoogleSources, completeGoogleConnect } from "@/server/services/google";
import {
  getCombinedDaily,
  listLandingPages,
  listUrlInspections,
  requestUrlInspection,
  listSearchBreakdown,
} from "@/server/services/google-insights";
import { runGoogleSync } from "@/server/services/google-sync";
import { createAgencyWithMembers, seedPlans } from "../factories";
import { createTestClient, resetDb } from "../helpers/db";

const prisma = createTestClient();
const secret = () => getEnv().ENCRYPTION_KEY;
const clock = new Date("2026-03-10T10:00:00Z");

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
  const s = { agency, project, owner: members[0]!.ctx, member: members[1]!.ctx };
  await completeGoogleConnect(s.owner, project.id, MOCK_CODE);
  await chooseGoogleSources(s.owner, project.id, {
    gscSite: "sc-domain:example.com",
    ga4PropertyId: "123456789",
  });
  return s;
}
type S = Awaited<ReturnType<typeof setup>>;

const provider = (over: Partial<MockGoogleProvider> = {}) =>
  Object.assign(new MockGoogleProvider({ now: () => clock }), over) as MockGoogleProvider;
const sync = (s: S, p = provider()) =>
  runGoogleSync(
    { db, provider: p, secret: secret(), now: () => clock },
    { projectId: s.project.id, agencyId: s.agency.id },
  );

describe("breakdowns saved by the daily read", () => {
  it("saves the four lists and the landing pages, and replaces them on the next read", async () => {
    const s = await setup();
    expect((await sync(s)).status).toBe("done");
    const count = (dimension: string, period: string) =>
      prisma.searchBreakdown.count({
        where: { projectId: s.project.id, dimension, period },
      });
    expect(await count("QUERY", "NOW")).toBe(10);
    expect(await count("QUERY", "BEFORE")).toBe(10);
    expect(await count("PAGE", "NOW")).toBe(10);
    expect(await count("COUNTRY", "NOW")).toBe(6);
    expect(await count("DEVICE", "NOW")).toBe(3);
    expect(await count("DEVICE", "BEFORE")).toBe(0);
    expect(await prisma.ga4Page.count({ where: { projectId: s.project.id } })).toBe(10);

    await sync(s);
    expect(await count("QUERY", "NOW")).toBe(10);
    expect(await prisma.ga4Page.count({ where: { projectId: s.project.id } })).toBe(10);
  });

  it("lists biggest clicks first with the change against the 28 days before, 5 a page", async () => {
    const s = await setup();
    await sync(s);
    const first = await listSearchBreakdown(s.owner, s.project.id, "QUERY", { pageSize: 5 });
    expect(first.total).toBe(10);
    expect(first.items).toHaveLength(5);
    const clicks = first.items.map((i) => i.clicks);
    expect([...clicks].sort((a, b) => b - a)).toEqual(clicks);
    expect(first.items.every((i) => i.clicksBefore !== undefined)).toBe(true);
    const second = await listSearchBreakdown(s.owner, s.project.id, "QUERY", {
      page: 2,
      pageSize: 5,
    });
    expect(second.items.map((i) => i.key)).not.toContain(first.items[0]!.key);
    const devices = await listSearchBreakdown(s.owner, s.project.id, "DEVICE");
    expect(devices.items.every((i) => i.clicksBefore === undefined)).toBe(true);

    const pages = await listLandingPages(s.owner, s.project.id, { pageSize: 4 });
    expect(pages.total).toBe(10);
    expect(pages.items[0]!.sessions).toBeGreaterThanOrEqual(pages.items[1]!.sessions);
  });

  it("keeps lists inside the agency and away from client users", async () => {
    const a = await setup();
    const b = await setup("Other Agency");
    await sync(a);
    await sync(b);
    await expect(listSearchBreakdown(b.owner, a.project.id, "QUERY")).rejects.toThrow(
      NotFoundError,
    );
    await expect(listLandingPages(b.owner, a.project.id)).rejects.toThrow(NotFoundError);
    await expect(
      listSearchBreakdown({ ...a.owner, role: "CLIENT" }, a.project.id, "QUERY"),
    ).rejects.toThrow(ForbiddenError);
    expect(
      await prisma.searchBreakdown.count({
        where: { agencyId: a.agency.id, projectId: b.project.id },
      }),
    ).toBe(0);
  });
});

describe("combined daily view", () => {
  it("puts rankings, clicks, visits, conversions and notes on one row per day", async () => {
    const s = await setup();
    await sync(s);
    const keyword = await prisma.keyword.create({
      data: { agencyId: s.agency.id, projectId: s.project.id, phrase: "blue shoes" },
    });
    const newest = (
      await prisma.searchConsoleDay.findFirstOrThrow({
        where: { projectId: s.project.id },
        orderBy: { date: "desc" },
      })
    ).date;
    for (const position of [4, 8]) {
      const other = await prisma.keyword.create({
        data: { agencyId: s.agency.id, projectId: s.project.id, phrase: `k${position}` },
      });
      await prisma.rankCheck.create({
        data: {
          agencyId: s.agency.id,
          keywordId: other.id,
          date: newest,
          position,
          provider: "mock",
        },
      });
    }
    await prisma.rankCheck.create({
      data: {
        agencyId: s.agency.id,
        keywordId: keyword.id,
        date: newest,
        position: null,
        provider: "mock",
      },
    });
    await prisma.annotation.create({
      data: {
        agencyId: s.agency.id,
        projectId: null,
        on: newest,
        kind: "ALGORITHM",
        title: "Core update",
      },
    });

    const rows = await getCombinedDaily(s.owner, s.project.id);
    expect(rows).toHaveLength(28);
    const day = newest.toISOString().slice(0, 10);
    const row = rows.find((r) => r.date === day)!;
    expect(row.averagePosition).toBe(6);
    expect(row.clicks).not.toBeNull();
    expect(row.notes).toEqual(["Core update"]);
    const older = rows[5]!;
    expect(older.averagePosition).toBeNull();
    expect(older.notes).toEqual([]);
    await expect(getCombinedDaily({ ...s.owner, role: "CLIENT" }, s.project.id)).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("is empty without any data", async () => {
    const { agency, members } = await createAgencyWithMembers(
      prisma,
      ["OWNER"],
      undefined,
      "GROWTH",
    );
    const client = await prisma.client.create({ data: { agencyId: agency.id, name: "C" } });
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
    expect(await getCombinedDaily(members[0]!.ctx, project.id)).toEqual([]);
  });
});

describe("Google alerts", () => {
  /** A provider whose newest week has `recent` and the week before has `before` a day. */
  const weeks = (recent: number, before: number) => {
    const days = (start: string, end: string) => {
      const out: { date: string; i: number }[] = [];
      const last = Date.parse(`${end}T00:00:00Z`);
      for (let t = Date.parse(`${start}T00:00:00Z`); t <= last; t += 86_400_000) {
        out.push({
          date: new Date(t).toISOString().slice(0, 10),
          i: Math.round((last - t) / 86_400_000),
        });
      }
      return out;
    };
    return provider({
      getSearchConsoleDaily: async (_t, r) =>
        days(r.startDate, r.endDate).map(({ date, i }) => ({
          date,
          clicks: i < 7 ? recent : before,
          impressions: 1000,
          ctr: 0.01,
          position: 8,
        })),
      getGa4Daily: async (_t, r) =>
        days(r.startDate, r.endDate).map(({ date, i }) => ({
          date,
          sessions: i < 7 ? recent : before,
          conversions: 1,
        })),
    });
  };

  it("raises one alert per source when numbers fall sharply, and not again for the same day", async () => {
    const s = await setup();
    const p = weeks(10, 30);
    await sync(s, p);
    await sync(s, p);
    const alerts = await prisma.alert.findMany({
      where: { agencyId: s.agency.id, type: "GOOGLE_ANOMALY" },
      orderBy: { title: "asc" },
    });
    expect(alerts.map((a) => a.title)).toEqual([
      "Site: Google Search clicks fell 67%",
      "Site: website sessions fell 67%",
    ]);
    expect(alerts[0]).toMatchObject({ severity: "CRITICAL", projectId: s.project.id });
  });

  it("stays quiet for small sites and small falls", async () => {
    const small = await setup();
    await sync(small, weeks(1, 3));
    const gentle = await setup();
    await sync(gentle, weeks(90, 100));
    expect(
      await prisma.alert.count({
        where: { type: "GOOGLE_ANOMALY", agencyId: { in: [small.agency.id, gentle.agency.id] } },
      }),
    ).toBe(0);
    expect(gentle.agency.id).not.toBe(small.agency.id);
  });

  it("alerts when Google access was taken back", async () => {
    const s = await setup();
    await prisma.googleConnection.updateMany({
      where: { projectId: s.project.id },
      data: {
        accessExpiresAt: new Date("2026-03-10T09:00:00Z"),
        refreshTokenEnc: seal(MOCK_REVOKED_REFRESH_TOKEN, secret()),
      },
    });
    expect((await sync(s)).status).toBe("needs-reconnect");
    const alert = await prisma.alert.findFirstOrThrow({
      where: { agencyId: s.agency.id, type: "GOOGLE_RECONNECT" },
    });
    expect(alert.title).toBe("Reconnect Google for Site");
  });
});

describe("URL inspection", () => {
  const inspect = (s: S, url: string, p = provider()) =>
    runUrlInspection(
      { db, provider: p, secret: secret(), now: () => clock },
      { agencyId: s.agency.id, projectId: s.project.id, url },
    );

  it("saves Google's answer once per page and replaces it next time", async () => {
    const s = await setup();
    const url = "https://example.com/pricing";
    const first = await inspect(s, url);
    expect(first.status).toBe("done");
    const again = await inspect(
      s,
      url,
      provider({
        inspectUrl: async () => ({
          verdict: "FAIL",
          coverageState: "Crawled - currently not indexed",
          indexingState: null,
          robotsTxtState: "ALLOWED",
          pageFetchState: "SUCCESSFUL",
          lastCrawlTime: "2026-03-02T00:00:00Z",
          googleCanonical: url,
          userCanonical: url,
          mobileVerdict: "PASS",
          richResultsVerdict: null,
          richResultTypes: [],
        }),
      }),
    );
    expect(again).toEqual({ status: "done", verdict: "FAIL" });
    const rows = await prisma.urlInspection.findMany({ where: { projectId: s.project.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      verdict: "FAIL",
      coverageState: "Crawled - currently not indexed",
    });
    const list = await listUrlInspections(s.owner, s.project.id);
    expect(list.total).toBe(1);
  });

  it("marks the connection and raises an alert when access was taken back", async () => {
    const s = await setup();
    await prisma.googleConnection.updateMany({
      where: { projectId: s.project.id },
      data: {
        accessExpiresAt: new Date("2026-03-10T09:00:00Z"),
        refreshTokenEnc: seal(MOCK_REVOKED_REFRESH_TOKEN, secret()),
      },
    });
    expect((await inspect(s, "https://example.com/a")).status).toBe("needs-reconnect");
    expect(
      await prisma.alert.count({ where: { agencyId: s.agency.id, type: "GOOGLE_RECONNECT" } }),
    ).toBe(1);
    expect(await prisma.urlInspection.count({ where: { projectId: s.project.id } })).toBe(0);
  });

  it("does nothing for a project without a connection or a site", async () => {
    const { agency, members } = await createAgencyWithMembers(
      prisma,
      ["OWNER"],
      undefined,
      "GROWTH",
    );
    const client = await prisma.client.create({ data: { agencyId: agency.id, name: "C" } });
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
    const run = (projectId: string) =>
      runUrlInspection(
        { db, provider: provider(), secret: secret(), now: () => clock },
        { agencyId: agency.id, projectId, url: "https://p.test/" },
      );
    expect((await run(project.id)).status).toBe("not-connected");
    expect((await run("missing")).status).toBe("inactive");
    await expect(
      requestUrlInspection(members[0]!.ctx, project.id, "https://p.test/"),
    ).rejects.toThrow(ValidationError);
  });

  it("only takes pages of the project website, within the daily limit, for people who may run tools", async () => {
    const s = await setup();
    const ok = await requestUrlInspection(s.owner, s.project.id, "https://www.example.com/a#x");
    expect(ok.url).toBe("https://www.example.com/a");
    for (const bad of ["https://evil.com/", "https://example.com.evil.com/", "nonsense", ""]) {
      await expect(requestUrlInspection(s.owner, s.project.id, bad)).rejects.toThrow(
        ValidationError,
      );
    }
    await expect(
      requestUrlInspection({ ...s.owner, role: "CLIENT" }, s.project.id, "https://example.com/"),
    ).rejects.toThrow(ForbiddenError);
    const now = new Date("2026-03-10T12:00:00Z");
    for (let i = 0; i < 20; i++) {
      await prisma.urlInspection.create({
        data: {
          agencyId: s.agency.id,
          projectId: s.project.id,
          url: `https://example.com/p${i}`,
          inspectedAt: now,
          verdict: "PASS",
          coverageState: "x",
        },
      });
    }
    await expect(
      requestUrlInspection(s.owner, s.project.id, "https://example.com/new", now),
    ).rejects.toThrow(LimitExceededError);
  });

  it("stays inside the agency", async () => {
    const a = await setup();
    const b = await setup("Other Agency");
    await inspect(a, "https://example.com/a");
    await expect(listUrlInspections(b.owner, a.project.id)).rejects.toThrow(NotFoundError);
    await expect(
      requestUrlInspection(b.owner, a.project.id, "https://example.com/a"),
    ).rejects.toThrow(NotFoundError);
    expect((await listUrlInspections(b.owner, b.project.id)).total).toBe(0);
  });
});
