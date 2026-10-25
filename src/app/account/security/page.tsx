import type { Metadata } from "next";
import Link from "next/link";
import { SessionsList } from "@/components/auth/sessions-list";
import { TwoFactorPanel } from "@/components/auth/security-panel";
import { ToastProvider } from "@/components/ui/toast";
import { getCurrentSessionId, requireUser } from "@/server/auth/session";
import { listUserAgencies } from "@/server/auth/tenant-context";
import { listSessions } from "@/server/services/sessions";

export const metadata: Metadata = { title: "Security" };
export const dynamic = "force-dynamic";

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const [sessions, agencies] = await Promise.all([
    listSessions(user.id, await getCurrentSessionId()),
    listUserAgencies(user.id),
  ]);
  const when = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: user.timezone,
    }).format(d);
  return (
    <ToastProvider>
      <main className="mx-auto max-w-2xl space-y-8 px-4 py-10">
        <div>
          <Link
            href={agencies[0] ? `/app/${agencies[0].slug}` : "/app"}
            className="text-sm underline underline-offset-4"
          >
            Back to the app
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">Security</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{user.email}</p>
        </div>
        <TwoFactorPanel enabled={user.twoFactorEnabled === true} required={sp.required === "1"} />
        <SessionsList
          sessions={sessions.map((s) => ({
            id: s.id,
            device: s.device,
            ip: s.ip,
            created: when(s.createdAt),
            current: s.current,
          }))}
        />
      </main>
    </ToastProvider>
  );
}
