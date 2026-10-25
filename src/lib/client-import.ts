import { parseCsvLines } from "./keyword-import";

export const MAX_CLIENT_IMPORT_ROWS = 200;

export type ClientImportRow = {
  line: number;
  name: string;
  website: string;
  contactName: string;
  contactEmail: string;
  projectName: string;
  domain: string;
};

const HEADERS: Record<keyof Omit<ClientImportRow, "line">, string[]> = {
  name: ["client", "client name", "name", "company"],
  website: ["website", "site", "url"],
  contactName: ["contact", "contact name"],
  contactEmail: ["email", "contact email"],
  projectName: ["project", "project name"],
  domain: ["domain", "project domain"],
};
const ORDER = ["name", "website", "contactName", "contactEmail", "projectName", "domain"] as const;

/** A cell may start with an apostrophe that protects it from spreadsheet formulas. */
const clean = (v: string | undefined) => (v ?? "").trim().replace(/^'(?=[=+\-@])/, "");

/**
 * Reads a CSV of clients and, optionally, one project per row. The first row may name the
 * columns (client, website, contact name, contact email, project, domain). Without names the
 * columns come in that order. Rows with the same client name share one client.
 */
export function parseClientCsv(text: string): {
  rows: ClientImportRow[];
  problems: { line: number; message: string }[];
  truncated: boolean;
} {
  const all = parseCsvLines(text);
  const problems: { line: number; message: string }[] = [];
  if (all.length === 0) return { rows: [], problems, truncated: false };
  const first = all[0]!.cells.map((c) => c.trim().toLowerCase());
  const hasHeader = first.some((c) => HEADERS.name.includes(c));
  const col = (key: (typeof ORDER)[number]) =>
    hasHeader ? first.findIndex((c) => HEADERS[key].includes(c)) : ORDER.indexOf(key);
  const cols = Object.fromEntries(ORDER.map((k) => [k, col(k)])) as Record<
    (typeof ORDER)[number],
    number
  >;
  const data = hasHeader ? all.slice(1) : all;
  const rows: ClientImportRow[] = [];
  for (const { cells, line } of data.slice(0, MAX_CLIENT_IMPORT_ROWS)) {
    const get = (k: (typeof ORDER)[number]) => (cols[k] === -1 ? "" : clean(cells[cols[k]]));
    const row = {
      line,
      name: get("name"),
      website: get("website"),
      contactName: get("contactName"),
      contactEmail: get("contactEmail"),
      projectName: get("projectName"),
      domain: get("domain"),
    };
    if (!row.name) {
      problems.push({ line, message: "No client name on this line." });
      continue;
    }
    rows.push(row);
  }
  return { rows, problems, truncated: data.length > MAX_CLIENT_IMPORT_ROWS };
}
