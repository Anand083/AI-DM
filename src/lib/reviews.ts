/** A review is saved once. Author, stars and text together identify it. */
export function reviewKey(r: { author: string; rating: number; text: string }): string {
  const clean = (v: string) => v.trim().replace(/\s+/g, " ").toLowerCase();
  return `${clean(r.author)}|${r.rating}|${clean(r.text)}`.slice(0, 500);
}

/** 4.3 becomes 43. The rating is kept in tenths so it is always a whole number. */
export const toTenths = (rating: number) => Math.round(rating * 10);

/** 43 becomes "4.3". */
export const formatTenths = (tenths: number) => (tenths / 10).toFixed(1);

/** A review with 1 or 2 stars needs attention. */
export const isLowRating = (rating: number) => rating <= 2;

export type RatingPoint = { takenOn: string; ratingTenths: number; reviewCount: number };

/** Change of the average rating (in tenths) and of the review count between the newest two points. */
export function ratingChange(
  points: readonly RatingPoint[],
): { ratingTenths: number; reviewCount: number } | null {
  if (points.length < 2) return null;
  const sorted = [...points].sort((a, b) => a.takenOn.localeCompare(b.takenOn));
  const last = sorted[sorted.length - 1]!;
  const before = sorted[sorted.length - 2]!;
  return {
    ratingTenths: last.ratingTenths - before.ratingTenths,
    reviewCount: last.reviewCount - before.reviewCount,
  };
}

/** How many of the given ratings are 1, 2, 3, 4 and 5 stars. Index 0 is 1 star. */
export function starCounts(ratings: readonly number[]): [number, number, number, number, number] {
  const counts: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  for (const r of ratings) {
    if (r >= 1 && r <= 5) counts[Math.round(r) - 1]!++;
  }
  return counts;
}
