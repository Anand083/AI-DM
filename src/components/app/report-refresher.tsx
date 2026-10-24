"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Reloads the page data every 2 seconds while a report is still being built. */
export function ReportRefresher({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(timer);
  }, [active, router]);
  return null;
}
