import type { AuditSeverity } from "@/server/providers/seo/types";

/**
 * Site audit issue codes with their severity. Step 11 adds titles, "why it matters" and
 * "how to fix" text on top of this list. The mock audit provider uses these codes.
 */
export const AUDIT_ISSUE_SEVERITY = {
  missing_title: "CRITICAL",
  duplicate_title: "WARNING",
  title_too_long: "NOTICE",
  missing_meta_description: "WARNING",
  duplicate_meta_description: "NOTICE",
  missing_h1: "WARNING",
  multiple_h1: "NOTICE",
  broken_link_4xx: "CRITICAL",
  server_error_5xx: "CRITICAL",
  redirect_chain: "WARNING",
  slow_page: "WARNING",
  large_image: "NOTICE",
  missing_alt_text: "NOTICE",
  no_https: "CRITICAL",
  mixed_content: "WARNING",
  noindex_page: "WARNING",
  missing_canonical: "NOTICE",
  thin_content: "WARNING",
  missing_structured_data: "NOTICE",
  not_mobile_friendly: "CRITICAL",
  missing_sitemap: "WARNING",
  robots_blocking: "CRITICAL",
  orphan_page: "NOTICE",
  duplicate_content: "WARNING",
  poor_lcp: "WARNING",
  poor_cls: "WARNING",
  poor_inp: "WARNING",
  invalid_structured_data: "WARNING",
  sitemap_errors: "WARNING",
} as const satisfies Record<string, AuditSeverity>;

export type AuditIssueCode = keyof typeof AUDIT_ISSUE_SEVERITY;
export const AUDIT_ISSUE_CODES = Object.keys(AUDIT_ISSUE_SEVERITY) as AuditIssueCode[];
