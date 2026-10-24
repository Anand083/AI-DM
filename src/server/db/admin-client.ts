import "server-only";
import { rawDb } from "./client";

/**
 * Unguarded database client for super admin code.
 * Import this only from `src/server/admin` (enforced by ESLint).
 */
export const adminDb = rawDb;
