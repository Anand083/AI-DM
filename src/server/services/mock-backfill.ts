import type { Db } from "@/server/db/client";
import { MockSeoProvider } from "@/server/providers/seo/mock";
import { refreshKeywordSnapshots } from "./rank-snapshots";

const BATCH = 200;

/**
 * Creates fake rank history for demo and testing: one check per keyword per day for the last
 * `days` days (and today), using the same mock data the mock provider returns day by day.
 * Days that already have a check are left alone.
 */
export async function backfillProject(
  db: Db,
  project: {
    id: string;
    agencyId: string;
    domain: string;
    locationCode: number;
    languageCode: string;
    device: "DESKTOP" | "MOBILE";
  },
  days: number,
  now: Date = new Date(),
): Promise<{ keywords: number; checks: number }> {
  const keywords = await db.keyword.findMany({
    where: { agencyId: project.agencyId, projectId: project.id },
    select: { id: true, phrase: true },
    orderBy: { id: "asc" },
    take: 5000,
  });
  let checks = 0;
  for (let back = days; back >= 0; back--) {
    const day = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back),
    );
    const provider = new MockSeoProvider({ now: () => new Date(day.getTime() + 12 * 3_600_000) });
    for (let i = 0; i < keywords.length; i += BATCH) {
      const batch = keywords.slice(i, i + BATCH);
      const { data } = await provider.getRankings({
        domain: project.domain,
        keywords: batch.map((k) => k.phrase),
        locationCode: project.locationCode,
        languageCode: project.languageCode,
        device: project.device === "MOBILE" ? "mobile" : "desktop",
        priority: "standard",
      });
      const byPhrase = new Map(data.map((r) => [r.keyword, r]));
      const result = await db.rankCheck.createMany({
        data: batch.flatMap((k) => {
          const r = byPhrase.get(k.phrase);
          return r
            ? [
                {
                  agencyId: project.agencyId,
                  keywordId: k.id,
                  date: day,
                  checkedAt: new Date(day.getTime() + 3 * 3_600_000),
                  position: r.position,
                  rankingUrl: r.rankingUrl,
                  serpFeatures: r.serpFeatures,
                  topResults: r.topResults,
                  provider: "mock",
                },
              ]
            : [];
        }),
        skipDuplicates: true,
      });
      checks += result.count;
    }
  }
  await refreshKeywordSnapshots(
    db,
    project.agencyId,
    keywords.map((k) => k.id),
  );
  return { keywords: keywords.length, checks };
}
