import { formatPosition, rankChange } from "./rank-math";

export type AlertSettings = {
  /** A drop of at least this many positions gives an alert... */
  dropPositions: number;
  /** ...if the keyword was in this many top results before. */
  dropWithin: number;
  /** A keyword that moves into this many top results gives an alert. */
  topPosition: number;
  onCriticalAudit: boolean;
};

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  dropPositions: 5,
  dropWithin: 20,
  topPosition: 10,
  onCriticalAudit: true,
};

/** A keyword that moved between two checks. `null` means not in the top 100. */
export type RankMove = {
  keywordId: string;
  phrase: string;
  previous: number | null;
  current: number | null;
};

/** The keyword was in the top `dropWithin` and lost at least `dropPositions` places (or fell out of the top 100). */
export function isRankDrop(
  move: Pick<RankMove, "previous" | "current">,
  s: AlertSettings,
): boolean {
  if (move.previous === null || move.previous > s.dropWithin) return false;
  return rankChange(move.previous, move.current) <= -s.dropPositions;
}

/** The keyword is now in the top `topPosition` and was not before. */
export function isEnteredTop(
  move: Pick<RankMove, "previous" | "current">,
  s: AlertSettings,
): boolean {
  if (move.current === null || move.current > s.topPosition) return false;
  return move.previous === null || move.previous > s.topPosition;
}

export type AlertDraft = {
  projectId: string | null;
  type: "RANK_DROP" | "RANK_GAIN" | "AUDIT_CRITICAL";
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  body: string;
  data: Record<string, unknown>;
  dedupeKey: string;
};

const SHOWN = 5;
const STORED = 50;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const range = (m: RankMove) =>
  `${m.phrase}: ${formatPosition(m.previous)} to ${formatPosition(m.current)}`;

/**
 * Turns the moves of one rank check run into at most two alerts for the project:
 * one for drops and one for keywords that reached the top. A drop of 10 or more places,
 * or falling out of the top 100, is critical; smaller drops are warnings.
 */
export function buildRankAlerts(input: {
  projectId: string;
  projectName: string;
  date: string;
  moves: RankMove[];
  settings: AlertSettings;
}): AlertDraft[] {
  const { projectId, projectName, date, moves, settings } = input;
  const drafts: AlertDraft[] = [];

  const drops = moves
    .filter((m) => isRankDrop(m, settings))
    .sort((a, b) => rankChange(a.previous, a.current) - rankChange(b.previous, b.current));
  if (drops.length > 0) {
    const worst = rankChange(drops[0]!.previous, drops[0]!.current);
    drafts.push({
      projectId,
      type: "RANK_DROP",
      severity: worst <= -10 ? "CRITICAL" : "WARNING",
      title: `${plural(drops.length, "keyword", "keywords")} dropped for ${projectName}`,
      body:
        drops.slice(0, SHOWN).map(range).join("; ") +
        (drops.length > SHOWN ? `; and ${drops.length - SHOWN} more.` : "."),
      data: {
        date,
        total: drops.length,
        keywords: drops
          .slice(0, STORED)
          .map((m) => ({ id: m.keywordId, phrase: m.phrase, from: m.previous, to: m.current })),
      },
      dedupeKey: `rank_drop:${projectId}:${date}`,
    });
  }

  const gains = moves
    .filter((m) => isEnteredTop(m, settings))
    .sort((a, b) => (a.current ?? 0) - (b.current ?? 0));
  if (gains.length > 0) {
    drafts.push({
      projectId,
      type: "RANK_GAIN",
      severity: "INFO",
      title: `${plural(gains.length, "keyword", "keywords")} reached the top ${settings.topPosition} for ${projectName}`,
      body:
        gains.slice(0, SHOWN).map(range).join("; ") +
        (gains.length > SHOWN ? `; and ${gains.length - SHOWN} more.` : "."),
      data: {
        date,
        total: gains.length,
        keywords: gains
          .slice(0, STORED)
          .map((m) => ({ id: m.keywordId, phrase: m.phrase, from: m.previous, to: m.current })),
      },
      dedupeKey: `rank_gain:${projectId}:${date}`,
    });
  }
  return drafts;
}

/** An alert when an audit finds critical issues that were not in the audit before (or any, for the first audit). */
export function buildAuditAlert(input: {
  auditId: string;
  projectId: string;
  projectName: string;
  newCritical: number;
  firstAudit: boolean;
  settings: AlertSettings;
}): AlertDraft | null {
  if (!input.settings.onCriticalAudit || input.newCritical <= 0) return null;
  const n = input.newCritical;
  return {
    projectId: input.projectId,
    type: "AUDIT_CRITICAL",
    severity: "CRITICAL",
    title: `${plural(n, "critical issue", "critical issues")} found on ${input.projectName}`,
    body: input.firstAudit
      ? `The first site audit found ${plural(n, "critical issue", "critical issues")}. Fix these first.`
      : `The latest site audit found ${plural(n, "new critical issue", "new critical issues")} that were not there before.`,
    data: { auditId: input.auditId, newCritical: n },
    dedupeKey: `audit_critical:${input.auditId}`,
  };
}
