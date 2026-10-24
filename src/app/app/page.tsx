import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { listUserAgencies } from "@/server/auth/tenant-context";

export const dynamic = "force-dynamic";

/** Sends people to their agency, or to onboarding if they have none yet. */
export default async function AppIndex() {
  const user = await requireUser();
  const agencies = await listUserAgencies(user.id);
  if (agencies.length === 0) redirect("/app/onboarding");
  redirect(`/app/${agencies[0]!.slug}`);
}
