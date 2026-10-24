import "server-only";
import { PrismaClient } from "@prisma/client";
import { assertTenantScoped, isGuardEnabled } from "./tenant-guard";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** Unguarded client. Only `admin-client.ts` and the guard setup below may use it. */
export const rawDb: PrismaClient = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = rawDb;

/** Creates a client that checks tenant scope on every query. */
export function withTenantGuard(client: PrismaClient) {
  return client.$extends({
    name: "tenant-guard",
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          if (isGuardEnabled()) assertTenantScoped(model, operation, args);
          return query(args);
        },
      },
    },
  });
}

/** The client the app uses. Tenant models require `agencyId`. */
export const db = withTenantGuard(rawDb);

export type Db = typeof db;
