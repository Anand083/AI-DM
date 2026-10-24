import { PrismaClient } from "@prisma/client";
import { withTenantGuard } from "@/server/db/client";

export const testDatabaseUrl =
  process.env.DATABASE_URL_TEST ?? "postgresql://app:app@localhost:5433/app_test";

export function createTestClient(): PrismaClient {
  return new PrismaClient({ datasourceUrl: testDatabaseUrl });
}

export function createGuardedTestClient(client: PrismaClient) {
  return withTenantGuard(client);
}

/** Empties every table (except the migrations table). Call in beforeEach or beforeAll. */
export async function resetDb(client: PrismaClient): Promise<void> {
  const tables = await client.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await client.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
