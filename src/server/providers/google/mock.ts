import { MOCK_SITE_PATHS } from "@/data/mock-paths";
import { makeRng } from "../seo/mock/prng";
import {
  GOOGLE_SCOPES,
  GoogleAuthError,
  type AnalyticsDay,
  type AnalyticsPageRow,
  type BreakdownDimension,
  type SearchBreakdownRow,
  type Ga4Property,
  type GoogleProvider,
  type GoogleTokens,
  type SearchDay,
  type SearchSite,
  type UrlInspectionResult,
} from "./types";

export const MOCK_CODE = "mock-code";
export const MOCK_REVOKED_REFRESH_TOKEN = "mock-refresh-revoked";

const DAY_MS = 86_400_000;

const BREAKDOWN_NAMES: Record<BreakdownDimension, (site: string) => string[]> = {
  QUERY: () => [
    "seo agency",
    "local seo services",
    "seo checklist",
    "how to rank higher",
    "link building tips",
    "keyword research tool",
    "technical seo audit",
    "seo for small business",
    "backlink checker",
    "google ranking factors",
  ],
  PAGE: (site) => {
    const base = site.startsWith("sc-domain:")
      ? `https://${site.slice("sc-domain:".length)}`
      : site.replace(/\/$/, "");
    return MOCK_SITE_PATHS.map((p) => `${base}${p}`);
  },
  COUNTRY: () => ["usa", "gbr", "ind", "can", "aus", "deu"],
  DEVICE: () => ["MOBILE", "DESKTOP", "TABLET"],
};

/** Every date from `start` to `end`, both included (YYYY-MM-DD). */
export function datesBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (
    let t = Date.parse(`${start}T00:00:00Z`);
    t <= Date.parse(`${end}T00:00:00Z`) && out.length < 1000;
    t += DAY_MS
  ) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/**
 * A pretend Google. The sign-in step sends the person straight back with a fixed code, the
 * lists are fixed, and the daily numbers come from the site and the date, so the same question
 * always gets the same answer. No network.
 */
export class MockGoogleProvider implements GoogleProvider {
  readonly name = "mock" as const;
  private readonly now: () => Date;
  private counter = 0;

