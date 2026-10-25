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
  { key: "backlinks", label: "Backlinks" },
  { key: "competitors", label: "Competitors" },
  { key: "ai", label: "AI visibility" },
  { key: "reviews", label: "Local reviews" },
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

export type ReportBacklinkRow = {
  domain: string;
  anchor: string;
  dofollow: boolean;
  rating: number;
};

export type ReportBacklinksInput = {
  /** Day of the check these numbers come from. */
  checkedOn: string;
  totalBacklinks: number;
  referringDomains: number;
  domainRating: number;
  dofollowPercent: number;
  /** Change since the start of the period. Null when there was no earlier check. */
  totalChange: number | null;
  domainsChange: number | null;
  newInPeriod: number;
  lostInPeriod: number;
  suspicious: number;
  /** The strongest new and lost links, at most 5 each. */
  topNew: ReportBacklinkRow[];
  topLost: ReportBacklinkRow[];
};

export type ReportCompetitorsInput = {
  /** Keywords that were compared. */
  compared: number;
  competitors: {
    domain: string;
    inTop10: number;
    theyAreAhead: number;
    youAreAhead: number;
    averagePosition: number | null;
  }[];
  /** The biggest keyword gaps, at most 10. */
  gap: { keyword: string; competitor: string; position: number; volume: number }[];
};

export type ReportAiInput = {
  checkedOn: string;
  /** Answers in the latest check. */
  total: number;
  mentionRate: number;
  /** Mention rate of the check before, if there was one. */
  previousRate: number | null;
  citedRate: number;
  shareOfVoice: number | null;
  averagePosition: number | null;
  engines: { engine: string; label: string; total: number; mentionRate: number }[];
  /** Each question with the number of engines that named the brand. At most 10. */
  prompts: { text: string; mentioned: number; engines: number }[];
};

export type ReportReviewsInput = {
  businessName: string;
  city: string | null;
  checkedOn: string;
  /** Average rating in tenths (43 is 4.3). */
  ratingTenths: number;
  reviewCount: number;
  /** Change of the rating since the start of the period, in tenths. Null without an earlier check. */
  ratingChangeTenths: number | null;
  /** Reviews published during the period, and how many of them have 1 or 2 stars. */
  newInPeriod: number;
  lowInPeriod: number;
  /** The newest reviews, at most 3. */
  latest: { author: string; rating: number; text: string; publishedAt: string }[];
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
  /** Optional so older callers and saved reports keep working. */
  backlinks?: ReportBacklinksInput | null;
  competitors?: ReportCompetitorsInput | null;
  ai?: ReportAiInput | null;
  reviews?: ReportReviewsInput | null;
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
  /** Missing in reports made before the backlink section existed. */
  backlinks?: ReportBacklinksInput | null;
  /** Missing in reports made before the competitor section existed. */
  competitors?: ReportCompetitorsInput | null;
  /** Missing in reports made before the AI visibility section existed. */
  ai?: ReportAiInput | null;
  /** Missing in reports made before the reviews section existed. */
  reviews?: ReportReviewsInput | null;
  issues: ReportAuditInput["issues"];
  opportunities: ReportKeywordRow[];
  notes: string | null;
};

export const MOVERS_LIMIT = 10;
export const OPPORTUNITIES_LIMIT = 15;
export const ISSUES_LIMIT = 10;
export const RANKINGS_LIMIT = 500;
