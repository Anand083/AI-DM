import { describe, expect, it } from "vitest";
import { datesBetween, MOCK_CODE, MOCK_REVOKED_REFRESH_TOKEN, MockGoogleProvider } from "./mock";
import { GoogleAuthError } from "./types";

const now = new Date("2026-03-10T10:00:00Z");
const p = new MockGoogleProvider({ now: () => now });

describe("mock Google", () => {
  it("sends the person straight back with a code and the same state", () => {
    const url = new URL(
      p.buildAuthUrl({
        state: "abc.def",
        redirectUri: "http://localhost:3000/api/google/callback",
      }),
    );
    expect(url.origin + url.pathname).toBe("http://localhost:3000/api/google/callback");
    expect(url.searchParams.get("code")).toBe(MOCK_CODE);
    expect(url.searchParams.get("state")).toBe("abc.def");
  });

  it("exchanges the mock code and refuses any other", async () => {
    const tokens = await p.exchangeCode({ code: MOCK_CODE, redirectUri: "http://x/cb" });
    expect(tokens).toMatchObject({
      refreshToken: "mock-refresh",
      accountEmail: "owner@example.com",
    });
    expect(tokens.expiresAt.getTime()).toBe(now.getTime() + 3600_000);
    await expect(
      p.exchangeCode({ code: "nope", redirectUri: "http://x/cb" }),
    ).rejects.toBeInstanceOf(GoogleAuthError);
  });

  it("refreshes, and reports a revoked token as needing a new connection", async () => {
    expect((await p.refresh("mock-refresh")).accessToken).toMatch(/^mock-access-/);
    await expect(p.refresh(MOCK_REVOKED_REFRESH_TOKEN)).rejects.toMatchObject({
      needsReconnect: true,
    });
  });

  it("lists sites and properties", async () => {
    expect((await p.listSearchConsoleSites()).map((s) => s.siteUrl)).toContain(
      "sc-domain:example.com",
    );
    expect((await p.listGa4Properties())[0]).toEqual({
      propertyId: "123456789",
      displayName: "Example website (GA4)",
    });
  });

  it("gives the same daily numbers every time, one per day, with sane values", async () => {
    const input = {
      siteUrl: "sc-domain:example.com",
      startDate: "2026-03-01",
      endDate: "2026-03-07",
    };
    const a = await p.getSearchConsoleDaily("t", input);
    expect(a).toEqual(await p.getSearchConsoleDaily("t", input));
    expect(a.map((d) => d.date)).toEqual(datesBetween("2026-03-01", "2026-03-07"));
    for (const d of a) {
      expect(d.clicks).toBeLessThanOrEqual(d.impressions);
      expect(d.ctr).toBeGreaterThan(0);
      expect(d.ctr).toBeLessThan(1);
      expect(d.position).toBeGreaterThanOrEqual(1);
    }
    const g = await p.getGa4Daily("t", {
      propertyId: "123456789",
      startDate: "2026-03-01",
      endDate: "2026-03-03",
    });
    expect(g).toHaveLength(3);
    for (const d of g) expect(d.conversions).toBeLessThanOrEqual(d.sessions);
  });
});

describe("datesBetween", () => {
  it("includes both ends and is empty when the end is before the start", () => {
    expect(datesBetween("2026-02-27", "2026-03-02")).toEqual([
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
    ]);
    expect(datesBetween("2026-03-02", "2026-03-01")).toEqual([]);
  });
});

describe("mock breakdowns", () => {
  const mock = new MockGoogleProvider();
  const range = {
    siteUrl: "sc-domain:example.com",
    startDate: "2026-02-01",
    endDate: "2026-02-28",
  };

  it("gives the same answer twice, biggest clicks first, and respects the limit", async () => {
    const a = await mock.getSearchBreakdown("t", { ...range, dimension: "QUERY", limit: 5 });
    const b = await mock.getSearchBreakdown("t", { ...range, dimension: "QUERY", limit: 5 });
    expect(a).toEqual(b);
    expect(a).toHaveLength(5);
    expect(a.map((r) => r.clicks)).toEqual([...a.map((r) => r.clicks)].sort((x, y) => y - x));
  });

  it("builds page addresses from the site and has fixed devices and landing pages", async () => {
    const pages = await mock.getSearchBreakdown("t", { ...range, dimension: "PAGE", limit: 3 });
    expect(pages.every((p) => p.key.startsWith("https://example.com/"))).toBe(true);
    const devices = await mock.getSearchBreakdown("t", {
      ...range,
      dimension: "DEVICE",
      limit: 10,
    });
    expect(devices.map((d) => d.key).sort()).toEqual(["DESKTOP", "MOBILE", "TABLET"]);
    const landing = await mock.getGa4Pages("t", {
      propertyId: "1",
      startDate: "2026-02-01",
      endDate: "2026-02-28",
      limit: 4,
    });
    expect(landing).toHaveLength(4);
    expect(landing.every((p) => p.engagedSessions <= p.sessions)).toBe(true);
  });
});
