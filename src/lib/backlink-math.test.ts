import { describe, expect, it } from "vitest";
import {
  isSnapshotDue,
  keywordSet,
  lossSeverity,
  snapshotChange,
  suspiciousReasons,
} from "./backlink-math";

const keywords = keywordSet(["Best Plumber", "  drain   cleaning "]);

describe("suspiciousReasons", () => {
  it("passes a normal link", () => {
    expect(
      suspiciousReasons(
        { sourceDomain: "news.example.com", anchor: "read more", sourceRating: 40 },
        keywords,
      ),
    ).toEqual([]);
  });

  it("flags spammy endings, very low ratings and exact keyword anchors", () => {
    expect(
      suspiciousReasons(
        { sourceDomain: "cheap-links.XYZ", anchor: "x", sourceRating: 50 },
        keywords,
      ),
    ).toEqual(["spammy_tld"]);
    expect(
      suspiciousReasons({ sourceDomain: "a.com", anchor: "x", sourceRating: 5 }, keywords),
    ).toEqual(["low_rating"]);
    expect(
      suspiciousReasons(
        { sourceDomain: "a.com", anchor: "best plumber", sourceRating: 50 },
        keywords,
      ),
    ).toEqual(["exact_anchor"]);
    expect(
      suspiciousReasons(
        { sourceDomain: "a.com", anchor: "Drain Cleaning", sourceRating: 50 },
        keywords,
      ),
    ).toEqual(["exact_anchor"]);
  });

  it("can give several reasons at once, and ignores empty anchors", () => {
    expect(
      suspiciousReasons(
        { sourceDomain: "spam.top", anchor: "best plumber", sourceRating: 1 },
        keywords,
      ),
    ).toEqual(["spammy_tld", "low_rating", "exact_anchor"]);
    expect(
      suspiciousReasons({ sourceDomain: "a.com", anchor: " ", sourceRating: 50 }, keywordSet([""])),
    ).toEqual([]);
  });
});

describe("lossSeverity", () => {
  it("needs at least 5 links and 5 percent", () => {
    expect(lossSeverity(4, 20)).toBeNull();
    expect(lossSeverity(5, 200)).toBeNull();
    expect(lossSeverity(10, 200)).toBe("WARNING");
    expect(lossSeverity(5, 100)).toBe("WARNING");
  });

  it("is critical at 20 percent and ignores empty history", () => {
    expect(lossSeverity(40, 200)).toBe("CRITICAL");
    expect(lossSeverity(39, 200)).toBe("WARNING");
    expect(lossSeverity(10, 0)).toBeNull();
  });
});

describe("snapshotChange", () => {
  it("compares the newest two snapshots, whatever the order", () => {
    expect(
      snapshotChange([{ takenOn: "2026-03-01", totalBacklinks: 10, referringDomains: 4 }]),
    ).toBeNull();
    expect(
      snapshotChange([
        { takenOn: "2026-03-15", totalBacklinks: 130, referringDomains: 40 },
        { takenOn: "2026-03-01", totalBacklinks: 100, referringDomains: 45 },
        { takenOn: "2026-02-01", totalBacklinks: 50, referringDomains: 10 },
      ]),
    ).toEqual({ backlinks: 30, referringDomains: -5 });
  });
});

describe("isSnapshotDue", () => {
  it("is due with no snapshot or after 7 days", () => {
    expect(isSnapshotDue(null, "2026-03-10")).toBe(true);
    expect(isSnapshotDue("2026-03-03", "2026-03-10")).toBe(true);
    expect(isSnapshotDue("2026-03-04", "2026-03-10")).toBe(false);
    expect(isSnapshotDue("2026-03-10", "2026-03-10")).toBe(false);
  });
});
