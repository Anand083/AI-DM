import type { Metadata } from "next";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Features",
  description: "Rank tracking, site audits, keyword research, branded reports and a client portal.",
};

const FEATURES = [
  {
    title: "Rank tracking",
    text: "Add the keywords you care about. We check Google for you every day and show the position, the change over a day, a week and a month, and the page that ranks.",
  },
  {
    title: "Site audits",
    text: "Crawl a website and get a health score from 0 to 100. Each problem is explained in plain English with steps to fix it, and you can compare with the last audit.",
  },
  {
    title: "Keyword research",
    text: "Find new keywords with search volume, difficulty and cost per click. Save the good ones to a list or add them to your tracker with one click.",
  },
  {
    title: "Alerts",
    text: "Get told when a keyword drops out of the top results or reaches the first page, and when an audit finds a serious new problem. Choose the rules, and get a daily email if you like.",
  },
  {
    title: "Branded reports",
    text: "Make a PDF with your name, logo and colors. Pick what goes in, add a note for your client, and share it with a private link. Send reports automatically every week or month.",
  },
  {
    title: "Client portal",
    text: "Invite your clients to their own page, shown under your brand. They see rankings, site health and reports, and can change nothing.",
  },
  {
    title: "Your own domain",
    text: "Show the client portal on your own address, such as reports.youragency.com, on the plans that include it.",
  },
  {
    title: "Teams and roles",
    text: "Invite owners, admins and team members, each with the access they need. Turn on two-step sign in for extra safety.",
  },
] as const;

export default function FeaturesPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Everything you need to show results</h1>
      <p className="mt-2 max-w-2xl text-zinc-600 dark:text-zinc-400">
        Built for agencies that look after many clients and want one simple place to do it.
      </p>
      <ul className="mt-8 grid gap-6 md:grid-cols-2">
        {FEATURES.map((f) => (
          <li key={f.title} className="rounded-lg border border-zinc-200 p-5 dark:border-zinc-800">
            <h2 className="text-lg font-semibold">{f.title}</h2>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{f.text}</p>
          </li>
        ))}
      </ul>
      <div className="mt-10">
        <Link href="/signup" className={buttonClasses()}>
          Start your free trial
        </Link>
      </div>
    </div>
  );
}
