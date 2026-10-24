import type { Prisma } from "@prisma/client";
import type { AlertDraft, AlertSettings } from "@/lib/alert-rules";
import type { Db } from "@/server/db/client";

/** Saves alerts. An alert whose dedupe key already exists for the agency is skipped, so a job can run twice safely. */
export async function createAlerts(
  db: Db,
  agencyId: string,
  drafts: AlertDraft[],
): Promise<number> {
  if (drafts.length === 0) return 0;
  const result = await db.alert.createMany({
    data: drafts.map((d) => ({
      agencyId,
      projectId: d.projectId,
      type: d.type,
      severity: d.severity,
      title: d.title,
      body: d.body,
      data: d.data as Prisma.InputJsonValue,
      dedupeKey: d.dedupeKey,
    })),
    skipDuplicates: true,
  });
  return result.count;
}

/** The agency's alert thresholds (Settings page). */
export async function loadAlertSettings(db: Db, agencyId: string): Promise<AlertSettings> {
  const agency = await db.agency.findUniqueOrThrow({
    where: { id: agencyId },
    select: {
      alertDropPositions: true,
      alertDropWithin: true,
      alertTopPosition: true,
      alertOnCriticalAudit: true,
    },
  });
  return {
    dropPositions: agency.alertDropPositions,
    dropWithin: agency.alertDropWithin,
    topPosition: agency.alertTopPosition,
    onCriticalAudit: agency.alertOnCriticalAudit,
  };
}
