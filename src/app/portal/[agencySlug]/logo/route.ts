import { initials } from "@/lib/brand";
import { readableTextOn } from "@/lib/color";
import { loadPortalBrand, readPortalIcon } from "@/server/services/portal-brand";

type Params = { params: Promise<{ agencySlug: string }> };

/** The agency logo (or initials badge) for the portal pages and the browser tab icon. */
export async function GET(_request: Request, { params }: Params): Promise<Response> {
  const brand = await loadPortalBrand((await params).agencySlug);
  if (!brand) return new Response("Not found", { status: 404 });
  const icon = await readPortalIcon(
    brand,
    initials(brand.displayName),
    readableTextOn(brand.primaryColor),
  );
  return new Response(new Uint8Array(icon.bytes), {
    headers: {
      "Content-Type": icon.contentType,
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
