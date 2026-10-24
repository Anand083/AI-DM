import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { ToastProvider } from "@/components/ui/toast";
import { getEnv } from "@/env";
import { getPageContext } from "@/server/auth/page-context";
import { listUserAgencies } from "@/server/auth/tenant-context";
import { getAgency } from "@/server/services/agency";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ agencySlug: string }>;
}): Promise<Metadata> {
  const { agencySlug } = await params;
  const { ctx } = await getPageContext(agencySlug);
  const agency = await getAgency(ctx);
  return { title: { default: agency.name, template: `%s | ${agency.name}` } };
}

export default async function AgencyLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ agencySlug: string }>;
}) {
  const { agencySlug } = await params;
  const { user, ctx } = await getPageContext(agencySlug);
  const [agency, agencies] = await Promise.all([getAgency(ctx), listUserAgencies(user.id)]);

  return (
    <ToastProvider>
      <AppShell
        agencySlug={agencySlug}
        agencyName={agency.name}
        agencies={agencies}
        role={ctx.role}
        user={{ name: user.name, email: user.email }}
        showDemoBadge={getEnv().SEO_PROVIDER === "mock"}
      >
        {children}
      </AppShell>
    </ToastProvider>
  );
}
