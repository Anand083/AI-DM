import type { Db } from "@/server/db/client";
import { buildSnapshot, type CheckPoint } from "@/lib/rank-math";

const BATCH = 100;
const WINDOW_DAYS = 37;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Recomputes the snapshot columns of keywords (latest position, best, changes) from their
 * rank checks. Call it after saving rank checks. Safe to call any time; it only reads checks.
 */
export async function refreshKeywordSnapshots(
  db: Db,
  agencyId: string,
  keywordIds: string[],
): Promise<number> {
  let updated = 0;
  for (let i = 0; i < keywordIds.length; i += BATCH) {
    const ids = keywordIds.slice(i, i + BATCH);

    const latest = await db.rankCheck.groupBy({
      by: ["keywordId"],
      where: { agencyId, keywordId: { in: ids } },
      _max: { date: true },
    });
    if (latest.length === 0) continue;
    const newest = latest.reduce<Date>(
      (max, row) => (row._max.date && row._max.date > max ? row._max.date : max),
      new Date(0),
    );
    const since = new Date(newest.getTime() - WINDOW_DAYS * 86_400_000);

    const [checks, bests] = await Promise.all([
      db.rankCheck.findMany({
        where: { agencyId, keywordId: { in: ids }, date: { gte: since } },
        select: {
          keywordId: true,
          date: true,
          position: true,
          rankingUrl: true,
          serpFeatures: true,
        },
        orderBy: [{ keywordId: "asc" }, { date: "desc" }],
        take: ids.length * (WINDOW_DAYS + 5),
      }),
      db.rankCheck.groupBy({
        by: ["keywordId"],
        where: { agencyId, keywordId: { in: ids }, position: { not: null } },
        _min: { position: true },
      }),
    ]);

    const byKeyword = new Map<string, CheckPoint[]>();
    for (const c of checks) {
      const list = byKeyword.get(c.keywordId) ?? [];
      list.push({
        date: isoDay(c.date),
        position: c.position,
        rankingUrl: c.rankingUrl,
        serpFeatures: Array.isArray(c.serpFeatures) ? (c.serpFeatures as string[]) : [],
      });
      byKeyword.set(c.keywordId, list);
    }
    const bestEver = new Map(bests.map((b) => [b.keywordId, b._min.position]));

    for (const [keywordId, list] of byKeyword) {
      const snapshot = buildSnapshot(list, bestEver.get(keywordId) ?? null);
      if (!snapshot) continue;
      await db.keyword.update({
        where: { id: keywordId, agencyId },
        data: { ...snapshot, lastCheckedOn: new Date(`${snapshot.lastCheckedOn}T00:00:00Z`) },
      });
      updated++;
    }
  }
  return updated;
}
