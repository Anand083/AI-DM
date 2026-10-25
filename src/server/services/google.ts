import "server-only";
import { z } from "zod";
import {
  addDays,
  previousPeriod,
  sumAnalytics,
  sumSearch,
  type AnalyticsDayRow,
  type SearchTotals,
} from "@/lib/google-metrics";
import { getEnv } from "@/env";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { open, seal } from "@/server/crypto/secret-box";
import { db } from "@/server/db/client";
import { enqueueGoogleSync } from "@/server/jobs/enqueue";
import { logger } from "@/server/logger";
import { getGoogleProvider } from "@/server/providers/google";
import type { Ga4Property, SearchSite } from "@/server/providers/google/types";
import { logActivity } from "./activity";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { getProject } from "./projects";
import { parseInput } from "./validation";

const day = (d: Date) => d.toISOString().slice(0, 10);
const dayDate = (value: string) => new Date(`${value}T00:00:00Z`);
const PERIOD_DAYS = 28;

function requireView(ctx: TenantContext): void {
  if (ctx.role === "CLIENT" || !can(ctx.role, "data.view")) throw new ForbiddenError();
}
function requireEdit(ctx: TenantContext): void {
  if (!can(ctx.role, "content.edit")) throw new ForbiddenError();
}

/** Where Google sends the person back to. It must be listed in the Google Cloud project. */
export const googleRedirectUri = () => `${getEnv().APP_URL.replace(/\/$/, "")}/api/google/callback`;

/** The connection of a project, without any token. */
export async function getGoogleStatus(ctx: TenantContext, projectId: string) {
  requireView(ctx);
  await getProject(ctx, projectId);
  const c = await db.googleConnection.findFirst({
    where: { agencyId: ctx.agencyId, projectId },
    select: {
      accountEmail: true,
      status: true,
      lastError: true,
      lastSyncedOn: true,
      gscSite: true,
      ga4PropertyId: true,
      ga4PropertyName: true,
      availableSites: true,
      availableProperties: true,
    },
  });
  return {
    provider: getEnv().GOOGLE_PROVIDER,
    connection: c
      ? {
          accountEmail: c.accountEmail,
          status: c.status,
          lastError: c.lastError,
          lastSyncedOn: c.lastSyncedOn ? day(c.lastSyncedOn) : null,
          gscSite: c.gscSite,
          ga4PropertyId: c.ga4PropertyId,
          ga4PropertyName: c.ga4PropertyName,
          sites: c.availableSites as SearchSite[],
          properties: c.availableProperties as Ga4Property[],
        }
      : null,
  };
}

/** Checks the person may connect and returns the Google address to send them to. */
export async function beginGoogleConnect(
  ctx: TenantContext & { slug: string },
  projectId: string,
  state: string,
): Promise<string> {
  requireEdit(ctx);
  await getProject(ctx, projectId);
  return getGoogleProvider().buildAuthUrl({ state, redirectUri: googleRedirectUri() });
}

/**
 * Finishes connecting after Google sends the person back: swaps the code for tokens, reads the
 * sites and properties the account can see, and saves everything with the tokens encrypted.
 * Connecting again keeps the choices made before when they are still on the list.
 */
export async function completeGoogleConnect(
  ctx: TenantContext,
  projectId: string,
  code: string,
): Promise<void> {
  requireEdit(ctx);
  await getProject(ctx, projectId);
  const provider = getGoogleProvider();
  const secret = getEnv().ENCRYPTION_KEY;
  const tokens = await provider.exchangeCode({ code, redirectUri: googleRedirectUri() });
  const [sites, properties] = await Promise.all([
    provider.listSearchConsoleSites(tokens.accessToken),
    provider.listGa4Properties(tokens.accessToken),
  ]);
  const existing = await db.googleConnection.findFirst({
    where: { agencyId: ctx.agencyId, projectId },
    select: {
      id: true,
      gscSite: true,
      ga4PropertyId: true,
      ga4PropertyName: true,
      refreshTokenEnc: true,
    },
  });
  const gscSite =
    existing?.gscSite && sites.some((s) => s.siteUrl === existing.gscSite)
      ? existing.gscSite
      : null;
  const property = properties.find((p) => p.propertyId === existing?.ga4PropertyId);
  const data = {
    accountEmail: tokens.accountEmail,
    accessTokenEnc: seal(tokens.accessToken, secret),
    // Google only sends a refresh token the first time; keep the old one if none came.
    refreshTokenEnc: tokens.refreshToken
      ? seal(tokens.refreshToken, secret)
      : (existing?.refreshTokenEnc ?? null),
    accessExpiresAt: tokens.expiresAt,
    scopes: tokens.scopes,
    availableSites: sites,
    availableProperties: properties,
    gscSite,
    ga4PropertyId: property?.propertyId ?? null,
    ga4PropertyName: property?.displayName ?? null,
    status: "ACTIVE",
    lastError: null,
    connectedById: ctx.userId,
  };
  if (existing) {
    await db.googleConnection.updateMany({
      where: { id: existing.id, agencyId: ctx.agencyId },
      data,
    });
  } else {
    await db.googleConnection.create({ data: { ...data, agencyId: ctx.agencyId, projectId } });
  }
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "google.connected",
    targetType: "Project",
    targetId: projectId,
    metadata: { account: tokens.accountEmail },
  });
}

