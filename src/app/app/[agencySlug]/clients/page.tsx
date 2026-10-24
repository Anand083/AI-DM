import type { Metadata } from "next";
import { ComingSoon } from "@/components/layout/coming-soon";
import { getPageContext } from "@/server/auth/page-context";

export const metadata: Metadata = { title: "Clients" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params;
  await getPageContext(agencySlug);
  return (
    <ComingSoon
      title="Clients"
      description="Your clients will be listed here. You will be able to add and manage them in the next update."
    />
  );
}
