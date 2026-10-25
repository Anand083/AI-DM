import { UNLIMITED, type PlanLimits } from "./plan-limits";

/** "$149" for whole dollars, "$49.50" otherwise. */
export function formatPlanPrice(cents: number): string {
  const dollars = cents / 100;
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(dollars) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/** How much cheaper paying for a year is than 12 months, as a whole percent. 0 when it is not cheaper. */
export function yearlySavingsPercent(monthlyCents: number, yearlyCents: number): number {
  if (monthlyCents <= 0 || yearlyCents >= monthlyCents * 12) return 0;
  return Math.round((1 - yearlyCents / (monthlyCents * 12)) * 100);
}

const count = (n: number, one: string, many: string) =>
  n === UNLIMITED ? `Unlimited ${many}` : `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** The main limits of a plan as short lines, for the pricing and billing pages. */
export function planFeatureLines(limits: PlanLimits): string[] {
  const lines = [
    count(limits.maxClients, "client", "clients"),
    count(limits.maxProjects, "website", "websites"),
    count(limits.maxKeywords, "tracked keyword", "tracked keywords"),
    count(limits.maxTeamMembers, "team member", "team members"),
    count(limits.maxClientUsers, "client login", "client logins"),
    count(limits.auditPagesPerMonth, "audit page per month", "audit pages per month"),
  ];
  if (limits.reportSchedules !== 0) {
    lines.push(count(limits.reportSchedules, "scheduled report", "scheduled reports"));
  }
  if (limits.whiteLabel) lines.push("Your own name, logo and colors");
  if (limits.customDomain) lines.push("Your own domain for the client portal");
  return lines;
}
