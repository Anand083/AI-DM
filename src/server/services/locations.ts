import "server-only";
import { assertFeatureAvailable } from "./feature-status";
import { z } from "zod";
import {
  LISTING_SOURCES,
  MAX_LOCATIONS,
  compareListing,
  consistencyScore,
  type ListingComparison,
} from "@/lib/local";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { enqueueListingChecks, enqueueLocalRanks } from "@/server/jobs/enqueue";
import { logActivity } from "./activity";
import {
  ConflictError,
  ForbiddenError,
  LimitExceededError,
  NotFoundError,
  ValidationError,
} from "./errors";
import { getProject } from "./projects";
import { parseInput } from "./validation";

const day = (d: Date) => d.toISOString().slice(0, 10);

function requireView(ctx: TenantContext): void {
  if (ctx.role === "CLIENT" || !can(ctx.role, "data.view")) throw new ForbiddenError();
}
function requireEdit(ctx: TenantContext): void {
  if (!can(ctx.role, "content.edit")) throw new ForbiddenError();
}

export const locationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Enter the name of the place.")
    .max(80, "Keep the name under 80 characters."),
  city: z.string().trim().min(2, "Enter the city.").max(80, "Keep the city under 80 characters."),
  address: z
    .string()
    .trim()
    .min(5, "Enter the full address.")
    .max(200, "Keep the address under 200 characters."),
  phone: z
    .string()
    .trim()
    .min(5, "Enter the phone number.")
    .max(30, "Keep the phone number under 30 characters.")
    .regex(/^[0-9+()\-.\s]+$/, "Use only numbers and + ( ) - . in the phone number.")
    .refine(
      (v) => v.replace(/\D/g, "").length >= 7,
      "Enter a phone number with at least 7 digits.",
    ),
});

export async function createLocation(ctx: TenantContext, projectId: string, raw: unknown) {
  requireEdit(ctx);
  const input = parseInput(locationSchema, raw);
  await getProject(ctx, projectId);
  const base = { agencyId: ctx.agencyId, projectId };
  if ((await db.location.count({ where: base })) >= MAX_LOCATIONS) {
    throw new LimitExceededError(`A project can have up to ${MAX_LOCATIONS} locations.`);
  }
  if (await db.location.findFirst({ where: { ...base, name: input.name }, select: { id: true } })) {
    throw new ConflictError("A location with that name already exists.");
  }
  const created = await db.location.create({ data: { ...base, ...input }, select: { id: true } });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "location.created",
    targetType: "Location",
    targetId: created.id,
    metadata: { projectId },
  });
  return created;
}

export async function updateLocation(
  ctx: TenantContext,
  projectId: string,
  locationId: string,
  raw: unknown,
) {
  requireEdit(ctx);
  const input = parseInput(locationSchema, raw);
  await getProject(ctx, projectId);
  const base = { agencyId: ctx.agencyId, projectId };
  const clash = await db.location.findFirst({
    where: { ...base, name: input.name, id: { not: locationId } },
    select: { id: true },
  });
  if (clash) throw new ConflictError("A location with that name already exists.");
  const result = await db.location.updateMany({ where: { id: locationId, ...base }, data: input });
  if (result.count === 0) throw new NotFoundError("Location not found.");
  // The saved listing results were compared with the old details, so they are old news now.
  await db.listingCheck.deleteMany({ where: { ...base, locationId } });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "location.updated",
    targetType: "Location",
    targetId: locationId,
    metadata: { projectId },
  });
}

export async function deleteLocation(ctx: TenantContext, projectId: string, locationId: string) {
  if (!can(ctx.role, "content.delete")) throw new ForbiddenError();
  await getProject(ctx, projectId);
  const result = await db.location.deleteMany({
    where: { id: locationId, agencyId: ctx.agencyId, projectId },
  });
  if (result.count === 0) throw new NotFoundError("Location not found.");
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "location.deleted",
    targetType: "Location",
    targetId: locationId,
  });
}

async function requestJob(
  ctx: TenantContext,
  projectId: string,
  kind: "ranks" | "listings",
  now: Date,
) {
  if (!can(ctx.role, "tools.run")) throw new ForbiddenError();
  if (kind === "listings") assertFeatureAvailable("listings");
  await getProject(ctx, projectId);
  const base = { agencyId: ctx.agencyId, projectId };
  if ((await db.location.count({ where: base })) === 0) {
    throw new ValidationError("Add a location first.");
  }
  if (kind === "ranks" && (await db.keyword.count({ where: base })) === 0) {
    throw new ValidationError("Add some keywords first.");
  }
  const date = day(now);
  const data = { agencyId: ctx.agencyId, projectId, date };
  const queued =
    kind === "ranks" ? await enqueueLocalRanks(data) : await enqueueListingChecks(data);
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: kind === "ranks" ? "location.ranks_requested" : "location.listings_requested",
    targetType: "Project",
    targetId: projectId,
    metadata: {},
  });
  return { queued };
}

