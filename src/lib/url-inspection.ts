export type InspectionView = {
  status: "indexed" | "excluded" | "not-indexed" | "unknown";
  headline: string;
  notes: string[];
};

type Row = {
  verdict: string;
  coverageState: string;
  googleCanonical: string | null;
  userCanonical: string | null;
  mobileVerdict: string | null;
  richVerdict: string | null;
  richTypes: readonly string[];
  robotsTxtState: string | null;
  lastCrawlTime: Date | string | null;
};

/** Google's answer in plain English: one headline and the things worth acting on. */
export function describeInspection(row: Row): InspectionView {
  const status =
    row.verdict === "PASS"
      ? "indexed"
      : row.verdict === "NEUTRAL"
        ? "excluded"
        : row.verdict === "FAIL"
          ? "not-indexed"
          : "unknown";
  const headline =
    status === "indexed"
      ? "On Google"
      : status === "excluded"
        ? "Left out of Google on purpose"
        : status === "not-indexed"
          ? "Not on Google"
          : "Google gave no clear answer";
  const notes = [`Google says: ${row.coverageState}.`];
  if (row.googleCanonical && row.userCanonical && row.googleCanonical !== row.userCanonical) {
    notes.push(`Google picked a different main address: ${row.googleCanonical}.`);
  }
  if (row.robotsTxtState === "DISALLOWED") notes.push("robots.txt blocks this page.");
  if (row.mobileVerdict === "FAIL") notes.push("The page is hard to use on a phone.");
  if (row.richVerdict === "FAIL") notes.push("The structured data has errors.");
  if (row.richVerdict === "PASS" && row.richTypes.length > 0) {
    notes.push(`Rich results found: ${row.richTypes.join(", ")}.`);
  }
  if (row.lastCrawlTime) {
    const when = new Date(row.lastCrawlTime).toISOString().slice(0, 10);
    notes.push(`Last visited by Google on ${when}.`);
  }
  return { status, headline, notes };
}

/**
 * Checks the address belongs to the project's website (the same domain or one of its
 * subdomains) and returns it cleaned. Returns null when it does not.
 */
export function cleanInspectionUrl(input: string, projectDomain: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const own = projectDomain.toLowerCase().replace(/^www\./, "");
  if (host !== own && !host.endsWith(`.${own}`)) return null;
  url.hash = "";
  return url.toString().slice(0, 2000);
}
