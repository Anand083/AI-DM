import { lossSeverity } from "./backlink-math";
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
  type:
    | "RANK_DROP"
    | "RANK_GAIN"
    | "AUDIT_CRITICAL"
    | "BACKLINKS_LOST"
    | "AI_MENTION_LOST"
    | "NEW_REVIEW"
    | "TASK_DUE"
    | "CLIENT_RESPONSE"
    | "GOOGLE_ANOMALY"
    | "GOOGLE_RECONNECT";
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

/** An alert when a project lost many links since the last weekly check. */
export function buildBacklinkLossAlert(input: {
  projectId: string;
  projectName: string;
  date: string;
  lost: number;
  activeBefore: number;
}): AlertDraft | null {
  const severity = lossSeverity(input.lost, input.activeBefore);
  if (!severity) return null;
  return {
    projectId: input.projectId,
    type: "BACKLINKS_LOST",
    severity,
    title: `${plural(input.lost, "backlink", "backlinks")} lost for ${input.projectName}`,
    body: `${plural(input.lost, "link", "links")} out of ${input.activeBefore} stopped pointing to the site since the last weekly check.`,
    data: { date: input.date, lost: input.lost, activeBefore: input.activeBefore },
    dedupeKey: `backlinks_lost:${input.projectId}:${input.date}`,
  };
}

/** An alert when AI answers that named the brand last time do not name it now. */
export function buildMentionLostAlert(input: {
  projectId: string;
  projectName: string;
  date: string;
  /** Readable names such as `"best plumber" on ChatGPT`. */
  lost: string[];
}): AlertDraft | null {
  const n = input.lost.length;
  if (n === 0) return null;
  return {
    projectId: input.projectId,
    type: "AI_MENTION_LOST",
    severity: n >= 3 ? "CRITICAL" : "WARNING",
    title: `${input.projectName} stopped appearing in ${plural(n, "AI answer", "AI answers")}`,
    body: input.lost.slice(0, SHOWN).join("; ") + (n > SHOWN ? `; and ${n - SHOWN} more.` : "."),
    data: { date: input.date, total: n, lost: input.lost.slice(0, STORED) },
    dedupeKey: `ai_mention_lost:${input.projectId}:${input.date}`,
  };
}

/** One alert for the new reviews found by a check. Reviews with 1 or 2 stars make it a warning. */
export function buildReviewAlert(input: {
  projectId: string;
  projectName: string;
  date: string;
  reviews: { author: string; rating: number; text: string }[];
}): AlertDraft | null {
  const n = input.reviews.length;
  if (n === 0) return null;
  const low = input.reviews.filter((r) => r.rating <= 2);
  const worst = [...input.reviews].sort((a, b) => a.rating - b.rating)[0]!;
  const star = (r: number) => `${r} ${r === 1 ? "star" : "stars"}`;
  return {
    projectId: input.projectId,
    type: "NEW_REVIEW",
    severity: low.length > 0 ? "WARNING" : "INFO",
    title:
      low.length > 0
        ? `${plural(low.length, "new low review", "new low reviews")} for ${input.projectName}`
        : `${plural(n, "new review", "new reviews")} for ${input.projectName}`,
    body:
      low.length > 0
        ? `${worst.author} gave ${star(worst.rating)}: "${worst.text.slice(0, 140)}"${n > 1 ? ` (${plural(n, "new review", "new reviews")} in total).` : "."}`
        : `${plural(n, "new review", "new reviews")} since the last check. The newest is from ${input.reviews[0]!.author}.`,
    data: {
      date: input.date,
      total: n,
      low: low.length,
      reviews: input.reviews
        .slice(0, STORED)
        .map((r) => ({ author: r.author, rating: r.rating, text: r.text.slice(0, 300) })),
    },
    dedupeKey: `new_review:${input.projectId}:${input.date}`,
  };
}

/** One alert a day for an agency that has overdue tasks or tasks due today. */
export function buildTaskDueAlert(input: {
  agencyId: string;
  date: string;
  overdue: number;
  dueToday: number;
}): AlertDraft | null {
  const { overdue, dueToday } = input;
  if (overdue + dueToday === 0) return null;
  const parts = [
    overdue > 0 ? `${plural(overdue, "task is", "tasks are")} overdue` : "",
    dueToday > 0 ? `${plural(dueToday, "task is", "tasks are")} due today` : "",
  ].filter(Boolean);
  return {
    projectId: null,
    type: "TASK_DUE",
    severity: overdue > 0 ? "WARNING" : "INFO",
    title:
      overdue > 0
        ? `${plural(overdue, "task", "tasks")} overdue`
        : `${plural(dueToday, "task", "tasks")} due today`,
    body: `${parts.join(" and ")}.`,
    data: { date: input.date, overdue, dueToday },
    dedupeKey: `tasks_due:${input.agencyId}:${input.date}`,
  };
}

/** Share of the way down, in whole percent, when the last 7 days fell far below the 7 days before. */
export const ANOMALY_MIN_BEFORE = 50;
export const ANOMALY_WARN_PERCENT = 40;
export const ANOMALY_CRITICAL_PERCENT = 60;

/**
 * Looks for a sudden fall. `recent` and `before` are the sums of two weeks in a row. Small sites
 * (under 50 in the week before) are ignored because their numbers jump around by chance.
 * Returns the fall in percent, or null when there is nothing to report.
 */
export function detectDrop(recent: number, before: number): number | null {
  if (before < ANOMALY_MIN_BEFORE || recent >= before) return null;
  const percent = Math.round(((before - recent) / before) * 100);
  return percent >= ANOMALY_WARN_PERCENT ? percent : null;
}

/** An alert when Google Search clicks or Analytics sessions fell sharply from one week to the next. */
export function buildGoogleAnomalyAlert(input: {
  projectId: string;
  projectName: string;
  source: "clicks" | "sessions";
  /** Newest day of the recent week (YYYY-MM-DD). */
  date: string;
  recent: number;
  before: number;
}): AlertDraft | null {
  const percent = detectDrop(input.recent, input.before);
  if (percent === null) return null;
  const what = input.source === "clicks" ? "Google Search clicks" : "website sessions";
  return {
    projectId: input.projectId,
    type: "GOOGLE_ANOMALY",
    severity: percent >= ANOMALY_CRITICAL_PERCENT ? "CRITICAL" : "WARNING",
    title: `${input.projectName}: ${what} fell ${percent}%`,
    body: `${input.recent} in the last 7 days against ${input.before} in the 7 days before. Check for a site change, a Google update or a tracking problem.`,
    data: {
      date: input.date,
      source: input.source,
      recent: input.recent,
      before: input.before,
      percent,
    },
    dedupeKey: `google_anomaly:${input.projectId}:${input.source}:${input.date}`,
  };
}

/** An alert when Google no longer lets us read a project's data. */
export function buildGoogleReconnectAlert(input: {
  projectId: string;
  projectName: string;
  date: string;
}): AlertDraft {
  return {
    projectId: input.projectId,
    type: "GOOGLE_RECONNECT",
    severity: "WARNING",
    title: `Reconnect Google for ${input.projectName}`,
    body: "Google no longer lets us read the data. Open the Analytics tab and connect again.",
    data: { date: input.date },
    dedupeKey: `google_reconnect:${input.projectId}:${input.date}`,
  };
}
