import { describe, expect, it } from "vitest";
import {
  buildAuditAlert,
  buildBacklinkLossAlert,
  buildCompetitorMoveAlert,
  buildGoogleAnomalyAlert,
  buildGoogleReconnectAlert,
  detectDrop,
  buildMentionLostAlert,
  buildReviewAlert,
  buildTaskDueAlert,
  buildRankAlerts,
  DEFAULT_ALERT_SETTINGS as S,
  isEnteredTop,
  isRankDrop,
  type RankMove,
} from "./alert-rules";

const move = (phrase: string, previous: number | null, current: number | null): RankMove => ({
  keywordId: `id-${phrase}`,
  phrase,
  previous,
  current,
});

describe("isRankDrop (5 or more places, from the top 20)", () => {
  it("fires at exactly the threshold", () => {
    expect(isRankDrop({ previous: 8, current: 13 }, S)).toBe(true);
    expect(isRankDrop({ previous: 8, current: 12 }, S)).toBe(false);
  });
  it("only counts keywords that were in the top 20", () => {
    expect(isRankDrop({ previous: 20, current: 30 }, S)).toBe(true);
    expect(isRankDrop({ previous: 21, current: 60 }, S)).toBe(false);
    expect(isRankDrop({ previous: null, current: 50 }, S)).toBe(false);
  });
  it("fires when a keyword falls out of the top 100", () => {
    expect(isRankDrop({ previous: 15, current: null }, S)).toBe(true);
    expect(isRankDrop({ previous: 99, current: null }, S)).toBe(false); // was not in the top 20
  });
  it("does not fire for improvements or small moves", () => {
    expect(isRankDrop({ previous: 12, current: 3 }, S)).toBe(false);
    expect(isRankDrop({ previous: 5, current: 5 }, S)).toBe(false);
  });
  it("uses the agency's own thresholds", () => {
    const strict = { ...S, dropPositions: 2, dropWithin: 10 };
    expect(isRankDrop({ previous: 5, current: 7 }, strict)).toBe(true);
    expect(isRankDrop({ previous: 11, current: 20 }, strict)).toBe(false);
  });
});

describe("isEnteredTop (the top 10)", () => {
  it("fires when a keyword moves into the top 10", () => {
    expect(isEnteredTop({ previous: 11, current: 10 }, S)).toBe(true);
    expect(isEnteredTop({ previous: 50, current: 3 }, S)).toBe(true);
    expect(isEnteredTop({ previous: null, current: 7 }, S)).toBe(true);
  });
  it("does not fire when it was already there, or is not there yet", () => {
    expect(isEnteredTop({ previous: 9, current: 2 }, S)).toBe(false);
    expect(isEnteredTop({ previous: 30, current: 11 }, S)).toBe(false);
    expect(isEnteredTop({ previous: 4, current: null }, S)).toBe(false);
  });
  it("uses the agency's own limit", () => {
    expect(isEnteredTop({ previous: 4, current: 3 }, { ...S, topPosition: 3 })).toBe(true);
    expect(isEnteredTop({ previous: 9, current: 5 }, { ...S, topPosition: 3 })).toBe(false);
  });
});

describe("buildRankAlerts", () => {
  const base = { projectId: "p1", projectName: "Main site", date: "2026-03-10", settings: S };

  it("creates nothing when nothing moved enough", () => {
    expect(buildRankAlerts({ ...base, moves: [move("a", 5, 6), move("b", 30, 40)] })).toEqual([]);
  });

  it("makes one alert for all drops, worst first, with a stable dedupe key", () => {
    const drafts = buildRankAlerts({
      ...base,
      moves: [move("small", 8, 14), move("big", 3, 25), move("fine", 4, 4), move("gone", 18, null)],
    });
    expect(drafts).toHaveLength(1);
    const d = drafts[0]!;
    expect(d).toMatchObject({
      type: "RANK_DROP",
      severity: "CRITICAL",
      projectId: "p1",
      dedupeKey: "rank_drop:p1:2026-03-10",
    });
    expect(d.title).toBe("3 keywords dropped for Main site");
    expect(d.body.startsWith("gone: 18 to 100+; big: 3 to 25; small: 8 to 14")).toBe(true);
    expect((d.data.keywords as { phrase: string }[]).map((k) => k.phrase)).toEqual([
      "gone",
      "big",
      "small",
    ]);
  });

  it("is a warning when the biggest drop is under 10 places", () => {
    const [d] = buildRankAlerts({ ...base, moves: [move("a", 5, 11)] });
    expect(d).toMatchObject({ severity: "WARNING", title: "1 keyword dropped for Main site" });
  });

  it("makes a separate info alert for keywords that reached the top 10", () => {
    const drafts = buildRankAlerts({
      ...base,
      moves: [move("up1", 30, 4), move("up2", null, 9), move("drop", 6, 20)],
    });
    expect(drafts.map((d) => d.type)).toEqual(["RANK_DROP", "RANK_GAIN"]);
    expect(drafts[1]).toMatchObject({
      severity: "INFO",
      dedupeKey: "rank_gain:p1:2026-03-10",
      title: "2 keywords reached the top 10 for Main site",
    });
    expect(drafts[1]!.body).toBe("up1: 30 to 4; up2: 100+ to 9.");
  });

  it("shows five examples and says how many more", () => {
    const moves = Array.from({ length: 8 }, (_, i) => move(`k${i}`, 5, 30 + i));
    const [d] = buildRankAlerts({ ...base, moves });
    expect(d!.body.endsWith("; and 3 more.")).toBe(true);
    expect(d!.data.total).toBe(8);
  });
});

