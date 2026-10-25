import { describe, expect, it } from "vitest";
import { describeReviews } from "./report-reviews";
import type { ReportReviewsInput } from "./report-model";

const base: ReportReviewsInput = {
  businessName: "Bright Dental",
  city: "Austin",
  checkedOn: "2026-03-30",
  ratingTenths: 43,
  reviewCount: 1200,
  ratingChangeTenths: 2,
  newInPeriod: 6,
  lowInPeriod: 1,
  latest: [],
};

describe("describeReviews", () => {
  it("writes the rating, the change and the new reviews", () => {
    expect(describeReviews(base)).toEqual([
      "Bright Dental in Austin has an average rating of 4.3 out of 5 from 1,200 reviews (checked on 2026-03-30). The rating is up 0.2 since the start of the period.",
      "6 reviews were published in this period, 1 with 1 or 2 stars.",
    ]);
  });

  it("copes with no city, no change, one review and no low reviews", () => {
    const lines = describeReviews({
      ...base,
      city: null,
      ratingChangeTenths: null,
      newInPeriod: 1,
      lowInPeriod: 0,
    });
    expect(lines[0]).toBe(
      "Bright Dental has an average rating of 4.3 out of 5 from 1,200 reviews (checked on 2026-03-30).",
    );
    expect(lines[1]).toBe("1 review was published in this period.");
    expect(describeReviews({ ...base, ratingChangeTenths: -1 })[0]).toContain("down 0.1");
  });
});