  constructor(options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  buildAuthUrl(input: { state: string; redirectUri: string }): string {
    const url = new URL(input.redirectUri);
    url.searchParams.set("code", MOCK_CODE);
    url.searchParams.set("state", input.state);
    return url.toString();
  }

  async exchangeCode(input: { code: string; redirectUri: string }): Promise<GoogleTokens> {
    if (input.code !== MOCK_CODE) throw new GoogleAuthError("The sign-in code is not valid.", true);
    return {
      accessToken: `mock-access-${++this.counter}`,
      refreshToken: "mock-refresh",
      expiresAt: new Date(this.now().getTime() + 3600_000),
      scopes: [...GOOGLE_SCOPES],
      accountEmail: "owner@example.com",
    };
  }

  async refresh(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
    if (refreshToken === MOCK_REVOKED_REFRESH_TOKEN) {
      throw new GoogleAuthError("Access to Google was taken back. Connect again.", true);
    }
    return {
      accessToken: `mock-access-${++this.counter}`,
      expiresAt: new Date(this.now().getTime() + 3600_000),
    };
  }

  async listSearchConsoleSites(): Promise<SearchSite[]> {
    return [
      { siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" },
      { siteUrl: "https://www.example.com/", permissionLevel: "siteFullUser" },
      { siteUrl: "https://blog.example.com/", permissionLevel: "siteRestrictedUser" },
    ];
  }

  async listGa4Properties(): Promise<Ga4Property[]> {
    return [
      { propertyId: "123456789", displayName: "Example website (GA4)" },
      { propertyId: "987654321", displayName: "Example shop (GA4)" },
    ];
  }

  async getSearchConsoleDaily(
    _token: string,
    input: { siteUrl: string; startDate: string; endDate: string },
  ): Promise<SearchDay[]> {
    const level = makeRng(input.siteUrl, "gsc-level").int(20, 400);
    return datesBetween(input.startDate, input.endDate).map((date) => {
      const rng = makeRng(input.siteUrl, "gsc", date);
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      const factor = weekday === 0 || weekday === 6 ? 0.6 : 1;
      const impressions = Math.max(10, Math.round(level * 25 * factor * (0.8 + rng.next() * 0.4)));
      const ctr = 0.02 + rng.next() * 0.04;
      const clicks = Math.round(impressions * ctr);
      return {
        date,
        clicks,
        impressions,
        ctr: clicks / impressions,
        position: Math.round((6 + rng.next() * 8) * 10) / 10,
      };
    });
  }

  async getGa4Daily(
    _token: string,
    input: { propertyId: string; startDate: string; endDate: string },
  ): Promise<AnalyticsDay[]> {
    const level = makeRng(input.propertyId, "ga4-level").int(30, 500);
    return datesBetween(input.startDate, input.endDate).map((date) => {
      const rng = makeRng(input.propertyId, "ga4", date);
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      const factor = weekday === 0 || weekday === 6 ? 0.55 : 1;
      const sessions = Math.max(1, Math.round(level * factor * (0.8 + rng.next() * 0.4)));
      return { date, sessions, conversions: Math.round(sessions * (0.02 + rng.next() * 0.05)) };
    });
  }

  async getSearchBreakdown(
    _token: string,
    input: {
      siteUrl: string;
      startDate: string;
      endDate: string;
      dimension: BreakdownDimension;
      limit: number;
    },
  ): Promise<SearchBreakdownRow[]> {
    const names = BREAKDOWN_NAMES[input.dimension](input.siteUrl);
    const days = datesBetween(input.startDate, input.endDate).length;
    return names
      .slice(0, input.limit)
      .map((key, i) => {
        const rng = makeRng(input.siteUrl, "gsc-breakdown", input.dimension, key, input.startDate);
        const share = 1 / (i + 1.5);
        const impressions = Math.max(5, Math.round(days * 40 * share * (0.8 + rng.next() * 0.4)));
        const clicks = Math.round(impressions * (0.02 + rng.next() * 0.06));
        return {
          key,
          clicks,
          impressions,
          position: Math.round((3 + i * 1.3 + rng.next() * 3) * 10) / 10,
        };
      })
      .sort((a, b) => b.clicks - a.clicks || a.key.localeCompare(b.key));
  }

  async getGa4Pages(
    _token: string,
    input: { propertyId: string; startDate: string; endDate: string; limit: number },
  ): Promise<AnalyticsPageRow[]> {
    const days = datesBetween(input.startDate, input.endDate).length;
    return MOCK_SITE_PATHS.slice(0, input.limit).map((path, i) => {
      const rng = makeRng(input.propertyId, "ga4-page", path, input.startDate);
      const sessions = Math.max(
        2,
        Math.round(days * 14 * (1 / (i + 1.3)) * (0.8 + rng.next() * 0.4)),
      );
      return {
        path,
        sessions,
        engagedSessions: Math.round(sessions * (0.45 + rng.next() * 0.35)),
        conversions: Math.round(sessions * (0.01 + rng.next() * 0.05)),
      };
    });
  }

  async inspectUrl(
    _token: string,
    input: { siteUrl: string; inspectionUrl: string },
  ): Promise<UrlInspectionResult> {
    const rng = makeRng(input.siteUrl, "inspect", input.inspectionUrl, "v1");
    const roll = rng.next();
    const indexed = roll < 0.7;
    const excluded = !indexed && roll < 0.85;
    const canonicalOther = indexed && rng.chance(0.15);
    const crawled = new Date(this.now().getTime() - rng.int(1, 20) * DAY_MS);
    return {
      verdict: indexed ? "PASS" : excluded ? "NEUTRAL" : "FAIL",
      coverageState: indexed
        ? "Submitted and indexed"
        : excluded
          ? "Excluded by 'noindex' tag"
          : "Crawled - currently not indexed",
      indexingState: indexed ? "INDEXING_ALLOWED" : excluded ? "BLOCKED_BY_META_TAG" : null,
      robotsTxtState: "ALLOWED",
      pageFetchState: "SUCCESSFUL",
      lastCrawlTime: crawled.toISOString(),
      googleCanonical: canonicalOther
        ? `${new URL(input.inspectionUrl).origin}/`
        : input.inspectionUrl,
      userCanonical: input.inspectionUrl,
      mobileVerdict: rng.chance(0.9) ? "PASS" : "FAIL",
      richResultsVerdict: rng.chance(0.4) ? "PASS" : null,
      richResultTypes: rng.chance(0.4) ? ["Breadcrumbs"] : [],
    };
  }

  async revoke(): Promise<void> {}
}
