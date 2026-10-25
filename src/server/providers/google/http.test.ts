import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { GoogleHttpProvider } from "./http";
import { GoogleAuthError, GoogleTemporaryError } from "./types";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const now = new Date("2026-03-10T10:00:00Z");
const provider = new GoogleHttpProvider({
  clientId: "client-id",
  clientSecret: "client-secret",
  now: () => now,
});
const idToken = `x.${Buffer.from(JSON.stringify({ email: "boss@agency.test" })).toString("base64url")}.y`;

describe("auth url", () => {
  it("asks for offline access, the read-only scopes and carries the state", () => {
    const url = new URL(
      provider.buildAuthUrl({ state: "s1", redirectUri: "https://app.test/api/google/callback" }),
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("s1");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.test/api/google/callback");
    const scope = url.searchParams.get("scope")!;
    expect(scope).toContain("webmasters.readonly");
    expect(scope).toContain("analytics.readonly");
    expect(scope).not.toMatch(/auth\/(webmasters|analytics)(\s|$)/);
  });
});

describe("tokens", () => {
  it("exchanges a code and reads the email from the id token", async () => {
    let form: URLSearchParams | undefined;
    server.use(
      http.post("https://oauth2.googleapis.com/token", async ({ request }) => {
        form = new URLSearchParams(await request.text());
        return HttpResponse.json({
          access_token: "at",
          refresh_token: "rt",
          expires_in: 3599,
          scope: "openid email https://www.googleapis.com/auth/webmasters.readonly",
          id_token: idToken,
        });
      }),
    );
    const tokens = await provider.exchangeCode({ code: "c1", redirectUri: "https://app.test/cb" });
    expect(form!.get("grant_type")).toBe("authorization_code");
    expect(form!.get("code")).toBe("c1");
    expect(form!.get("client_secret")).toBe("client-secret");
    expect(tokens).toMatchObject({
      accessToken: "at",
      refreshToken: "rt",
      accountEmail: "boss@agency.test",
    });
    expect(tokens.expiresAt.getTime()).toBe(now.getTime() + 3599_000);
    expect(tokens.scopes).toContain("email");
  });

  it("turns invalid_grant into a reconnect error and a server error into a temporary one", async () => {
    server.use(
      http.post("https://oauth2.googleapis.com/token", () =>
        HttpResponse.json({ error: "invalid_grant" }, { status: 400 }),
      ),
    );
    await expect(provider.refresh("rt")).rejects.toMatchObject({
      name: "GoogleAuthError",
      needsReconnect: true,
    });
    server.use(
      http.post("https://oauth2.googleapis.com/token", () =>
        HttpResponse.json({}, { status: 503 }),
      ),
    );
    await expect(provider.refresh("rt")).rejects.toBeInstanceOf(GoogleTemporaryError);
  });

  it("refreshes an access token", async () => {
    server.use(
      http.post("https://oauth2.googleapis.com/token", async ({ request }) => {
        const form = new URLSearchParams(await request.text());
        expect(form.get("grant_type")).toBe("refresh_token");
        expect(form.get("refresh_token")).toBe("rt");
        return HttpResponse.json({ access_token: "at2", expires_in: 3600 });
      }),
    );
    const result = await provider.refresh("rt");
    expect(result.accessToken).toBe("at2");
    expect(result.expiresAt.getTime()).toBe(now.getTime() + 3600_000);
  });

  it("revokes a token", async () => {
    let seen = "";
    server.use(
      http.post("https://oauth2.googleapis.com/revoke", ({ request }) => {
        seen = new URL(request.url).searchParams.get("token") ?? "";
        return HttpResponse.json({});
      }),
    );
    await provider.revoke("tok en");
    expect(seen).toBe("tok en");
  });
});

describe("lists", () => {
  it("lists Search Console sites without unverified ones", async () => {
    server.use(
      http.get("https://www.googleapis.com/webmasters/v3/sites", ({ request }) => {
        expect(request.headers.get("authorization")).toBe("Bearer at");
        return HttpResponse.json({
          siteEntry: [
            { siteUrl: "sc-domain:a.com", permissionLevel: "siteOwner" },
            { siteUrl: "https://b.com/", permissionLevel: "siteUnverifiedUser" },
          ],
        });
      }),
    );
    expect(await provider.listSearchConsoleSites("at")).toEqual([
      { siteUrl: "sc-domain:a.com", permissionLevel: "siteOwner" },
    ]);
  });

  it("lists GA4 properties from all accounts, and copes with none", async () => {
    server.use(
      http.get("https://analyticsadmin.googleapis.com/v1beta/accountSummaries", () =>
        HttpResponse.json({
          accountSummaries: [
            { propertySummaries: [{ property: "properties/111", displayName: "Site" }] },
            {},
            { propertySummaries: [{ property: "properties/222", displayName: "Shop" }] },
          ],
        }),
      ),
    );
    expect(await provider.listGa4Properties("at")).toEqual([
      { propertyId: "111", displayName: "Site" },
      { propertyId: "222", displayName: "Shop" },
    ]);
    server.use(
      http.get("https://analyticsadmin.googleapis.com/v1beta/accountSummaries", () =>
        HttpResponse.json({}),
      ),
    );
    expect(await provider.listGa4Properties("at")).toEqual([]);
  });
});

describe("daily numbers", () => {
  it("reads Search Console days", async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(
        "https://www.googleapis.com/webmasters/v3/sites/:site/searchAnalytics/query",
        async ({ request, params }) => {
          body = (await request.json()) as Record<string, unknown>;
          expect(decodeURIComponent(String(params.site))).toBe("sc-domain:a.com");
          return HttpResponse.json({
            rows: [
              { keys: ["2026-03-01"], clicks: 10.0, impressions: 200, ctr: 0.05, position: 7.3 },
              { keys: ["2026-03-02"], clicks: 4, impressions: 100, ctr: 0.04, position: 8.1 },
            ],
          });
        },
      ),
    );
    const days = await provider.getSearchConsoleDaily("at", {
      siteUrl: "sc-domain:a.com",
      startDate: "2026-03-01",
      endDate: "2026-03-02",
    });
    expect(body).toMatchObject({
      startDate: "2026-03-01",
      endDate: "2026-03-02",
      dimensions: ["date"],
    });
    expect(days).toEqual([
      { date: "2026-03-01", clicks: 10, impressions: 200, ctr: 0.05, position: 7.3 },
      { date: "2026-03-02", clicks: 4, impressions: 100, ctr: 0.04, position: 8.1 },
    ]);
  });

  it("reads GA4 days and fixes the date format", async () => {
    server.use(
      http.post("https://analyticsdata.googleapis.com/v1beta/properties/:p", () =>
        HttpResponse.json({
          rows: [
            {
              dimensionValues: [{ value: "20260301" }],
              metricValues: [{ value: "120" }, { value: "3" }],
            },
          ],
        }),
      ),
    );
    expect(
      await provider.getGa4Daily("at", {
        propertyId: "111",
        startDate: "2026-03-01",
        endDate: "2026-03-01",
      }),
    ).toEqual([{ date: "2026-03-01", sessions: 120, conversions: 3 }]);
  });

  it("asks Search Console for one dimension and reads the top rows", async () => {
    let sent: { dimensions?: string[]; rowLimit?: number } = {};
    server.use(
      http.post(
        "https://www.googleapis.com/webmasters/v3/sites/:site/searchAnalytics/query",
        async ({ request }) => {
          sent = (await request.json()) as typeof sent;
          return HttpResponse.json({
            rows: [
              { keys: ["seo agency"], clicks: 12.4, impressions: 300, ctr: 0.04, position: 7.25 },
            ],
          });
        },
      ),
    );
    const rows = await provider.getSearchBreakdown("at", {
      siteUrl: "sc-domain:example.com",
      startDate: "2026-02-01",
      endDate: "2026-02-28",
      dimension: "QUERY",
      limit: 250,
    });
    expect(sent).toMatchObject({ dimensions: ["query"], rowLimit: 250 });
    expect(rows).toEqual([{ key: "seo agency", clicks: 12, impressions: 300, position: 7.25 }]);
  });

  it("reads landing pages from Analytics, biggest first", async () => {
    let sent: { dimensions?: { name: string }[]; limit?: number } = {};
    server.use(
      http.post(
        "https://analyticsdata.googleapis.com/v1beta/properties/:id\\:runReport",
        async ({ request }) => {
          sent = (await request.json()) as typeof sent;
          return HttpResponse.json({
            rows: [
              {
                dimensionValues: [{ value: "/pricing" }],
                metricValues: [{ value: "90" }, { value: "60" }, { value: "4" }],
              },
            ],
          });
        },
      ),
    );
    const rows = await provider.getGa4Pages("at", {
      propertyId: "111",
      startDate: "2026-02-01",
      endDate: "2026-02-28",
      limit: 250,
    });
    expect(sent.dimensions).toEqual([{ name: "landingPagePlusQueryString" }]);
    expect(rows).toEqual([{ path: "/pricing", sessions: 90, engagedSessions: 60, conversions: 4 }]);
  });

  it("reads a URL inspection answer", async () => {
    let sent: { inspectionUrl?: string; siteUrl?: string } = {};
    server.use(
      http.post(
        "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
        async ({ request }) => {
          sent = (await request.json()) as typeof sent;
          return HttpResponse.json({
            inspectionResult: {
              indexStatusResult: {
                verdict: "PASS",
                coverageState: "Submitted and indexed",
                robotsTxtState: "ALLOWED",
                indexingState: "INDEXING_ALLOWED",
                lastCrawlTime: "2026-03-01T10:00:00Z",
                pageFetchState: "SUCCESSFUL",
                googleCanonical: "https://example.com/a",
                userCanonical: "https://example.com/a",
              },
              mobileUsabilityResult: { verdict: "PASS" },
              richResultsResult: { verdict: "PASS", detectedItems: [{ richResultType: "FAQ" }] },
            },
          });
        },
      ),
    );
    const result = await provider.inspectUrl("at", {
      siteUrl: "sc-domain:example.com",
      inspectionUrl: "https://example.com/a",
    });
    expect(sent).toEqual({
      inspectionUrl: "https://example.com/a",
      siteUrl: "sc-domain:example.com",
    });
    expect(result).toMatchObject({
      verdict: "PASS",
      coverageState: "Submitted and indexed",
      lastCrawlTime: "2026-03-01T10:00:00Z",
      mobileVerdict: "PASS",
      richResultsVerdict: "PASS",
      richResultTypes: ["FAQ"],
    });
  });

  it("copes with an empty inspection answer", async () => {
    server.use(
      http.post("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", () =>
        HttpResponse.json({}),
      ),
    );
    expect(
      await provider.inspectUrl("at", { siteUrl: "s", inspectionUrl: "https://example.com/" }),
    ).toMatchObject({
      verdict: "VERDICT_UNSPECIFIED",
      coverageState: "Unknown",
      richResultTypes: [],
    });
  });

  it("returns an empty list when Google has no rows", async () => {
    server.use(
      http.post("https://www.googleapis.com/webmasters/v3/sites/:site/searchAnalytics/query", () =>
        HttpResponse.json({}),
      ),
    );
    expect(
      await provider.getSearchConsoleDaily("at", {
        siteUrl: "x",
        startDate: "2026-03-01",
        endDate: "2026-03-02",
      }),
    ).toEqual([]);
  });
});

describe("errors", () => {
  it("maps 401 and 403 to reconnect, 429 and 500 to temporary, other codes to a plain refusal", async () => {
    const cases: [number, unknown][] = [
      [401, expect.objectContaining({ needsReconnect: true })],
      [403, expect.objectContaining({ needsReconnect: true })],
      [400, expect.objectContaining({ needsReconnect: false })],
    ];
    for (const [status, shape] of cases) {
      server.use(
        http.get("https://www.googleapis.com/webmasters/v3/sites", () =>
          HttpResponse.json({}, { status }),
        ),
      );
      const error = await provider.listSearchConsoleSites("at").catch((e) => e);
      expect(error).toBeInstanceOf(GoogleAuthError);
      expect(error).toEqual(shape);
    }
    for (const status of [429, 500, 503]) {
      server.use(
        http.get("https://www.googleapis.com/webmasters/v3/sites", () =>
          HttpResponse.json({}, { status }),
        ),
      );
      await expect(provider.listSearchConsoleSites("at")).rejects.toBeInstanceOf(
        GoogleTemporaryError,
      );
    }
  });
});
