/** Top level domains that are mostly used for throw-away and spam sites. */
export const SPAMMY_TLDS = [
  "xyz",
  "top",
  "click",
  "gq",
  "tk",
  "ml",
  "cf",
  "ga",
  "work",
  "loan",
  "men",
  "date",
  "racing",
  "download",
  "stream",
  "review",
  "icu",
  "buzz",
] as const;

/** A linking site with this rating or lower (0 to 100) is treated as very weak. */
export const LOW_RATING_MAX = 5;

export type SuspiciousReason = "spammy_tld" | "low_rating" | "exact_anchor";

export const REASON_LABELS: Record<SuspiciousReason, string> = {
  spammy_tld: "Spammy domain ending",
  low_rating: "Very low site rating",
  exact_anchor: "Anchor matches a tracked keyword",
};

const normalize = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Why a link looks suspicious. An empty list means it looks normal.
 * `keywords` are the project's tracked keywords: a link whose text is exactly one of them can look
 * like a bought link.
 */
export function suspiciousReasons(
  link: { sourceDomain: string; anchor: string; sourceRating: number },
  keywords: ReadonlySet<string>,
): SuspiciousReason[] {
  const reasons: SuspiciousReason[] = [];
  const tld = link.sourceDomain.trim().toLowerCase().split(".").pop() ?? "";
  if ((SPAMMY_TLDS as readonly string[]).includes(tld)) reasons.push("spammy_tld");
  if (link.sourceRating <= LOW_RATING_MAX) reasons.push("low_rating");
  const anchor = normalize(link.anchor);
  if (anchor && keywords.has(anchor)) reasons.push("exact_anchor");
  return reasons;
}

/** The tracked keywords in the form `suspiciousReasons` compares with. */
export function keywordSet(phrases: string[]): Set<string> {
  return new Set(phrases.map(normalize).filter(Boolean));
}

/** A big loss: at least 5 links, and at least 5% of the links we track for the project. */
export const LOSS_MIN_LINKS = 5;
export const LOSS_MIN_PERCENT = 5;
export const LOSS_CRITICAL_PERCENT = 20;

export function lossSeverity(lost: number, activeBefore: number): "WARNING" | "CRITICAL" | null {
  if (lost < LOSS_MIN_LINKS || activeBefore <= 0) return null;
  if (lost * 100 < activeBefore * LOSS_MIN_PERCENT) return null;
  return lost * 100 >= activeBefore * LOSS_CRITICAL_PERCENT ? "CRITICAL" : "WARNING";
}

export type SnapshotPoint = { takenOn: string; totalBacklinks: number; referringDomains: number };

/** Difference between the newest snapshot and the one before it. Null without two snapshots. */
export function snapshotChange(
  snapshots: SnapshotPoint[],
): { backlinks: number; referringDomains: number } | null {
  if (snapshots.length < 2) return null;
  const sorted = [...snapshots].sort((a, b) => a.takenOn.localeCompare(b.takenOn));
  const last = sorted[sorted.length - 1]!;
  const before = sorted[sorted.length - 2]!;
  return {
    backlinks: last.totalBacklinks - before.totalBacklinks,
    referringDomains: last.referringDomains - before.referringDomains,
  };
}

/** Snapshots are weekly: a project is due when its newest snapshot is 7 or more days old. */
export const SNAPSHOT_INTERVAL_DAYS = 7;

export function isSnapshotDue(lastTakenOn: string | null, today: string): boolean {
  if (!lastTakenOn) return true;
  const days =
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${lastTakenOn}T00:00:00Z`)) / 86_400_000;
  return days >= SNAPSHOT_INTERVAL_DAYS;
}
