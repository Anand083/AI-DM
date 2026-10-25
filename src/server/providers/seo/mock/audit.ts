import {
  AUDIT_ISSUE_CODES,
  AUDIT_ISSUE_SEVERITY,
  type AuditIssueCode,
} from "@/server/audit/issue-codes";
import { MOCK_SITE_PATHS } from "@/data/mock-paths";
import { ProviderError } from "../errors";
import type {
  AuditIssueFound,
  AuditPageResult,
  AuditResult,
  AuditStatus,
  SiteDiagnostics,
} from "../types";
import { makeRng } from "./prng";

/**
 * The mock audit keeps no state. Everything it needs is inside the task id, so the web
 * app and the worker (separate processes) agree on the same audit.
 *   mock-audit.<startedAtMs>.<maxPages>.<domain as base64url>[.<excluded paths as base64url JSON>]
 */
export function makeAuditTaskId(
  domain: string,
  maxPages: number,
  startedAt: Date,
  excludePaths: readonly string[] = [],
): string {
  const base = `mock-audit.${startedAt.getTime()}.${maxPages}.${Buffer.from(domain).toString("base64url")}`;
  return excludePaths.length === 0
    ? base
    : `${base}.${Buffer.from(JSON.stringify(excludePaths)).toString("base64url")}`;
}

export function parseAuditTaskId(taskId: string): {
  domain: string;
  maxPages: number;
  startedAt: Date;
  excludePaths: string[];
} {
  const parts = taskId.split(".");
  if ((parts.length !== 4 && parts.length !== 5) || parts[0] !== "mock-audit") {
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
    excludePaths: parts[4]
      ? (JSON.parse(Buffer.from(parts[4], "base64url").toString("utf8")) as string[])
      : [],
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

const pathOf = (url: string) => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};

export function buildAuditResult(
  domain: string,
  maxPages: number,
  startedAt: Date,
  excludePaths: readonly string[] = [],
): AuditResult {
  const day = Math.floor(startedAt.getTime() / 86_400_000);
  const rng = makeRng(domain, "audit", day);
  const pageCount = Math.max(1, Math.min(maxPages, rng.int(20, 300)));
  const https = !rng.chance(0.03);
  const origin = `${https ? "https" : "http"}://${domain}`;

  const pages: AuditPageResult[] = [];
  const issues: AuditIssueFound[] = [];

  for (let i = 0; i < pageCount; i++) {
    // The first pages are the ones the sample Google data knows, so traffic and audit line up.
    const url =
      i < MOCK_SITE_PATHS.length
        ? `${origin}${MOCK_SITE_PATHS[i]}`
        : `${origin}/${rng.pick(WORDS)}/${rng.pick(WORDS)}-${i}`;
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
    const lcpMs = Math.max(400, Math.round(Math.exp(rng.normal(7.7, 0.4))));
    const cls = Math.round(Math.abs(rng.normal(0.06, 0.08)) * 1000);
    const inpMs = Math.max(30, Math.round(Math.exp(rng.normal(5.3, 0.5))));
    const ageDays = rng.chance(0.1) ? null : Math.round(Math.exp(rng.normal(5.2, 1.1)));
    const lastModified =
      ageDays === null
        ? null
        : new Date(startedAt.getTime() - ageDays * 86_400_000).toISOString().slice(0, 10);
    const inlinks =
      i === 0 ? rng.int(40, 200) : Math.max(0, Math.round(Math.exp(rng.normal(1.8, 1.1)) - 1));
    const found: AuditIssueCode[] = [];
    const details: Partial<Record<AuditIssueCode, Record<string, string | number | boolean>>> = {};

    if (statusCode === 404) found.push("broken_link_4xx");
    if (statusCode === 500) found.push("server_error_5xx");
    if (statusCode === 301 && rng.chance(0.4)) {
      found.push("redirect_chain");
      details.redirect_chain = { hops: rng.int(2, 4), finalUrl: `${origin}/` };
    }
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
      if (wordCount >= 200 && rng.chance(0.04)) {
        found.push("duplicate_content");
        details.duplicate_content = { sameAs: `${origin}/` };
      }
      if (lcpMs > 4000) found.push("poor_lcp");
      if (cls > 250) found.push("poor_cls");
      if (inpMs > 500) found.push("poor_inp");
      if (!found.includes("missing_structured_data") && rng.chance(0.04)) {
        found.push("invalid_structured_data");
        details.invalid_structured_data = { error: "Missing field: name" };
      }
    }
    for (const code of found) {
      issues.push({
        code,
        severity: AUDIT_ISSUE_SEVERITY[code],
        url,
        ...(details[code] ? { details: details[code] } : {}),
      });
    }
    pages.push({
      url,
      statusCode,
      title: titleMissing ? null : `${rng.pick(WORDS)} | ${domain}`,
      loadTimeMs,
      wordCount,
      issueCount: found.length,
      lcpMs,
      cls,
      inpMs,
      lastModified,
      inlinks,
    });
  }

  // Problems with the whole site.
  const siteIssues: AuditIssueCode[] = [];
  if (!https) siteIssues.push("no_https");
  if (rng.chance(0.15)) siteIssues.push("missing_sitemap");
  if (rng.chance(0.04)) siteIssues.push("robots_blocking");
  const sitemapFound = !siteIssues.includes("missing_sitemap");
  const sitemapBad = sitemapFound && rng.chance(0.08) ? rng.int(1, 12) : 0;
  if (sitemapBad > 0) siteIssues.push("sitemap_errors");
  for (const code of siteIssues) {
    issues.push({
      code,
      severity: AUDIT_ISSUE_SEVERITY[code],
      url: `${origin}/`,
      ...(code === "sitemap_errors" ? { details: { badUrls: sitemapBad } } : {}),
    });
    pages[0]!.issueCount += 1;
  }

  const diagnostics: SiteDiagnostics = {
    robots: {
      found: !rng.chance(0.05),
      blocksAll: siteIssues.includes("robots_blocking"),
      disallowRules: rng.int(0, 12),
      sitemapUrls: sitemapFound ? [`${origin}/sitemap.xml`] : [],
    },
    sitemap: {
      found: sitemapFound,
      urls: sitemapFound ? pages.length + rng.int(0, 20) : 0,
      badUrls: sitemapBad,
    },
  };

  // Skipped paths are not crawled (the home page always is).
  if (excludePaths.length > 0) {
    const skipped = (url: string) =>
      pathOf(url) !== "/" && excludePaths.some((prefix) => pathOf(url).startsWith(prefix));
    const keep = pages.filter((p) => !skipped(p.url));
    return {
      pagesCrawled: keep.length,
      pages: keep,
      issues: issues.filter((i) => !skipped(i.url)),
      diagnostics,
    };
  }

  return { pagesCrawled: pages.length, pages, issues, diagnostics };
}

/** Exported so tests can check every code is used by the mock at least once over many sites. */
export { AUDIT_ISSUE_CODES };
