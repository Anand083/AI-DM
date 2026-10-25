import type { Metadata } from "next";
import Link from "next/link";
import { getEnv } from "@/env";

export const metadata: Metadata = {
  title: "About",
  description: "Why we built this and who it is for.",
};

export default function AboutPage() {
  const appName = getEnv().APP_NAME;
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">About {appName}</h1>
      <p>
        Marketing agencies spend too much time pulling numbers from many tools and turning them into
        reports. We built {appName} so you can track rankings, check websites and send clear reports
        from one place, under your own name.
      </p>
      <p>
        We keep things simple. Every screen uses plain words. Every problem we find comes with what
        to do about it. Your clients see your brand, never ours.
      </p>
      <p>
        We are a small team and we read every message.{" "}
        <Link href="/contact" className="underline underline-offset-4">
          Say hello
        </Link>
        .
      </p>
    </div>
  );
}
