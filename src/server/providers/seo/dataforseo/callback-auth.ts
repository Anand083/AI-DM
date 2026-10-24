import { createHash, timingSafeEqual } from "node:crypto";

/** Compares the secret from a callback URL with ours without leaking timing. */
export function secretMatches(given: string | null | undefined, expected: string): boolean {
  if (!given || !expected) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