describe("buildAuditAlert", () => {
  const base = {
    auditId: "a1",
    projectId: "p1",
    projectName: "Main site",
    firstAudit: false,
    settings: S,
  };
  it("raises a critical alert for new critical issues", () => {
    expect(buildAuditAlert({ ...base, newCritical: 3 })).toMatchObject({
      type: "AUDIT_CRITICAL",
      severity: "CRITICAL",
      title: "3 critical issues found on Main site",
      dedupeKey: "audit_critical:a1",
    });
    expect(buildAuditAlert({ ...base, newCritical: 1 })!.title).toBe(
      "1 critical issue found on Main site",
    );
  });
  it("says it is the first audit when so", () => {
    expect(buildAuditAlert({ ...base, newCritical: 2, firstAudit: true })!.body).toMatch(
      /first site audit/,
    );
  });
  it("raises nothing without new critical issues or when switched off", () => {
    expect(buildAuditAlert({ ...base, newCritical: 0 })).toBeNull();
    expect(
      buildAuditAlert({ ...base, newCritical: 4, settings: { ...S, onCriticalAudit: false } }),
    ).toBeNull();
  });
});

describe("buildBacklinkLossAlert", () => {
  const base = { projectId: "p1", projectName: "Shop", date: "2026-03-10" };

  it("gives nothing for a small loss", () => {
    expect(buildBacklinkLossAlert({ ...base, lost: 3, activeBefore: 20 })).toBeNull();
    expect(buildBacklinkLossAlert({ ...base, lost: 5, activeBefore: 200 })).toBeNull();
  });

  it("warns for a big loss and is critical at 20 percent", () => {
    const warn = buildBacklinkLossAlert({ ...base, lost: 10, activeBefore: 100 });
    expect(warn).toMatchObject({
      type: "BACKLINKS_LOST",
      severity: "WARNING",
      title: "10 backlinks lost for Shop",
      dedupeKey: "backlinks_lost:p1:2026-03-10",
    });
    expect(buildBacklinkLossAlert({ ...base, lost: 20, activeBefore: 100 })?.severity).toBe(
      "CRITICAL",
    );
  });
});

describe("buildMentionLostAlert", () => {
  const base = { projectId: "p1", projectName: "Shop", date: "2026-03-10" };

  it("gives nothing when nothing was lost", () => {
    expect(buildMentionLostAlert({ ...base, lost: [] })).toBeNull();
  });

  it("warns for one or two, and is critical from three", () => {
    const one = buildMentionLostAlert({ ...base, lost: ['"best shoes" on ChatGPT'] });
    expect(one).toMatchObject({
      type: "AI_MENTION_LOST",
      severity: "WARNING",
      title: "Shop stopped appearing in 1 AI answer",
      body: '"best shoes" on ChatGPT.',
      dedupeKey: "ai_mention_lost:p1:2026-03-10",
    });
    expect(buildMentionLostAlert({ ...base, lost: ["a", "b", "c"] })?.severity).toBe("CRITICAL");
  });
});

