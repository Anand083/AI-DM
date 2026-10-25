import { AUDIT_ISSUE_SEVERITY, type AuditIssueCode } from "@/server/audit/issue-codes";
import type { AuditIssueFound, AuditPageResult, AuditStatus } from "../../types";
import { arr, int, num, obj, str } from "./shared";

/**
 * Which on-page check from DataForSEO (a true flag on a page) becomes which issue of ours.
 * Names come from the vendor documentation and must be confirmed with a Sandbox crawl
 * (see scripts/dataforseo-check.ts).
 */
export const CHECK_TO_ISSUE: Record<string, AuditIssueCode> = {
  no_title: "missing_title",
  title_too_long: "title_too_long",
  duplicate_title: "duplicate_title",
  no_description: "missing_meta_description",
  duplicate_description: "duplicate_meta_description",
  no_h1_tag: "missing_h1",
  is_4xx_code: "broken_link_4xx",
  is_5xx_code: "server_error_5xx",
  redirect_chain: "redirect_chain",
  high_loading_time: "slow_page",
  large_page_size: "large_image",
  no_image_alt: "missing_alt_text",
  is_http: "no_https",
  https_to_http_links: "mixed_content",
  low_content_rate: "thin_content",
  low_character_count: "thin_content",
  is_orphan_page: "orphan_page",
  has_micromarkup_errors: "invalid_structured_data",
  duplicate_content: "duplicate_content",
};

export function mapAuditStatus(summary: unknown): AuditStatus {
  const s = obj(summary);
  const status = obj(s.crawl_status);
  const max = int(status.max_crawl_pages);
  const crawled = int(status.pages_crawled);
  if (str(s.crawl_progress) === "finished") return { status: "completed", progress: 100 };
  return {
    status: crawled > 0 ? "running" : "queued",
    progress: max > 0 ? Math.min(99, Math.round((crawled / max) * 100)) : 0,
  };
}

const ms = (v: unknown) => {
  const n = num(v);
  return n === null ? null : Math.round(n);
};

/** One page from `on_page/pages` to a page result and its issues. */
export function mapAuditPage(raw: unknown): { page: AuditPageResult; issues: AuditIssueFound[] } {
  const p = obj(raw);
  const url = str(p.url);
  const checks = obj(p.checks);
  const issues: AuditIssueFound[] = [];
  const seen = new Set<AuditIssueCode>();
  const add = (code: AuditIssueCode) => {
    if (seen.has(code)) return;
    seen.add(code);
    issues.push({ code, severity: AUDIT_ISSUE_SEVERITY[code], url });
  };
  for (const [check, code] of Object.entries(CHECK_TO_ISSUE)) if (checks[check] === true) add(code);
  if (arr(obj(obj(p.meta).htags).h1).length > 1) add("multiple_h1");
  const timing = obj(p.page_timing);
  const cls = num(timing.cumulative_layout_shift);
  return {
    page: {
      url,
      statusCode: int(p.status_code),
      title: str(obj(p.meta).title) || null,
      loadTimeMs: ms(timing.duration_time) ?? 0,
      wordCount: int(obj(obj(p.meta).content).plain_text_word_count),
      issueCount: issues.length,
      lcpMs: ms(timing.largest_contentful_paint),
      cls: cls === null ? null : Math.round(cls * 1000),
      inpMs: null,
      lastModified: null,
      inlinks: num(p.inbound_links_count) === null ? null : int(p.inbound_links_count),
    },
    issues,
  };
}

/** Site-wide checks from the crawl summary (`domain_info.checks`). */
export function mapSiteIssues(domain: string, summary: unknown): AuditIssueFound[] {
  const checks = obj(obj(obj(summary).domain_info).checks);
  const url = `https://${domain}/`;
  const issues: AuditIssueFound[] = [];
  if (checks.sitemap === false)
    issues.push({ code: "missing_sitemap", severity: AUDIT_ISSUE_SEVERITY.missing_sitemap, url });
  return issues;
}
