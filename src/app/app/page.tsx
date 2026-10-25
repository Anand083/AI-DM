import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import {
  hasSuspendedAgency,
  listUserAgencies,
  listUserPortals,
} from "@/server/auth/tenant-context";

export const dynamic = "force-dynamic";

/** Sends people to their agency, or to onboarding if they have none yet. */
export default async function AppIndex() {
  const user = await requireUser();
  const agencies = await listUserAgencies(user.id);
  if (agencies.length === 0) {
    // Client users have no team agency. Send them to their portal.
    const portals = await listUserPortals(user.id);
    if (portals.length > 0) redirect(`/portal/${portals[0]!.slug}`);
    if (await hasSuspendedAgency(user.id)) redirect("/app/suspended");
    redirect("/app/onboarding");
  }
  redirect(`/app/${agencies[0]!.slug}`);
}
