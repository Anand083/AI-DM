import type { PrismaClient } from "@prisma/client";
import { localParts } from "@/lib/local-time";

export const DIGEST_HOUR = 8;

type DigestDb = Pick<PrismaClient, "agency" | "alert" | "agencyMember">;

/**
 * Finds agencies whose daily digest is due: it is on, it is 8 o'clock or later in the agency's
 * time zone, and today's digest has not been sent. Safe to run every 15 minutes.
 */
export async function runDigestScheduler(deps: {
  db: Pick<PrismaClient, "agency">;
  now: Date;
  enqueue: (job: { agencyId: string; date: string }) => Promise<boolean>;
}): Promise<{ scanned: number; queued: number }> {
  const agencies = await deps.db.agency.findMany({
    where: { dailyDigest: true, status: "ACTIVE", deletedAt: null },
    select: { id: true, timezone: true, lastDigestOn: true },
    orderBy: { id: "asc" },
    take: 5000,
  });
  let queued = 0;
  for (const agency of agencies) {
    const local = localParts(deps.now, agency.timezone);
    if (local.hour < DIGEST_HOUR) continue;
    if (agency.lastDigestOn && agency.lastDigestOn.toISOString().slice(0, 10) >= local.date)
      continue;
    if (await deps.enqueue({ agencyId: agency.id, date: local.date })) queued++;
  }
  return { scanned: agencies.length, queued };
}

export type DigestEmail = { to: string; subject: string; text: string; html: string };

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Builds and sends the digest of alerts that have not been emailed yet (up to 36 hours old) to
 * the agency's owners and admins. Marks them emailed. Sends nothing when there are no new alerts.
 */
export async function sendDigest(deps: {
  db: DigestDb;
  agencyId: string;
  date: string;
  now: Date;
  appUrl: string;
  send: (email: DigestEmail, key: string) => Promise<void>;
}): Promise<{ sent: number; alerts: number }> {
  const agency = await deps.db.agency.findUnique({
    where: { id: deps.agencyId },
    select: { id: true, name: true, slug: true, dailyDigest: true },
  });
  if (!agency || !agency.dailyDigest) return { sent: 0, alerts: 0 };

  const since = new Date(deps.now.getTime() - 36 * 3_600_000);
  const alerts = await deps.db.alert.findMany({
    where: { agencyId: agency.id, emailedAt: null, createdAt: { gte: since } },
    select: { id: true, title: true, body: true, severity: true },
    orderBy: [{ createdAt: "desc" }],
    take: 100,
  });

  let sent = 0;
  if (alerts.length > 0) {
    const members = await deps.db.agencyMember.findMany({
      where: { agencyId: agency.id, role: { in: ["OWNER", "ADMIN"] } },
      select: { user: { select: { email: true } } },
      take: 50,
    });
    const link = `${deps.appUrl}/app/${agency.slug}/alerts`;
    const lines = alerts.map((a) => `- ${a.title}\n  ${a.body}`);
    const subject = `${agency.name}: ${alerts.length} new ${alerts.length === 1 ? "alert" : "alerts"}`;
    const text = `${subject}\n\n${lines.join("\n\n")}\n\nSee all alerts: ${link}\n`;
    const html =
      `<p>${escapeHtml(subject)}</p><ul>` +
      alerts
        .map((a) => `<li><strong>${escapeHtml(a.title)}</strong><br>${escapeHtml(a.body)}</li>`)
        .join("") +
      `</ul><p><a href="${link}">See all alerts</a></p>`;
    for (const m of members) {
      await deps.send(
        { to: m.user.email, subject, text, html },
        `digest_${agency.id}_${deps.date}_${m.user.email}`,
      );
      sent++;
    }
    await deps.db.alert.updateMany({
      where: { agencyId: agency.id, id: { in: alerts.map((a) => a.id) } },
      data: { emailedAt: deps.now },
    });
  }
  await deps.db.agency.update({
    where: { id: agency.id },
    data: { lastDigestOn: new Date(`${deps.date}T00:00:00Z`) },
  });
  return { sent, alerts: alerts.length };
}
