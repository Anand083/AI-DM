import { formatTenths } from "./reviews";
import type { ReportReviewsInput } from "./report-model";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The lines of the reviews section as plain text, for the web view and the PDF. */
export function describeReviews(r: ReportReviewsInput): string[] {
  const place = r.city ? ` in ${r.city}` : "";
  const change =
    r.ratingChangeTenths === null || r.ratingChangeTenths === 0
      ? ""
      : ` The rating is ${r.ratingChangeTenths > 0 ? "up" : "down"} ${(Math.abs(r.ratingChangeTenths) / 10).toFixed(1)} since the start of the period.`;
  const lines = [
    `${r.businessName}${place} has an average rating of ${formatTenths(r.ratingTenths)} out of 5 from ${r.reviewCount.toLocaleString("en-US")} reviews (checked on ${r.checkedOn}).${change}`,
    `${plural(r.newInPeriod, "review was", "reviews were")} published in this period${r.lowInPeriod > 0 ? `, ${r.lowInPeriod} with 1 or 2 stars` : ""}.`,
  ];
  return lines;
}
