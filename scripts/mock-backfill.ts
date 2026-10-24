/**
 * Fills the database with fake rank history so charts and tables have something to show.
 *   pnpm mock:backfill --days 90
 *   pnpm mock:backfill --days 30 --agency agency-one
 * Only for development and demos. It never calls a provider.
 */
import "@/server/load-env";
import { db } from "@/server/db/client";
import { backfillProject } from "@/server/services/mock-backfill";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  if (process.env.NODE_ENV === "production")
    throw new Error("mock:backfill must not run in production.");
  const days = Math.min(Math.max(1, Number(arg("days") ?? 90)), 365);
  const slug = arg("agency");
  const agencies = await db.agency.findMany({
    where: { deletedAt: null, ...(slug ? { slug } : {}) },
    select: { id: true, slug: true },
    take: 100,
  });
  for (const agency of agencies) {
    const projects = await db.project.findMany({
      where: { agencyId: agency.id, deletedAt: null },
      select: {
        id: true,
        agencyId: true,
        domain: true,
        locationCode: true,
        languageCode: true,
        device: true,
      },
      take: 1000,
    });
    for (const project of projects) {
      const result = await backfillProject(db, project, days);
      console.log(
        `${agency.slug} / ${project.domain}: ${result.keywords} keywords, ${result.checks} new checks`,
      );
    }
  }
  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