export const choiceSchema = z.object({
  gscSite: z.string().max(500).nullable(),
  ga4PropertyId: z.string().max(100).nullable(),
});

/** Saves which Search Console site and which GA4 property to read. Only values from the list are accepted. */
export async function chooseGoogleSources(ctx: TenantContext, projectId: string, raw: unknown) {
  requireEdit(ctx);
  const input = parseInput(choiceSchema, raw);
  await getProject(ctx, projectId);
  const c = await db.googleConnection.findFirst({
    where: { agencyId: ctx.agencyId, projectId },
    select: { id: true, availableSites: true, availableProperties: true },
  });
  if (!c) throw new NotFoundError("Google is not connected for this project.");
  const sites = c.availableSites as SearchSite[];
  const properties = c.availableProperties as Ga4Property[];
  if (input.gscSite && !sites.some((s) => s.siteUrl === input.gscSite)) {
    throw new ValidationError("Choose a site from the list.", {
      gscSite: "Choose a site from the list.",
    });
  }
  const property = properties.find((p) => p.propertyId === input.ga4PropertyId);
  if (input.ga4PropertyId && !property) {
    throw new ValidationError("Choose a property from the list.", {
      ga4PropertyId: "Choose a property from the list.",
    });
  }
  if (!input.gscSite && !input.ga4PropertyId) {
    throw new ValidationError(
      "Choose a Search Console site, a Google Analytics property, or both.",
    );
  }
  await db.googleConnection.updateMany({
    where: { id: c.id, agencyId: ctx.agencyId },
    data: {
      gscSite: input.gscSite,
      ga4PropertyId: input.ga4PropertyId,
      ga4PropertyName: property?.displayName ?? null,
      // A new choice means new data: read the full history again.
      lastSyncedOn: null,
    },
  });
  await db.searchConsoleDay.deleteMany({ where: { agencyId: ctx.agencyId, projectId } });
  await db.ga4Day.deleteMany({ where: { agencyId: ctx.agencyId, projectId } });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "google.sources_chosen",
    targetType: "Project",
    targetId: projectId,
    metadata: { gscSite: input.gscSite, ga4PropertyId: input.ga4PropertyId },
  });
  await enqueueGoogleSync({ agencyId: ctx.agencyId, projectId, date: day(new Date()) });
}

/** Asks the worker to read the latest numbers now (once a day is enough). */
export async function requestGoogleSync(ctx: TenantContext, projectId: string) {
  if (!can(ctx.role, "tools.run")) throw new ForbiddenError();
  await getProject(ctx, projectId);
  const c = await db.googleConnection.findFirst({
    where: { agencyId: ctx.agencyId, projectId },
    select: { status: true, gscSite: true, ga4PropertyId: true, lastSyncedOn: true },
  });
  if (!c) throw new ValidationError("Connect Google first.");
  if (c.status !== "ACTIVE") throw new ValidationError("Connect Google again first.");
  if (!c.gscSite && !c.ga4PropertyId) throw new ValidationError("Choose what to read first.");
  const today = day(new Date());
  if (c.lastSyncedOn && day(c.lastSyncedOn) === today) {
    throw new ConflictError("The numbers were already updated today.");
  }
  const queued = await enqueueGoogleSync({ agencyId: ctx.agencyId, projectId, date: today });
  return { queued };
}

/** Removes the connection and the saved numbers. Telling Google to forget the token is best effort. */
export async function disconnectGoogle(ctx: TenantContext, projectId: string) {
  requireEdit(ctx);
  await getProject(ctx, projectId);
  const c = await db.googleConnection.findFirst({
    where: { agencyId: ctx.agencyId, projectId },
    select: { id: true, accessTokenEnc: true, refreshTokenEnc: true },
  });
  if (!c) throw new NotFoundError("Google is not connected for this project.");
  const secret = getEnv().ENCRYPTION_KEY;
  try {
    await getGoogleProvider().revoke(open(c.refreshTokenEnc ?? c.accessTokenEnc, secret));
  } catch (error) {
    logger.warn({ err: error, projectId }, "could not revoke the Google token");
  }
  await db.searchConsoleDay.deleteMany({ where: { agencyId: ctx.agencyId, projectId } });
  await db.ga4Day.deleteMany({ where: { agencyId: ctx.agencyId, projectId } });
  await db.googleConnection.deleteMany({ where: { id: c.id, agencyId: ctx.agencyId } });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "google.disconnected",
    targetType: "Project",
    targetId: projectId,
    metadata: {},
  });
}

