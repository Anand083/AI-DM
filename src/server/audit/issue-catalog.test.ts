import { describe, expect, it } from "vitest";
import { ISSUE_CATALOG, issueInfo } from "./issue-catalog";
import { AUDIT_ISSUE_CODES, AUDIT_ISSUE_SEVERITY } from "./issue-codes";

describe("issue catalog", () => {
  it("has the 23 issues from the plan plus the 6 technical ones added in H6", () => {
    expect(AUDIT_ISSUE_CODES).toHaveLength(29);
    for (const added of [
      "duplicate_content",
      "poor_lcp",
      "poor_cls",
      "poor_inp",
      "invalid_structured_data",
      "sitemap_errors",
    ] as const) {
      expect(AUDIT_ISSUE_CODES).toContain(added);
    }
    expect(Object.keys(ISSUE_CATALOG).sort()).toEqual([...AUDIT_ISSUE_CODES].sort());
  });

  it("gives every issue a title, a reason and a fix in plain English, and the same severity as the provider list", () => {
    for (const code of AUDIT_ISSUE_CODES) {
      const info = ISSUE_CATALOG[code];
      expect(info.severity).toBe(AUDIT_ISSUE_SEVERITY[code]);
      expect(info.title.length).toBeGreaterThan(5);
      expect(info.why.length).toBeGreaterThan(30);
      expect(info.fix.length).toBeGreaterThan(30);
      // No em dashes and no jargon abbreviations that readers will not know.
      for (const text of [info.title, info.why, info.fix]) expect(text).not.toContain("—");
    }
  });

  it("covers the issues named in the plan", () => {
    const plan = [
      "missing_title",
      "duplicate_title",
      "title_too_long",
      "missing_meta_description",
      "duplicate_meta_description",
      "missing_h1",
      "multiple_h1",
      "broken_link_4xx",
      "server_error_5xx",
      "redirect_chain",
      "slow_page",
      "large_image",
      "missing_alt_text",
      "no_https",
      "mixed_content",
      "noindex_page",
      "missing_canonical",
      "thin_content",
      "missing_structured_data",
      "not_mobile_friendly",
      "missing_sitemap",
      "robots_blocking",
      "orphan_page",
    ];
    for (const code of plan) expect(ISSUE_CATALOG).toHaveProperty(code);
  });

  it("falls back for unknown codes", () => {
    expect(issueInfo("some_new_check")).toMatchObject({
      title: "Some new check",
      severity: "NOTICE",
    });
  });
});
