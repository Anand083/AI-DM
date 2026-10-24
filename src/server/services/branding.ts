import "server-only";
import { randomBytes } from "node:crypto";
import { DEFAULT_ACCENT, DEFAULT_PRIMARY } from "@/lib/brand";
import { brandingSchema } from "@/lib/schemas/branding";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { getStorage } from "@/server/providers/storage";
import { logActivity } from "./activity";
import { ForbiddenError } from "./errors";
import { processLogo } from "./logo";
import { parseInput } from "./validation";

export type BrandingView = {
  displayName: string;
  primaryColor: string;
  accentColor: string;
  supportEmail: string | null;
  website: string | null;
  hasLogo: boolean;
  /** Changes whenever the logo changes, so browsers fetch the new one. */
  logoVersion: string | null;
  /** False until the agency saves branding for the first time. */
  customized: boolean;
};

function requireView(ctx: TenantContext): void {
  if (ctx.role === "CLIENT" || !can(ctx.role, "data.view")) throw new ForbiddenError();
}

function requireEdit(ctx: TenantContext): void {
  if (!can(ctx.role, "branding.edit")) throw new ForbiddenError();
}

/** Branding of an agency, or sensible defaults (the agency name and our default colours). */
export async function loadBranding(agencyId: string): Promise<BrandingView> {
  const [branding, agency] = await Promise.all([
    db.branding.findFirst({ where: { agencyId } }),
    db.agency.findUniqueOrThrow({ where: { id: agencyId }, select: { name: true } }),
  ]);
  if (!branding) {
    return {
      displayName: agency.name,
      primaryColor: DEFAULT_PRIMARY,
      accentColor: DEFAULT_ACCENT,
      supportEmail: null,
      website: null,
      hasLogo: false,
      logoVersion: null,
      customized: false,
    };
  }
  return {
    displayName: branding.displayName,
    primaryColor: branding.primaryColor,
    accentColor: branding.accentColor,
    supportEmail: branding.supportEmail,
    website: branding.website,
    hasLogo: branding.logoKey !== null,
    logoVersion: branding.logoKey
      ? (branding.logoKey.split("-").pop()?.split(".")[0] ?? null)
      : null,
    customized: true,
  };
}

export async function getBranding(ctx: TenantContext): Promise<BrandingView> {
  requireView(ctx);
  return loadBranding(ctx.agencyId);
}

export async function updateBranding(ctx: TenantContext, rawInput: unknown): Promise<BrandingView> {
  requireEdit(ctx);
  const input = parseInput(brandingSchema, rawInput);
  const data = {
    displayName: input.displayName,
    primaryColor: input.primaryColor,
    accentColor: input.accentColor,
    supportEmail: input.supportEmail ?? null,
    website: input.website ?? null,
  };
  await db.branding.upsert({
    where: { agencyId: ctx.agencyId },
    create: { agencyId: ctx.agencyId, ...data },
    update: data,
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "branding.updated",
    targetType: "Branding",
    targetId: ctx.agencyId,
  });
  return loadBranding(ctx.agencyId);
}

/** Saves a new logo (checked and resized) and removes the old file. */
export async function setLogo(ctx: TenantContext, bytes: Buffer): Promise<BrandingView> {
  requireEdit(ctx);
  const logo = await processLogo(bytes);
  const storage = getStorage();
  const key = `branding/${ctx.agencyId}/logo-${randomBytes(6).toString("hex")}.${logo.extension}`;
  await storage.put(key, logo.bytes, logo.contentType);

  const existing = await db.branding.findFirst({
    where: { agencyId: ctx.agencyId },
    select: { logoKey: true },
  });
  const agency = await db.agency.findUniqueOrThrow({
    where: { id: ctx.agencyId },
    select: { name: true },
  });
  await db.branding.upsert({
    where: { agencyId: ctx.agencyId },
    create: {
      agencyId: ctx.agencyId,
      displayName: agency.name,
      logoKey: key,
      logoContentType: logo.contentType,
    },
    update: { logoKey: key, logoContentType: logo.contentType },
  });
  if (existing?.logoKey) await storage.delete(existing.logoKey);
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "branding.logo_changed",
    targetType: "Branding",
    targetId: ctx.agencyId,
  });
  return loadBranding(ctx.agencyId);
}

export async function removeLogo(ctx: TenantContext): Promise<BrandingView> {
  requireEdit(ctx);
  const existing = await db.branding.findFirst({
    where: { agencyId: ctx.agencyId },
    select: { logoKey: true },
  });
  if (existing?.logoKey) {
    await db.branding.update({
      where: { agencyId: ctx.agencyId },
      data: { logoKey: null, logoContentType: null },
    });
    await getStorage().delete(existing.logoKey);
    await logActivity({
      agencyId: ctx.agencyId,
      actorUserId: ctx.userId,
      action: "branding.logo_removed",
      targetType: "Branding",
      targetId: ctx.agencyId,
    });
  }
  return loadBranding(ctx.agencyId);
}

/** The logo file of an agency, or null. Callers must have checked that the viewer may see this agency. */
export async function readLogo(
  agencyId: string,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  const branding = await db.branding.findFirst({ where: { agencyId }, select: { logoKey: true } });
  if (!branding?.logoKey) return null;
  return getStorage().get(branding.logoKey);
}
