import "server-only";
import { cache } from "react";
import { rawDb } from "@/server/db/client";
import { loadBranding, readLogo, type BrandingView } from "./branding";

/**
 * The look of an agency's portal, found by its slug. This is public on purpose: the login page
 * must show the agency's name and colours before anyone signs in. It never includes anything
 * about the platform. Returns null for unknown or inactive agencies.
 */
export const loadPortalBrand = cache(
  async (agencySlug: string): Promise<(BrandingView & { agencyId: string }) | null> => {
    const agency = await rawDb.agency.findFirst({
      where: { slug: agencySlug, status: "ACTIVE", deletedAt: null },
      select: { id: true },
    });
    if (!agency) return null;
    return { ...(await loadBranding(agency.id)), agencyId: agency.id };
  },
);

/** Escapes text for use inside an SVG. */
const esc = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The agency logo, or a round badge with the agency initials in its colours. Used as the favicon too. */
export async function readPortalIcon(
  brand: BrandingView & { agencyId: string },
  initialsText: string,
  textColor: string,
): Promise<{ bytes: Buffer; contentType: string }> {
  const logo = brand.hasLogo ? await readLogo(brand.agencyId) : null;
  if (logo) return logo;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="${esc(brand.primaryColor)}"/>` +
    `<text x="32" y="41" font-family="Arial, sans-serif" font-size="26" font-weight="700" text-anchor="middle" fill="${esc(textColor)}">${esc(initialsText)}</text></svg>`;
  return { bytes: Buffer.from(svg), contentType: "image/svg+xml" };
}
