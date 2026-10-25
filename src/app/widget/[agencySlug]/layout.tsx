import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { brandCssVars } from "@/lib/brand";
import { loadPortalBrand } from "@/server/services/portal-brand";

type Props = { params: Promise<{ agencySlug: string }>; children: React.ReactNode };

/** The widget uses the agency's name and colours. The platform name never appears. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const brand = await loadPortalBrand((await params).agencySlug);
  return {
    title: brand ? `Free website check | ${brand.displayName}` : "Not found",
    description: "Get a free check of your website.",
    robots: { index: false, follow: false },
  };
}

export default async function WidgetLayout({ params, children }: Props) {
  const brand = await loadPortalBrand((await params).agencySlug);
  if (!brand) notFound();
  return (
    <div
      style={brandCssVars(brand) as React.CSSProperties}
      className="min-h-screen bg-white text-zinc-900"
    >
      {children}
    </div>
  );
}
