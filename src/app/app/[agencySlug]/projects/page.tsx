import type { Metadata } from "next";
import { ComingSoon } from "@/components/layout/coming-soon";
import { getPageContext } from "@/server/auth/page-context";

export const metadata: Metadata = { title: "Projects" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params;
  await getPageContext(agencySlug);
  return (
    <ComingSoon
      title="Projects"
      description="Projects (a website for a client) will be listed here."
    />
  );
}
