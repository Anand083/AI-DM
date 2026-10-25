export const MAX_LOCATIONS = 10;

/** The directories a listing check looks at. */
export const LISTING_SOURCES = [
  "Google Business Profile",
  "Bing Places",
  "Apple Maps",
  "Facebook",
  "Yelp",
] as const;

export type Nap = { name: string; address: string; phone: string };
export type ListingFacts = {
  found: boolean;
  name: string | null;
  address: string | null;
  phone: string | null;
};

const ABBREVIATIONS: [RegExp, string][] = [
  [/\bstreet\b/g, "st"],
  [/\bavenue\b/g, "ave"],
  [/\broad\b/g, "rd"],
  [/\bboulevard\b/g, "blvd"],
  [/\bdrive\b/g, "dr"],
  [/\blane\b/g, "ln"],
  [/\bsuite\b/g, "ste"],
  [/\bfloor\b/g, "fl"],
  [/\bnorth\b/g, "n"],
  [/\bsouth\b/g, "s"],
  [/\beast\b/g, "e"],
  [/\bwest\b/g, "w"],
];

const squash = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Business names compare without case, punctuation or company endings such as LLC or Inc. */
export function normalizeName(name: string): string {
  return squash(name)
    .replace(/\b(llc|inc|ltd|limited|corp|corporation|co|company|pllc|pc)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Addresses compare with the usual short forms (street/st, suite/ste) and no punctuation. */
export function normalizeAddress(address: string): string {
  let a = squash(address);
  for (const [pattern, short] of ABBREVIATIONS) a = a.replace(pattern, short);
  return a.replace(/\s+/g, " ").trim();
}

/** Phone numbers compare by their last 10 digits, so +1 and brackets do not matter. */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export type ListingStatus = "match" | "differs" | "missing";
export type ListingComparison = {
  status: ListingStatus;
  wrong: readonly ("name" | "address" | "phone")[];
};

/** Does a directory show the same name, address and phone as the canonical details? */
export function compareListing(canonical: Nap, listing: ListingFacts): ListingComparison {
  if (!listing.found) return { status: "missing", wrong: [] };
  const wrong: ("name" | "address" | "phone")[] = [];
  if (normalizeName(listing.name ?? "") !== normalizeName(canonical.name)) wrong.push("name");
  if (normalizeAddress(listing.address ?? "") !== normalizeAddress(canonical.address))
    wrong.push("address");
  if (normalizePhone(listing.phone ?? "") !== normalizePhone(canonical.phone)) wrong.push("phone");
  return { status: wrong.length === 0 ? "match" : "differs", wrong };
}

/** Share of the listings that exist and show the right details, in whole percent. Null with none found. */
export function consistencyScore(results: readonly ListingComparison[]): number | null {
  const found = results.filter((r) => r.status !== "missing");
  if (found.length === 0) return null;
  return Math.round((found.filter((r) => r.status === "match").length / found.length) * 100);
}

/** A stable search location number for a city when none was chosen (mock use only). */
export function pseudoLocationCode(city: string): number {
  let h = 0;
  for (const ch of squash(city)) h = (h * 31 + ch.charCodeAt(0)) % 90_000;
  return 910_000 + h;
}
