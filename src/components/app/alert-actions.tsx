"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import {
  markAlertReadAction,
  markAllAlertsReadAction,
} from "@/app/app/[agencySlug]/alerts/actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export function MarkReadButton({
  agencySlug,
  alertId,
  title,
}: {
  agencySlug: string;
  alertId: string;
  title: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      className="h-9"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await markAlertReadAction(agencySlug, alertId);
          router.refresh();
        })
      }
    >
      Mark as read<span className="sr-only">: {title}</span>
    </Button>
  );
}

export function MarkAllReadButton({
  agencySlug,
  disabled,
}: {
  agencySlug: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending || disabled}
      onClick={() =>
        start(async () => {
          const result = await markAllAlertsReadAction(agencySlug);
          if (result.ok) toast("success", "All alerts marked as read.");
          router.refresh();
        })
      }
    >
      Mark all as read
    </Button>
  );
}
