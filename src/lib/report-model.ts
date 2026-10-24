import type { BucketKey } from "./rank-math";

/** Sections a report can include. Phase F sections register here later. */
export const REPORT_SECTIONS = [
  { key: "summary", label: "Summary and key numbers" },
  { key: "distribution", label: "Ranking distribution" },
  { key: "movers", label: "Top movers" },
  { key: "rankings", label: "Full rankings" },
  { key: "audit", label: "Site health" },
  { key: "issues", label: "Top issues" },
  { key: "opportunities", label: "Keyword opportunities" },
  { key: "notes", label: "Notes" },
] as const;

export type ReportSectionKey = (typeof REPORT_SECTIONS)[number]["key"];
export const REPORT_SECTION_KEYS = REPORT_SECTIONS.map((s) => s.key) as ReportSectionKey[];
export const DEFAULT_SECTIONS: ReportSectionKey[] = [
  "summary",
  "distribution",
  "movers",
  "rankings",
  "audit",
  "issues",
  "opportunities",
];

export type ReportKeywordRow = {
  phrase: string;
  /** Position at the end of the period. Null means not in the top 100. */
  position: number | null;
  /** Position at the start of the period. Null means not ranking or not checked. */
  startPosition: number | null;
  /** Positive means better. Null when there is nothing to compare. */
  change: number | null;
  url: string | null;
  checked: boolean;
};

export type ReportAuditInput = {
  finishedOn: string;
  healthScore: number;
  pagesCrawled: number;
  counts: { critical: number; warning: number; notice: number };
  /** Score of the audit before this one, if any. */
  previousScore: number | null;
  issues: {
    code: string;
    title: string;
    severity: "CRITICAL" | "WARNING" | "NOTICE";
    pages: number;
    fix: string;
  }[];
};

export type ReportInput = {
  title: string;
  projectName: string;
  clientName: string;
  domain: string;
  period: { start: string; end: string; label: string };
  sections: ReportSectionKey[];
  notes: string | null;
  keywords: ReportKeywordRow[];
  audit: ReportAuditInput | null;
  generatedOn: string;
};

export type ReportKpis = {
  tracked: number;
  checked: number;
  averagePosition: number | null;
  /** Change of the average position over the period. Positive means better. */
  averageChange: number | null;
  top3: number;
  top10: number;
  visibility: number;
  improved: number;
  declined: number;
};

export type ReportModel = {
  version: 1;
  title: string;
  projectName: string;
  clientName: string;
  domain: string;
  period: { start: string; end: string; label: string };
  generatedOn: string;
  sections: ReportSectionKey[];
  kpis: ReportKpis;
  /** Short plain-English summary written by the summary provider. */
  summary: string;
  distribution: { key: BucketKey; label: string; count: number }[];
  movers: { up: ReportKeywordRow[]; down: ReportKeywordRow[] };
  rankings: ReportKeywordRow[];
  audit: ReportAuditInput | null;
  issues: ReportAuditInput["issues"];
  opportunities: ReportKeywordRow[];
  notes: string | null;
};

export const MOVERS_LIMIT = 10;
export const OPPORTUNITIES_LIMIT = 15;
export const ISSUES_LIMIT = 10;
export const RANKINGS_LIMIT = 500;