describe("buildReviewAlert", () => {
  const base = { projectId: "p1", projectName: "Shop", date: "2026-03-10" };

  it("gives nothing without new reviews", () => {
    expect(buildReviewAlert({ ...base, reviews: [] })).toBeNull();
  });

  it("is informational for good reviews", () => {
    const alert = buildReviewAlert({
      ...base,
      reviews: [
        { author: "Sam", rating: 5, text: "Great" },
        { author: "Kim", rating: 4, text: "Good" },
      ],
    });
    expect(alert).toMatchObject({
      type: "NEW_REVIEW",
      severity: "INFO",
      title: "2 new reviews for Shop",
      dedupeKey: "new_review:p1:2026-03-10",
    });
  });

  it("warns about 1 and 2 star reviews and quotes the worst one", () => {
    const alert = buildReviewAlert({
      ...base,
      reviews: [
        { author: "Sam", rating: 5, text: "Great" },
        { author: "Lee", rating: 1, text: "Terrible wait" },
      ],
    });
    expect(alert).toMatchObject({ severity: "WARNING", title: "1 new low review for Shop" });
    expect(alert?.body).toBe('Lee gave 1 star: "Terrible wait" (2 new reviews in total).');
  });
});

describe("buildTaskDueAlert", () => {
  const base = { agencyId: "a1", date: "2026-03-10" };

  it("gives nothing without due tasks", () => {
    expect(buildTaskDueAlert({ ...base, overdue: 0, dueToday: 0 })).toBeNull();
  });

  it("warns about overdue tasks and mentions tasks due today", () => {
    expect(buildTaskDueAlert({ ...base, overdue: 2, dueToday: 1 })).toMatchObject({
      type: "TASK_DUE",
      severity: "WARNING",
      projectId: null,
      title: "2 tasks overdue",
      body: "2 tasks are overdue and 1 task is due today.",
      dedupeKey: "tasks_due:a1:2026-03-10",
    });
  });

  it("is only informational when nothing is overdue", () => {
    expect(buildTaskDueAlert({ ...base, overdue: 0, dueToday: 1 })).toMatchObject({
      severity: "INFO",
      title: "1 task due today",
    });
  });
});

describe("Google alerts", () => {
  it("only flags a big fall on a site with enough traffic", () => {
    expect(detectDrop(100, 200)).toBe(50);
    expect(detectDrop(130, 200)).toBeNull();
    expect(detectDrop(120, 200)).toBe(40);
    expect(detectDrop(10, 40)).toBeNull();
    expect(detectDrop(300, 200)).toBeNull();
  });

  it("writes the anomaly alert with a severity and a key per day and source", () => {
    const base = { projectId: "p1", projectName: "Shop", date: "2026-03-10", before: 200 };
    const warn = buildGoogleAnomalyAlert({ ...base, source: "clicks", recent: 100 })!;
    expect(warn).toMatchObject({ type: "GOOGLE_ANOMALY", severity: "WARNING" });
    expect(warn.title).toBe("Shop: Google Search clicks fell 50%");
    const crit = buildGoogleAnomalyAlert({ ...base, source: "sessions", recent: 40 })!;
    expect(crit.severity).toBe("CRITICAL");
    expect(crit.dedupeKey).toBe("google_anomaly:p1:sessions:2026-03-10");
    expect(buildGoogleAnomalyAlert({ ...base, source: "clicks", recent: 190 })).toBeNull();
  });

  it("writes the reconnect alert", () => {
    expect(
      buildGoogleReconnectAlert({ projectId: "p1", projectName: "Shop", date: "2026-03-10" }),
    ).toMatchObject({
      type: "GOOGLE_RECONNECT",
      title: "Reconnect Google for Shop",
      dedupeKey: "google_reconnect:p1:2026-03-10",
    });
  });
});

describe("competitor move alert", () => {
  const base = {
    projectId: "p1",
    projectName: "Shop",
    competitor: "rival.com",
    weekEnd: "2026-03-22",
  };
  it("names the competitor and the numbers, with a key per competitor and week", () => {
    const a = buildCompetitorMoveAlert({ ...base, from: 4, to: 9 });
    expect(a).toMatchObject({
      type: "COMPETITOR_MOVE",
      severity: "WARNING",
      title: "rival.com moved up for Shop",
      dedupeKey: "competitor_move:p1:rival.com:2026-03-22",
    });
    expect(a.body).toContain("9 of your keywords, up from 4");
  });
  it("is critical for a big jump", () => {
    expect(buildCompetitorMoveAlert({ ...base, from: 2, to: 14 }).severity).toBe("CRITICAL");
  });
});
