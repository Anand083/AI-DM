import {
  GOOGLE_SCOPES,
  GoogleAuthError,
  GoogleTemporaryError,
  type AnalyticsDay,
  type Ga4Property,
  type GoogleProvider,
  type GoogleTokens,
  type SearchDay,
  type SearchSite,
} from "./types";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const SEARCH_CONSOLE = "https://www.googleapis.com/webmasters/v3";
const ANALYTICS_ADMIN = "https://analyticsadmin.googleapis.com/v1beta";
const ANALYTICS_DATA = "https://analyticsdata.googleapis.com/v1beta";

type Json = Record<string, unknown>;

/** Reads the email out of Google's id_token. It comes straight from Google over TLS, so it is trusted. */
function emailFromIdToken(idToken: unknown): string | null {
  if (typeof idToken !== "string") return null;
  try {
    const payload = JSON.parse(
      Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"),
    );
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

/** GA4 writes dates as 20260301. */
const ga4Date = (value: string) => `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;

/**
 * The real Google. It only uses plain HTTP calls (no Google library). Tests run it against a fake
 * server (msw); it is never called for real unless `GOOGLE_PROVIDER=google` is set.
 */
export class GoogleHttpProvider implements GoogleProvider {
  readonly name = "google" as const;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(
    private readonly options: {
      clientId: string;
      clientSecret: string;
      fetch?: typeof fetch;
      now?: () => Date;
    },
  ) {
    this.fetchImpl = options.fetch ?? ((...args) => fetch(...args));
    this.now = options.now ?? (() => new Date());
  }

  buildAuthUrl(input: { state: string; redirectUri: string }): string {
    const url = new URL(AUTH_URL);
    url.searchParams.set("client_id", this.options.clientId);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
    // offline + consent make Google give a refresh token every time a person connects.
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("state", input.state);
    return url.toString();
  }

  async exchangeCode(input: { code: string; redirectUri: string }): Promise<GoogleTokens> {
    const body = await this.token({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
    });
    return {
      accessToken: String(body.access_token),
      refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
      expiresAt: new Date(this.now().getTime() + Number(body.expires_in ?? 3600) * 1000),
      scopes: typeof body.scope === "string" ? body.scope.split(" ") : [],
      accountEmail: emailFromIdToken(body.id_token),
    };
  }

  async refresh(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
    const body = await this.token({ grant_type: "refresh_token", refresh_token: refreshToken });
    return {
      accessToken: String(body.access_token),
      expiresAt: new Date(this.now().getTime() + Number(body.expires_in ?? 3600) * 1000),
    };
  }

  async listSearchConsoleSites(accessToken: string): Promise<SearchSite[]> {
    const body = await this.api(accessToken, `${SEARCH_CONSOLE}/sites`);
    const entries = (body.siteEntry ?? []) as { siteUrl: string; permissionLevel: string }[];
    return entries
      .filter((e) => e.permissionLevel !== "siteUnverifiedUser")
      .map((e) => ({ siteUrl: e.siteUrl, permissionLevel: e.permissionLevel }));
  }

  async listGa4Properties(accessToken: string): Promise<Ga4Property[]> {
    const body = await this.api(accessToken, `${ANALYTICS_ADMIN}/accountSummaries?pageSize=200`);
    const accounts = (body.accountSummaries ?? []) as {
      propertySummaries?: { property: string; displayName: string }[];
    }[];
    return accounts.flatMap((a) =>
      (a.propertySummaries ?? []).map((p) => ({
        propertyId: p.property.replace(/^properties\//, ""),
        displayName: p.displayName,
      })),
    );
  }

  async getSearchConsoleDaily(
    accessToken: string,
    input: { siteUrl: string; startDate: string; endDate: string },
  ): Promise<SearchDay[]> {
    const body = await this.api(
      accessToken,
      `${SEARCH_CONSOLE}/sites/${encodeURIComponent(input.siteUrl)}/searchAnalytics/query`,
      {
        startDate: input.startDate,
        endDate: input.endDate,
        dimensions: ["date"],
        rowLimit: 1000,
        dataState: "final",
      },
    );
    const rows = (body.rows ?? []) as {
      keys: string[];
      clicks: number;
      impressions: number;
      ctr: number;
      position: number;
    }[];
    return rows.map((r) => ({
      date: r.keys[0]!,
      clicks: Math.round(r.clicks),
      impressions: Math.round(r.impressions),
      ctr: r.ctr,
      position: r.position,
    }));
  }

  async getGa4Daily(
    accessToken: string,
    input: { propertyId: string; startDate: string; endDate: string },
  ): Promise<AnalyticsDay[]> {
    const body = await this.api(
      accessToken,
      `${ANALYTICS_DATA}/properties/${encodeURIComponent(input.propertyId)}:runReport`,
      {
        dateRanges: [{ startDate: input.startDate, endDate: input.endDate }],
        dimensions: [{ name: "date" }],
        metrics: [{ name: "sessions" }, { name: "conversions" }],
        limit: 1000,
      },
    );
    const rows = (body.rows ?? []) as {
      dimensionValues: { value: string }[];
      metricValues: { value: string }[];
    }[];
    return rows.map((r) => ({
      date: ga4Date(r.dimensionValues[0]!.value),
      sessions: Math.round(Number(r.metricValues[0]!.value)),
      conversions: Math.round(Number(r.metricValues[1]!.value)),
    }));
  }

  async revoke(token: string): Promise<void> {
    await this.fetchImpl(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: "POST" });
  }

  private async token(fields: Record<string, string>): Promise<Json> {
    const res = await this.fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        ...fields,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as Json;
    if (res.ok) return body;
    const error = String(body.error ?? "");
    if (res.status >= 500 || res.status === 429) {
      throw new GoogleTemporaryError(`Google is busy (${res.status}). Try again later.`);
    }
    // invalid_grant: the code was used or expired, or the person took back access.
    throw new GoogleAuthError(
      error === "invalid_grant"
        ? "Google no longer accepts this sign-in. Connect again."
        : "Google did not accept the sign-in.",
      true,
    );
  }

  private async api(accessToken: string, url: string, post?: Json): Promise<Json> {
    const res = await this.fetchImpl(url, {
      method: post ? "POST" : "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(post ? { "content-type": "application/json" } : {}),
      },
      body: post ? JSON.stringify(post) : undefined,
    });
    if (res.ok) return (await res.json()) as Json;
    if (res.status === 401) throw new GoogleAuthError("Google access ended. Connect again.", true);
    if (res.status === 403) {
      throw new GoogleAuthError(
        "Google says this account may not read this data. Check the account and connect again.",
        true,
      );
    }
    if (res.status === 429 || res.status >= 500) {
      throw new GoogleTemporaryError(`Google is busy (${res.status}). Try again later.`);
    }
    throw new GoogleAuthError(`Google refused the request (${res.status}).`, false);
  }
}
