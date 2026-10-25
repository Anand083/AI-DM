export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/analytics.readonly",
] as const;

export type GoogleTokens = {
  accessToken: string;
  /** Only given the first time a person agrees. Needed to get new access tokens later. */
  refreshToken: string | null;
  expiresAt: Date;
  scopes: string[];
  accountEmail: string | null;
};

export type SearchSite = { siteUrl: string; permissionLevel: string };
export type Ga4Property = { propertyId: string; displayName: string };

/** One day of Search Console numbers. `ctr` is between 0 and 1. */
export type SearchDay = {
  date: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

/** One day of Google Analytics numbers. */
export type AnalyticsDay = { date: string; sessions: number; conversions: number };

export const BREAKDOWN_DIMENSIONS = ["QUERY", "PAGE", "COUNTRY", "DEVICE"] as const;
export type BreakdownDimension = (typeof BREAKDOWN_DIMENSIONS)[number];

/** One row of a Search Console top list. `key` is the query, page URL, country code or device. */
export type SearchBreakdownRow = {
  key: string;
  clicks: number;
  impressions: number;
  position: number;
};

/** One landing page from Google Analytics. */
export type AnalyticsPageRow = {
  path: string;
  sessions: number;
  engagedSessions: number;
  conversions: number;
};

/** What Google's URL Inspection says about one page of a verified Search Console site. */
export type UrlInspectionResult = {
  /** PASS (on Google), FAIL (not on Google), NEUTRAL (excluded on purpose) or PARTIAL / UNSPECIFIED. */
  verdict: string;
  /** Google's own words, for example "Submitted and indexed". */
  coverageState: string;
  indexingState: string | null;
  robotsTxtState: string | null;
  pageFetchState: string | null;
  /** ISO time of the last Google crawl, if any. */
  lastCrawlTime: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
  mobileVerdict: string | null;
  richResultsVerdict: string | null;
  richResultTypes: string[];
};

/**
 * The person took back access, the token is not valid any more, or Google refused the request.
 * `needsReconnect` means asking Google again will not help: the person must connect again.
 */
export class GoogleAuthError extends Error {
  constructor(
    message: string,
    readonly needsReconnect: boolean,
  ) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

/** A problem that may go away by itself (Google is busy or down). Worth a retry later. */
export class GoogleTemporaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleTemporaryError";
  }
}

export interface GoogleProvider {
  readonly name: "mock" | "google";
  /** The Google page the person is sent to. They come back to `redirectUri` with `code` and `state`. */
  buildAuthUrl(input: { state: string; redirectUri: string }): string;
  exchangeCode(input: { code: string; redirectUri: string }): Promise<GoogleTokens>;
  /** Gets a new access token. Throws GoogleAuthError with `needsReconnect` when access was taken back. */
  refresh(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }>;
  listSearchConsoleSites(accessToken: string): Promise<SearchSite[]>;
  listGa4Properties(accessToken: string): Promise<Ga4Property[]>;
  getSearchConsoleDaily(
    accessToken: string,
    input: { siteUrl: string; startDate: string; endDate: string },
  ): Promise<SearchDay[]>;
  getGa4Daily(
    accessToken: string,
    input: { propertyId: string; startDate: string; endDate: string },
  ): Promise<AnalyticsDay[]>;
  getSearchBreakdown(
    accessToken: string,
    input: {
      siteUrl: string;
      startDate: string;
      endDate: string;
      dimension: BreakdownDimension;
      limit: number;
    },
  ): Promise<SearchBreakdownRow[]>;
  getGa4Pages(
    accessToken: string,
    input: { propertyId: string; startDate: string; endDate: string; limit: number },
  ): Promise<AnalyticsPageRow[]>;
  inspectUrl(
    accessToken: string,
    input: { siteUrl: string; inspectionUrl: string },
  ): Promise<UrlInspectionResult>;
  /** Tells Google to forget the token. Failing is fine: the connection is removed here anyway. */
  revoke(token: string): Promise<void>;
}
