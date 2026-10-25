export type ChecklistCounts = {
  clients: number;
  projects: number;
  keywords: number;
  audits: number;
  /** True once the agency has saved its branding. */
  branded: boolean;
  reports: number;
};

export type ChecklistItem = {
  key: "client" | "project" | "keywords" | "audit" | "branding" | "report";
  label: string;
  hint: string;
  done: boolean;
  href: string;
};

/**
 * The first steps for a new agency, in the order that makes sense. `base` is `/app/<slug>`.
 * A step is done when the agency has done it at least once. Nothing is stored: the state is
 * worked out from the data, so it can never be out of date.
 */
export function buildChecklist(counts: ChecklistCounts, base: string): ChecklistItem[] {
  return [
    {
      key: "client",
      label: "Add your first client",
      hint: "A client is a business you work for.",
      done: counts.clients > 0,
      href: `${base}/clients/new`,
    },
    {
      key: "project",
      label: "Add a website to track",
      hint: "Open a client and add the website you work on.",
      done: counts.projects > 0,
      href: `${base}/clients`,
    },
    {
      key: "keywords",
      label: "Add keywords to track",
      hint: "These are the searches you want to rank for.",
      done: counts.keywords > 0,
      href: `${base}/projects`,
    },
    {
      key: "audit",
      label: "Run a site audit",
      hint: "Find problems that hold the website back.",
      done: counts.audits > 0,
      href: `${base}/projects`,
    },
    {
      key: "branding",
      label: "Set up your branding",
      hint: "Your name, logo and colors on reports.",
      done: counts.branded,
      href: `${base}/branding`,
    },
    {
      key: "report",
      label: "Create a report",
      hint: "A PDF your client can read.",
      done: counts.reports > 0,
      href: `${base}/reports/new`,
    },
  ];
}

export function checklistProgress(items: ChecklistItem[]): {
  done: number;
  total: number;
  complete: boolean;
  next: ChecklistItem | null;
} {
  const done = items.filter((i) => i.done).length;
  return {
    done,
    total: items.length,
    complete: done === items.length,
    next: items.find((i) => !i.done) ?? null,
  };
}
