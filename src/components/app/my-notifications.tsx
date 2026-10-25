"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { setMyNotificationsAction } from "@/app/app/[agencySlug]/settings/actions";
import { FormMessage } from "@/components/auth/field";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";

/** One person's own email choices. They apply only to this person. */
export function MyNotifications({
  agencySlug,
  digest,
  taskAssigned,
  digestAvailable,
}: {
  agencySlug: string;
  digest: boolean;
  taskAssigned: boolean;
  /** The agency has the daily summary turned on. */
  digestAvailable: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [on, setOn] = useState(digest);
  const [assigned, setAssigned] = useState(taskAssigned);
  const [error, setError] = useState<string | null>(null);

  async function change(key: "digest" | "taskAssigned", next: boolean) {
    const set = key === "digest" ? setOn : setAssigned;
    set(next);
    setError(null);
    const result = await setMyNotificationsAction(agencySlug, { [key]: next });
    if (!result.ok) {
      set(!next);
      setError(result.error);
      return;
    }
    toast("success", "Your email choice is saved.");
    router.refresh();
  }

  return (
    <section aria-labelledby="my-notifications" className="space-y-3">
      <h2 id="my-notifications" className="text-lg font-semibold">
        My notifications
      </h2>
      <div className="flex items-center gap-2">
        <input
          id="my-digest"
          type="checkbox"
          className="size-4"
          checked={on}
          onChange={(e) => change("digest", e.target.checked)}
        />
        <Label htmlFor="my-digest">Email me the morning summary of new alerts</Label>
      </div>
      <div className="flex items-center gap-2">
        <input
          id="my-task-assigned"
          type="checkbox"
          className="size-4"
          checked={assigned}
          onChange={(e) => change("taskAssigned", e.target.checked)}
        />
        <Label htmlFor="my-task-assigned">Email me when someone gives me a task</Label>
      </div>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        {digestAvailable
          ? "Only owners and admins get this summary."
          : "The agency has the morning summary turned off. Your choice is kept for when it is turned on."}
      </p>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
    </section>
  );
}
