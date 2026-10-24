/** Paths that already mean something in the app, so an agency cannot take them as a slug. */
export const RESERVED_SLUGS = new Set([
  "app",
  "admin",
  "portal",
  "api",
  "login",
  "signup",
  "invite",
  "r",
  "www",
  "static",
  "assets",
  "onboarding",
  "settings",
  "pricing",
  "features",
  "help",
  "support",
]);

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

/** Turns a name into a slug suggestion: "Acme Digital!" becomes "acme-digital". */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

/** Returns an error message, or null when the slug is fine. */
export function slugProblem(slug: string): string | null {
  if (slug.length < 3) return "Use at least 3 characters.";
  if (slug.length > 40) return "Use 40 characters or fewer.";
  if (!SLUG_PATTERN.test(slug)) return "Use only lowercase letters, numbers and hyphens.";
  if (slug.includes("--")) return "Do not use two hyphens in a row.";
  if (RESERVED_SLUGS.has(slug)) return "This address is reserved. Please choose another.";
  return null;
}