export type PeriodNumbers<T> = { range: { start: string; end: string }; now: T; before: T };

const span = (r: { start: string; end: string }) => ({
  gte: dayDate(r.start),
  lte: dayDate(r.end),
});

/** Search Console sums for a range and for the range of the same length before it. */
export async function loadSearchNumbers(
  agencyId: string,
  projectId: string,
  range: { start: string; end: string },
): Promise<PeriodNumbers<SearchTotals> & { hasData: boolean }> {
  const select = { clicks: true, impressions: true, positionTenths: true } as const;
  const [now, before] = await Promise.all([
    db.searchConsoleDay.findMany({
      where: { agencyId, projectId, date: span(range) },
      select,
      take: 400,
    }),
    db.searchConsoleDay.findMany({
      where: { agencyId, projectId, date: span(previousPeriod(range.start, range.end)) },
      select,
      take: 400,
    }),
  ]);
  return { range, now: sumSearch(now), before: sumSearch(before), hasData: now.length > 0 };
}

/** Google Analytics sums for a range and for the range of the same length before it. */
export async function loadGaNumbers(
  agencyId: string,
  projectId: string,
  range: { start: string; end: string },
): Promise<PeriodNumbers<AnalyticsDayRow> & { hasData: boolean }> {
  const select = { sessions: true, conversions: true } as const;
  const [now, before] = await Promise.all([
    db.ga4Day.findMany({ where: { agencyId, projectId, date: span(range) }, select, take: 400 }),
    db.ga4Day.findMany({
      where: { agencyId, projectId, date: span(previousPeriod(range.start, range.end)) },
      select,
      take: 400,
    }),
  ]);
  return { range, now: sumAnalytics(now), before: sumAnalytics(before), hasData: now.length > 0 };
}

/** Both sources for one fixed range (used by reports). */
export async function loadAnalyticsNumbers(
  agencyId: string,
  projectId: string,
  range: { start: string; end: string },
) {
  const [search, analytics] = await Promise.all([
    loadSearchNumbers(agencyId, projectId, range),
    loadGaNumbers(agencyId, projectId, range),
  ]);
  return { search, analytics, hasSearch: search.hasData, hasAnalytics: analytics.hasData };
}

/**
 * What the Analytics tab shows. Each source covers the 28 days up to its own newest day (Search
 * Console is a day behind Analytics), against the 28 days before, plus a table of recent days.
 */
export async function getAnalyticsOverview(ctx: TenantContext, projectId: string) {
  requireView(ctx);
  await getProject(ctx, projectId);
  const base = { agencyId: ctx.agencyId, projectId };
  const [lastSearch, lastGa] = await Promise.all([
    db.searchConsoleDay.findFirst({
      where: base,
      select: { date: true },
      orderBy: { date: "desc" },
    }),
    db.ga4Day.findFirst({ where: base, select: { date: true }, orderBy: { date: "desc" } }),
  ]);
  if (!lastSearch && !lastGa) return null;
  const rangeEnding = (end: string) => ({ start: addDays(end, -(PERIOD_DAYS - 1)), end });
  const recentFrom = (end: string) => ({ gte: dayDate(addDays(end, -13)), lte: dayDate(end) });

  const search = lastSearch
    ? await loadSearchNumbers(ctx.agencyId, projectId, rangeEnding(day(lastSearch.date)))
    : null;
  const analytics = lastGa
    ? await loadGaNumbers(ctx.agencyId, projectId, rangeEnding(day(lastGa.date)))
    : null;
  const [searchDays, gaDays] = await Promise.all([
    lastSearch
      ? db.searchConsoleDay.findMany({
          where: { ...base, date: recentFrom(day(lastSearch.date)) },
          select: { date: true, clicks: true, impressions: true, positionTenths: true },
          orderBy: { date: "desc" },
          take: 14,
        })
      : [],
    lastGa
      ? db.ga4Day.findMany({
          where: { ...base, date: recentFrom(day(lastGa.date)) },
          select: { date: true, sessions: true, conversions: true },
          orderBy: { date: "desc" },
          take: 14,
        })
      : [],
  ]);
  return {
    search,
    analytics,
    searchDays: searchDays.map((d) => ({ ...d, date: day(d.date) })),
    analyticsDays: gaDays.map((d) => ({ ...d, date: day(d.date) })),
  };
}
