import type { Metadata } from "next";
import Link from "next/link";
import { getPageContext } from "@/server/auth/page-context";

export const metadata: Metadata = { title: "Help" };
export const dynamic = "force-dynamic";

type Guide = { id: string; title: string; steps: string[]; link?: { path: string; label: string } };

const GUIDES: Guide[] = [
  {
    id: "start",
    title: "Getting started",
    steps: [
      "Add a client. A client is a business you work for.",
      "Open the client and add a project. A project is one website you track.",
      "Add keywords to the project. These are the searches you want to rank for.",
      "Run a site audit, set your branding and create your first report.",
    ],
    link: { path: "/clients/new", label: "Add a client" },
  },
  {
    id: "rankings",
    title: "Tracking rankings",
    steps: [
      "Open a project and choose Rankings.",
      "Add keywords one per line. You can tag them to keep them tidy.",
      "We check Google once a day. Use Check now for a quick extra check.",
      "The table shows the position and how it changed over a day, a week and a month.",
      "Export the table to a spreadsheet with the CSV button.",
    ],
    link: { path: "/projects", label: "Open projects" },
  },
  {
    id: "audits",
    title: "Auditing a website",
    steps: [
      "Open a project and choose Audit, then Run audit.",
      "Wait a few minutes. The page shows progress by itself.",
      "Read the health score and open each problem to see why it matters and how to fix it.",
      "Turn on the monthly audit in the project settings to check every month automatically.",
    ],
  },
  {
    id: "research",
    title: "Finding new keywords",
    steps: [
      "Open Keyword research and type a topic.",
      "Filter by search volume, difficulty or intent.",
      "Save good ideas to a list, or add them straight to a project.",
    ],
    link: { path: "/research", label: "Keyword research" },
  },
  {
    id: "reports",
    title: "Sending reports",
    steps: [
      "Open Reports and choose New report.",
      "Pick the project, the dates and what to include. Add a note for your client if you like.",
      "When it is ready, download the PDF or make a private link to share. Links stop working on the date you choose.",
      "Use Schedules to email a report every week or month.",
    ],
    link: { path: "/reports/new", label: "Create a report" },
  },
  {
    id: "branding",
    title: "Your branding",
    steps: [
      "Open Branding and set your name, logo and colors.",
      "Reports, the client portal and client emails use them. Your clients never see our name.",
    ],
    link: { path: "/branding", label: "Open branding" },
  },
  {
    id: "clients",
    title: "Giving clients access",
    steps: [
      "Open a client and find Client access.",
      "Enter their email and send the invitation. The link works for 7 days.",
      "They see their own websites, rankings and reports, and cannot change anything.",
    ],
    link: { path: "/clients", label: "Open clients" },
  },
  {
    id: "team",
    title: "Your team",
    steps: [
      "Open Team to invite people. Owners and admins manage the account, members do the daily work.",
      "Only owners can see billing and delete the agency.",
    ],
    link: { path: "/team", label: "Open team" },
  },
  {
    id: "billing",
    title: "Plans, limits and billing",
    steps: [
      "Usage shows how much of each limit you have used this month.",
      "Billing lets owners choose or change a plan and see invoices.",
      "If your trial ends or a payment fails, your data stays visible but new checks and reports pause until you pay.",
    ],
    link: { path: "/usage", label: "See usage" },
  },
  {
    id: "safety",
    title: "Staying safe",
    steps: [
      "Turn on two-step sign in from Security in the top right menu.",
      "Use Settings to download all your data, or to delete the agency.",
    ],
  },
];

export default async function HelpPage({ params }: { params: Promise<{ agencySlug: string }> }) {
  const { agencySlug } = await params;
  await getPageContext(agencySlug);
  const base = `/app/${agencySlug}`;
  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Help</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Short guides for the things you do most. Still stuck?{" "}
          <Link href="/contact" className="underline underline-offset-4">
            Contact us
          </Link>
          .
        </p>
      </div>
      <nav
        aria-label="Guides"
        className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
      >
        <ul className="grid gap-1 text-sm sm:grid-cols-2">
          {GUIDES.map((g) => (
            <li key={g.id}>
              <a href={`#${g.id}`} className="underline-offset-4 hover:underline">
                {g.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {GUIDES.map((g) => (
        <section
          key={g.id}
          id={g.id}
          aria-labelledby={`${g.id}-h`}
          className="scroll-mt-20 space-y-3"
        >
          <h2 id={`${g.id}-h`} className="text-lg font-semibold">
            {g.title}
          </h2>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm">
            {g.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {g.link ? (
            <Link href={`${base}${g.link.path}`} className="text-sm underline underline-offset-4">
              {g.link.label}
            </Link>
          ) : null}
        </section>
      ))}
    </div>
  );
}
