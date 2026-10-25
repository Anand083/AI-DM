import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SubscriptionBanner } from "@/components/app/subscription-banner";
import { AppShell } from "@/components/layout/app-shell";
import { ToastProvider } from "@/components/ui/toast";
import { getEnv } from "@/env";
import { getPageContext } from "@/server/auth/page-context";
import { listUserAgencies } from "@/server/auth/tenant-context";
import { getAgency } from "@/server/services/agency";
import { getBellData } from "@/server/services/alerts";
import { can } from "@/server/auth/permissions";
import { getSubscriptionNotice } from "@/server/services/billing";
import { getBranding } from "@/server/services/branding";

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
  const [agency, agencies, bell, branding, notice] = await Promise.all([
    getAgency(ctx),
    listUserAgencies(user.id),
    getBellData(ctx),
    getBranding(ctx),
    getSubscriptionNotice(ctx),
  ]);

  return (
    <ToastProvider>
      <AppShell
        agencySlug={agencySlug}
        agencyName={agency.name}
        agencies={agencies}
        role={ctx.role}
        user={{ name: user.name, email: user.email }}
        showDemoBadge={getEnv().SEO_PROVIDER === "mock"}
        logoUrl={
          branding.hasLogo
            ? `/app/${agencySlug}/branding/logo?v=${branding.logoVersion ?? "1"}`
            : null
        }
        banner={
          <SubscriptionBanner
            billingHref={can(ctx.role, "billing.manage") ? `/app/${agencySlug}/billing` : null}
            notice={
              notice?.kind === "past_due"
                ? {
                    kind: "past_due",
                    graceEnds: new Intl.DateTimeFormat("en-US", {
                      dateStyle: "long",
                      timeZone: agency.timezone,
                    }).format(notice.graceEndsAt),
                  }
                : notice
            }
          />
        }
        bell={{
          unread: bell.unread,
          recent: bell.recent.map((a) => ({
            id: a.id,
            title: a.title,
            severity: a.severity,
            read: a.readAt !== null,
          })),
        }}
      >
        {children}
      </AppShell>
    </ToastProvider>
  );
}