/** Asks the worker to check where the keywords rank from each location. */
export const requestLocalRanks = (ctx: TenantContext, projectId: string, now = new Date()) =>
  requestJob(ctx, projectId, "ranks", now);

/** Asks the worker to look up what directories show for each location. */
export const requestListingCheck = (ctx: TenantContext, projectId: string, now = new Date()) =>
  requestJob(ctx, projectId, "listings", now);

export type LocationView = {
  id: string;
  name: string;
  city: string;
  address: string;
  phone: string;
  listings: {
    source: string;
    comparison: ListingComparison;
    shown: { name: string | null; address: string | null; phone: string | null };
    url: string | null;
  }[];
  listingsCheckedOn: string | null;
  /** Share of found listings with the right details. Null before the first check. */
  score: number | null;
};

/** Locations with their listing results and a table of local positions (latest and change). */
export async function getLocalOverview(ctx: TenantContext, projectId: string) {
  requireView(ctx);
  await getProject(ctx, projectId);
  const base = { agencyId: ctx.agencyId, projectId };
  const [locations, listings] = await Promise.all([
    db.location.findMany({
      where: base,
      select: { id: true, name: true, city: true, address: true, phone: true },
      orderBy: { name: "asc" },
      take: MAX_LOCATIONS,
    }),
    db.listingCheck.findMany({
      where: base,
      select: {
        locationId: true,
        source: true,
        found: true,
        name: true,
        address: true,
        phone: true,
        url: true,
        checkedOn: true,
        provider: true,
      },
      take: MAX_LOCATIONS * LISTING_SOURCES.length,
    }),
  ]);

  const views: LocationView[] = locations.map((l) => {
    const rows = listings.filter((x) => x.locationId === l.id);
    const mapped = LISTING_SOURCES.flatMap((source) => {
      const row = rows.find((r) => r.source === source);
      return row
        ? [
            {
              source,
              comparison: compareListing(l, row),
              shown: { name: row.name, address: row.address, phone: row.phone },
              url: row.url,
            },
          ]
        : [];
    });
    const newest = rows.reduce<Date | null>(
      (m, r) => (!m || r.checkedOn > m ? r.checkedOn : m),
      null,
    );
    return {
      id: l.id,
      name: l.name,
      city: l.city,
      address: l.address,
      phone: l.phone,
      listings: mapped,
      listingsCheckedOn: newest ? day(newest) : null,
      score: consistencyScore(mapped.map((m) => m.comparison)),
    };
  });

  // Local positions: the newest day per location, with the day before it for the change.
  const newestRank = await db.localRank.findFirst({
    where: base,
    select: { date: true, provider: true },
    orderBy: { date: "desc" },
  });
  let ranks: {
    on: string | null;
    sample: boolean;
    rows: {
      phrase: string;
      byLocation: Record<string, { position: number | null; change: number | null }>;
    }[];
  } = { on: null, sample: false, rows: [] };
  if (newestRank) {
    const dates = await db.localRank.findMany({
      where: base,
      select: { date: true },
      distinct: ["date"],
      orderBy: { date: "desc" },
      take: 2,
    });
    const found = await db.localRank.findMany({
      where: { ...base, date: { in: dates.map((d) => d.date) } },
      select: {
        locationId: true,
        date: true,
        position: true,
        keyword: { select: { phrase: true } },
      },
      take: 2 * MAX_LOCATIONS * 50,
    });
    const phrases = [...new Set(found.map((f) => f.keyword.phrase))].sort();
    const latest = dates[0]!.date.getTime();
    ranks = {
      on: day(newestRank.date),
      sample: newestRank.provider === "mock",
      rows: phrases.map((phrase) => {
        const byLocation: Record<string, { position: number | null; change: number | null }> = {};
        for (const l of locations) {
          const now = found.find(
            (f) =>
              f.locationId === l.id && f.keyword.phrase === phrase && f.date.getTime() === latest,
          );
          const before = found.find(
            (f) =>
              f.locationId === l.id && f.keyword.phrase === phrase && f.date.getTime() !== latest,
          );
          if (!now) continue;
          byLocation[l.id] = {
            position: now.position,
            change:
              before && now.position !== null && before.position !== null
                ? before.position - now.position
                : null,
          };
        }
        return { phrase, byLocation };
      }),
    };
  }
  return {
    locations: views,
    ranks,
    listingsSample: listings.some((l) => l.provider === "mock"),
  };
}
