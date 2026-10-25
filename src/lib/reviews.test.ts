import { describe, expect, it } from "vitest";
import {
  formatTenths,
  isLowRating,
  ratingChange,
  reviewKey,
  starCounts,
  toTenths,
} from "./reviews";

describe("reviewKey", () => {
  it("ignores case and extra spaces but not the stars", () => {
    const a = reviewKey({ author: " Customer 12 ", rating: 5, text: "Great  service!" });
    expect(a).toBe(reviewKey({ author: "customer 12", rating: 5, text: "great service!" }));
    expect(a).not.toBe(reviewKey({ author: "customer 12", rating: 4, text: "great service!" }));
  });
});

describe("rating helpers", () => {
  it("keeps the rating in tenths", () => {
    expect(toTenths(4.3)).toBe(43);
    expect(toTenths(4.25)).toBe(43);
    expect(formatTenths(43)).toBe("4.3");
    expect(formatTenths(50)).toBe("5.0");
  });

  it("flags 1 and 2 stars", () => {
    expect([1, 2, 3, 4, 5].map(isLowRating)).toEqual([true, true, false, false, false]);
  });

  it("counts stars", () => {
    expect(starCounts([5, 5, 1, 3, 9, 0])).toEqual([1, 0, 1, 0, 2]);
    expect(starCounts([])).toEqual([0, 0, 0, 0, 0]);
  });
});

describe("ratingChange", () => {
  it("compares the newest two points in any order", () => {
    expect(ratingChange([{ takenOn: "2026-03-01", ratingTenths: 40, reviewCount: 10 }])).toBeNull();
    expect(
      ratingChange([
        { takenOn: "2026-03-08", ratingTenths: 43, reviewCount: 12 },
        { takenOn: "2026-03-01", ratingTenths: 45, reviewCount: 10 },
        { takenOn: "2026-02-01", ratingTenths: 30, reviewCount: 2 },
      ]),
    ).toEqual({ ratingTenths: -2, reviewCount: 2 });
  });
});
