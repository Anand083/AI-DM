import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { brandCssVars } from "@/lib/brand";
import { loadPortalBrand } from "@/server/services/portal-brand";

type Props = { params: Promise<{ agencySlug: string }>; children: React.ReactNode };

/** Everything under /portal uses the agency's name, colours and icon. The platform name never appears. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const slug = (await params).agencySlug;
  const brand = await loadPortalBrand(slug);
  const name = brand?.displayName ?? "Not found";
  return {
    title: { default: name, template: `%s | ${name}` },
    description: `Your reports from ${name}`,
    icons: { icon: `/portal/${slug}/logo?v=${brand?.logoVersion ?? "0"}` },
    robots: { index: false, follow: false },
  };
}

export default async function PortalLayout({ params, children }: Props) {
  const brand = await loadPortalBrand((await params).agencySlug);
  if (!brand) notFound();
  return (
    <div style={brandCssVars(brand) as React.CSSProperties} className="min-h-screen">
      {children}
    </div>
  );
}
