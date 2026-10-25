import type { ReportBacklinksInput } from "./report-model";

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** The lines of the backlink section, as plain text. Used by the web view and the PDF. */
export function describeBacklinks(b: ReportBacklinksInput): string[] {
  const lines = [
    `${plural(b.totalBacklinks, "backlink", "backlinks")} from ${plural(b.referringDomains, "website", "websites")}. Domain rating ${b.domainRating} out of 100. ${b.dofollowPercent}% of the links pass ranking value (dofollow). Checked on ${b.checkedOn}.`,
  ];
  const moves = `In this period ${plural(b.newInPeriod, "link was", "links were")} found and ${plural(b.lostInPeriod, "link was", "links were")} lost.`;
  lines.push(
    b.totalChange === null || b.domainsChange === null
      ? moves
      : `${moves} Total backlinks changed by ${signed(b.totalChange)} and referring websites by ${signed(b.domainsChange)}.`,
  );
  if (b.suspicious > 0) {
    lines.push(
      `${plural(b.suspicious, "link looks", "links look")} suspicious and should be reviewed.`,
    );
  }
  return lines;
}
