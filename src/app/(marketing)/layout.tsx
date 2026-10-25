import type { Metadata } from "next";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { getEnv } from "@/env";

export function generateMetadata(): Metadata {
  const name = getEnv().APP_NAME;
  return {
    title: {
      default: `${name}: SEO tools and branded reports for agencies`,
      template: `%s | ${name}`,
    },
    description:
      "Track rankings, audit websites and send branded reports to your clients, under your own name.",
  };
}

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  const appName = getEnv().APP_NAME;
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader appName={appName} />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter appName={appName} />
    </div>
  );
}
