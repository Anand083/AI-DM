import "server-only";
import { z } from "zod";
import { parseClientCsv } from "@/lib/client-import";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import { logActivity } from "./activity";
import { createClient } from "./clients";
import { ForbiddenError, LimitExceededError, ValidationError } from "./errors";
import { createProject } from "./projects";
import { parseInput } from "./validation";

export const clientImportSchema = z.object({ csv: z.string().max(1_000_000) });

export type ClientImportResult = {
  clientsAdded: number;
  projectsAdded: number;
  problems: { line: number; message: string }[];
  truncated: boolean;
};

const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

/**
 * Imports clients (and one project per row when a domain is given) from CSV text. A client name
 * that already exists is reused, so the same file can be loaded twice. New projects use the
 * United States, English, desktop and weekly checks; change them on the project afterwards.
 * Plan limits are checked per row. Bad rows are reported and skipped.
 */
export async function importClientsCsv(
  ctx: TenantContext,
  raw: unknown,
): Promise<ClientImportResult> {
  if (!can(ctx.role, "content.edit")) throw new ForbiddenError();
  const input = parseInput(clientImportSchema, raw);
  const parsed = parseClientCsv(input.csv);
  if (parsed.rows.length === 0) {
    throw new ValidationError("No clients found in the file.", {
      csv: "No clients found. Use one client per line, or a client column.",
    });
  }
  const existing = await db.client.findMany({
    where: { agencyId: ctx.agencyId, deletedAt: null },
    select: { id: true, name: true },
    take: 5000,
  });
  const byName = new Map(existing.map((c) => [c.name.toLowerCase(), c.id]));
  const problems = [...parsed.problems];
  let clientsAdded = 0;
  let projectsAdded = 0;
  let limitHit = false;
  for (const row of parsed.rows) {
    if (limitHit) break;
    try {
      let clientId = byName.get(row.name.toLowerCase());
      if (!clientId) {
        const created = await createClient(ctx, {
          name: row.name,
          website: row.website,
          contactName: row.contactName,
          contactEmail: row.contactEmail,
        });
        clientId = created.id;
        byName.set(row.name.toLowerCase(), clientId);
        clientsAdded++;
      }
      if (row.domain) {
        await createProject(ctx, clientId, {
          name: row.projectName || row.domain,
          domain: row.domain,
          locationCode: 2840,
          languageCode: "en",
          device: "DESKTOP",
          rankCheckFrequency: "WEEKLY",
          autoAudit: false,
        });
        projectsAdded++;
      }
    } catch (error) {
      if (error instanceof LimitExceededError) {
        limitHit = true;
        problems.push({ line: row.line, message: `${message(error)} The rest was skipped.` });
      } else if (error instanceof ValidationError) {
        const first = error.fieldErrors ? Object.values(error.fieldErrors)[0] : undefined;
        problems.push({ line: row.line, message: first ?? message(error) });
      } else {
        problems.push({ line: row.line, message: message(error) });
      }
    }
  }
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "clients.imported",
    targetType: "Agency",
    targetId: ctx.agencyId,
    metadata: { clientsAdded, projectsAdded },
  });
  return {
    clientsAdded,
    projectsAdded,
    problems: problems.slice(0, 30),
    truncated: parsed.truncated,
  };
}
