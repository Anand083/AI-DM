import {
  AUDIT_ISSUE_CODES,
  AUDIT_ISSUE_SEVERITY,
  type AuditIssueCode,
} from "@/server/audit/issue-codes";
import { ProviderError } from "../errors";
import type { AuditIssueFound, AuditPageResult, AuditResult, AuditStatus } from "../types";
import { makeRng } from "./prng";

/**
 * The mock audit keeps no state. Everything it needs is inside the task id, so the web
 * app and the worker (separate processes) agree on the same audit.
 *   mock-audit.<startedAtMs>.<maxPages>.<domain as base64url>
 */
export function makeAuditTaskId(domain: string, maxPages: number, startedAt: Date): string {
  return `mock-audit.${startedAt.getTime()}.${maxPages}.${Buffer.from(domain).toString("base64url")}`;
}

export function parseAuditTaskId(taskId: string): {
  domain: string;
  maxPages: number;
  startedAt: Date;
} {
  const parts = taskId.split(".");
  if (parts.length !== 4 || parts[0] !== "mock-audit") {
    throw new ProviderError(`Unknown audit task: ${taskId}`, false, "UNKNOWN_TASK");
  }
  const startedMs = Number(parts[1]);
  const maxPages = Number(parts[2]);
  if (!Number.isFinite(startedMs) || !Number.isFinite(maxPages)) {
    throw new ProviderError(`Unknown audit task: ${taskId}`, false, "UNKNOWN_TASK");
  }
  return {
    domain: Buffer.from(parts[3]!, "base64url").toString("utf8"),
    maxPages,
    startedAt: new Date(startedMs),
  };
}

/** Queued for the first 10% of the time, then running, then completed. */
export function auditStatusAt(startedAt: Date, now: Date, auditSeconds: number): AuditStatus {
  const total = auditSeconds * 1000;
  const elapsed = Math.max(0, now.getTime() - startedAt.getTime());
  if (total <= 0 || elapsed >= total) return { status: "completed", progress: 100 };
  if (elapsed < total * 0.1) return { status: "queued", progress: 0 };
  return { status: "running", progress: Math.min(99, Math.floor((elapsed / total) * 100)) };
}

const WORDS = [
  "services",
  "about",
  "contact",
  "blog",
  "pricing",
  "products",
  "team",
  "faq",
  "careers",
  "news",
  "guide",
  "locations",
  "reviews",
  "support",
  "case-studies",
];

export function buildAuditResult(domain: string, maxPages: number, startedAt: Date): AuditResult {
  const day = Math.floor(startedAt.getTime() / 86_400_000);
  const rng = makeRng(domain, "audit", day);
  const pageCount = Math.max(1, Math.min(maxPages, rng.int(20, 300)));
  const https = !rng.chance(0.03);
  const origin = `${https ? "https" : "http"}://${domain}`;

  const pages: AuditPageResult[] = [];
  const issues: AuditIssueFound[] = [];

  for (let i = 0; i < pageCount; i++) {
    const url = i === 0 ? `${origin}/` : `${origin}/${rng.pick(WORDS)}/${rng.pick(WORDS)}-${i}`;
    const statusRoll = rng.next();
    const statusCode =
      i === 0
        ? 200
        : statusRoll < 0.03
          ? 404
          : statusRoll < 0.04
            ? 500
            : statusRoll < 0.06
              ? 301
              : 200;
    const titleMissing = rng.chance(0.04);
    const loadTimeMs = Math.max(150, Math.round(Math.exp(rng.normal(6.9, 0.55))));
    const wordCount = rng.int(40, 2600);
    const found: AuditIssueCode[] = [];

    if (statusCode === 404) found.push("broken_link_4xx");
    if (statusCode === 500) found.push("server_error_5xx");
    if (statusCode === 301 && rng.chance(0.4)) found.push("redirect_chain");
    if (statusCode === 200 || statusCode === 301) {
      if (titleMissing) found.push("missing_title");
      else if (rng.chance(0.06)) found.push("duplicate_title");
      else if (rng.chance(0.08)) found.push("title_too_long");
      if (rng.chance(0.1)) found.push("missing_meta_description");
      else if (rng.chance(0.05)) found.push("duplicate_meta_description");
      if (rng.chance(0.05)) found.push("missing_h1");
      else if (rng.chance(0.04)) found.push("multiple_h1");
      if (loadTimeMs > 3000) found.push("slow_page");
      if (rng.chance(0.08)) found.push("large_image");
      if (rng.chance(0.12)) found.push("missing_alt_text");
      if (https && rng.chance(0.02)) found.push("mixed_content");
      if (rng.chance(0.02)) found.push("noindex_page");
      if (rng.chance(0.1)) found.push("missing_canonical");
      if (wordCount < 200) found.push("thin_content");
      if (rng.chance(0.3)) found.push("missing_structured_data");
      if (rng.chance(0.02)) found.push("not_mobile_friendly");
      if (i > 0 && rng.chance(0.03)) found.push("orphan_page");
    }
    for (const code of found) issues.push({ code, severity: AUDIT_ISSUE_SEVERITY[code], url });
    pages.push({
      url,
      statusCode,
      title: titleMissing ? null : `${rng.pick(WORDS)} | ${domain}`,
      loadTimeMs,
      wordCount,
      issueCount: found.length,
    });
  }

  // Problems with the whole site.
  const siteIssues: AuditIssueCode[] = [];
  if (!https) siteIssues.push("no_https");
  if (rng.chance(0.15)) siteIssues.push("missing_sitemap");
  if (rng.chance(0.04)) siteIssues.push("robots_blocking");
  for (const code of siteIssues) {
    issues.push({ code, severity: AUDIT_ISSUE_SEVERITY[code], url: `${origin}/` });
    pages[0]!.issueCount += 1;
  }

  return { pagesCrawled: pages.length, pages, issues };
}

/** Exported so tests can check every code is used by the mock at least once over many sites. */
export { AUDIT_ISSUE_CODES };
