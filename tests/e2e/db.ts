import { PrismaClient } from "@prisma/client";

try {
  process.loadEnvFile();
} catch {
  // Variables come from the environment (for example in CI).
}

/** Direct database access for setting up test data that the app only creates in the background. */
export async function withDb<T>(fn: (prisma: PrismaClient) => Promise<T>): Promise<T> {
  const prisma = new PrismaClient();
  try {
    return await fn(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

/** Adds an alert to an agency, as the worker would after a rank check. */
export async function insertAlert(
  agencySlug: string,
  projectId: string | null,
  title: string,
  key: string,
) {
  return withDb(async (prisma) => {
    const agency = await prisma.agency.findUniqueOrThrow({ where: { slug: agencySlug } });
    return prisma.alert.create({
      data: {
        agencyId: agency.id,
        projectId,
        type: "RANK_DROP",
        severity: "WARNING",
        title,
        body: "dental implants: 6 to 14.",
        dedupeKey: key,
      },
    });
  });
}

const daysAgo = (n: number) =>
  new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime() - n * 86_400_000;

/** Adds keywords with two rank checks each (about 25 and 1 days ago), as the worker would over time. */
export async function seedRankings(
  agencySlug: string,
  projectId: string,
  rows: [phrase: string, before: number | null, after: number | null][],
) {
  return withDb(async (prisma) => {
    const agency = await prisma.agency.findUniqueOrThrow({ where: { slug: agencySlug } });
    for (const [phrase, before, after] of rows) {
      // The keyword row also holds the latest snapshot, which the worker keeps up to date.
      const keyword = await prisma.keyword.create({
        data: {
          agencyId: agency.id,
          projectId,
          phrase,
          lastCheckedOn: new Date(daysAgo(1)),
          currentPosition: after,
          bestPosition: Math.min(...[before, after].filter((p): p is number => p !== null)),
          changeMonth: (before ?? 101) - (after ?? 101),
        },
      });
      for (const [days, position] of [
        [25, before],
        [1, after],
      ] as const) {
        await prisma.rankCheck.create({
          data: {
            agencyId: agency.id,
            keywordId: keyword.id,
            date: new Date(daysAgo(days)),
            position,
            rankingUrl: position ? "https://shop.example/page" : null,
            provider: "mock",
          },
        });
      }
    }
  });
}

/** Moves the end of a report's share link, to test links that expired. */
export async function expireShareLink(reportTitle: string) {
  return withDb((prisma) =>
    prisma.report.updateMany({
      where: { title: reportTitle },
      data: { shareExpiresAt: new Date(Date.now() - 60_000) },
    }),
  );
}
