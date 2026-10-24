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
