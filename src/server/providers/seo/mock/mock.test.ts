import { describe, expect, it } from "vitest";
import { AUDIT_ISSUE_CODES } from "@/server/audit/issue-codes";
import { COMPETITOR_DOMAINS } from "@/data/competitor-domains";
import { ProviderError } from "../errors";
import { MockSeoProvider } from "./index";
import { dayNumber, makeRng } from "./prng";
import { baseRank, rankOnDay, type RankKey } from "./rankings";

const DAY0 = new Date("2026-03-10T12:00:00Z");
const DAY1 = new Date("2026-03-11T12:00:00Z");

const rankInput = {
  domain: "example.com",
  keywords: ["seo tools", "dentist near me", "buy shoes online"],
  locationCode: 2840,
  languageCode: "en",
  device: "desktop" as const,
  priority: "standard" as const,
};

describe("determinism", () => {
  it("gives the same rankings for the same input on the same day, across instances", async () => {
    const a = await new MockSeoProvider({ now: () => DAY0 }).getRankings(rankInput);
    const b = await new MockSeoProvider({
      now: () => new Date("2026-03-10T23:59:00Z"),
    }).getRankings(rankInput);
    expect(a.data).toEqual(b.data);
  });

  it("changes a little on the next day, not everything", async () => {
    const keywords = Array.from({ length: 200 }, (_, i) => `keyword number ${i}`);
    const input = { ...rankInput, keywords };
    const a = (await new MockSeoProvider({ now: () => DAY0 }).getRankings(input)).data;
    const b = (await new MockSeoProvider({ now: () => DAY1 }).getRankings(input)).data;
    const changed = a.filter((r, i) => r.position !== b[i]!.position).length;
    expect(changed).toBeGreaterThan(0);
    expect(changed).toBeLessThan(120); // most keywords keep their position or move slightly
  });

  it("differs by domain, device and location", async () => {
    const p = new MockSeoProvider({ now: () => DAY0 });
    const keywords = Array.from({ length: 50 }, (_, i) => `kw ${i}`);
    const base = (await p.getRankings({ ...rankInput, keywords })).data.map((r) => r.position);
    const other = (await p.getRankings({ ...rankInput, keywords, domain: "other.com" })).data.map(
      (r) => r.position,
    );
    const mobile = (await p.getRankings({ ...rankInput, keywords, device: "mobile" })).data.map(
      (r) => r.position,
    );
    expect(other).not.toEqual(base);
    expect(mobile).not.toEqual(base);
  });

  it("cleans, lowercases and de-duplicates keywords", async () => {
    const { data } = await new MockSeoProvider({ now: () => DAY0 }).getRankings({
      ...rankInput,
      keywords: ["  SEO Tools ", "seo tools", "", "Other"],
    });
    expect(data.map((r) => r.keyword)).toEqual(["seo tools", "other"]);
  });
});

describe("ranking behaviour", () => {
  const key = (i: number): RankKey => ({
    domain: "site.com",
    keyword: `keyword ${i}`,
    locationCode: 2840,
    languageCode: "en",
    device: "desktop",
  });

  it("base positions follow the target distribution over 10,000 keywords", () => {
    const counts = { top3: 0, top10: 0, top30: 0, top100: 0, none: 0 };
    const total = 10_000;
    for (let i = 0; i < total; i++) {
      const p = baseRank(key(i));
      if (p === null) counts.none++;
      else if (p <= 3) counts.top3++;
      else if (p <= 10) counts.top10++;
      else if (p <= 30) counts.top30++;
      else counts.top100++;
    }
    const share = (n: number) => n / total;
    expect(share(counts.top3)).toBeCloseTo(0.15, 1);
    expect(Math.abs(share(counts.top3) - 0.15)).toBeLessThan(0.02);
    expect(Math.abs(share(counts.top10) - 0.25)).toBeLessThan(0.02);
    expect(Math.abs(share(counts.top30) - 0.25)).toBeLessThan(0.02);
    expect(Math.abs(share(counts.top100) - 0.2)).toBeLessThan(0.02);
    expect(Math.abs(share(counts.none) - 0.15)).toBeLessThan(0.02);
  });

  it("moves mostly 0 to 3 positions a day, and about 2% of keywords drop 10 or more", () => {
    const day = dayNumber(DAY0);
    let compared = 0;
    let small = 0;
    let bigDrops = 0;
    for (let i = 0; i < 5000; i++) {
      const before = rankOnDay(key(i), day - 1);
      const after = rankOnDay(key(i), day);
      if (before === null || after === null) continue;
      compared++;
      if (Math.abs(after - before) <= 3) small++;
      if (after - before >= 10) bigDrops++;
    }
    expect(small / compared).toBeGreaterThan(0.93);
    expect(bigDrops / compared).toBeGreaterThan(0.01);
    expect(bigDrops / compared).toBeLessThan(0.04);
  });

  it("always returns positions between 1 and 100, or null", () => {
    const day = dayNumber(DAY0);
    for (let i = 0; i < 2000; i++) {
      const p = rankOnDay(key(i), day + (i % 40));
      if (p !== null) {
        expect(p).toBeGreaterThanOrEqual(1);
        expect(p).toBeLessThanOrEqual(100);
      }
    }
  });

  it("builds a top 10 page that includes the domain at its position and fake competitors elsewhere", async () => {
    const p = new MockSeoProvider({ now: () => DAY0 });
    const keywords = Array.from({ length: 300 }, (_, i) => `term ${i}`);
    const { data } = await p.getRankings({ ...rankInput, keywords });
    let inTop10 = 0;
    for (const r of data) {
      expect(r.topResults).toHaveLength(10);
      expect(r.topResults.map((t) => t.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(new Set(r.topResults.map((t) => t.domain)).size).toBe(10);
      for (const t of r.topResults) {
        if (t.domain !== "example.com") expect(COMPETITOR_DOMAINS).toContain(t.domain);
      }
      if (r.position !== null && r.position <= 10) {
        inTop10++;
        expect(r.topResults[r.position - 1]!.domain).toBe("example.com");
      } else {
        expect(r.topResults.some((t) => t.domain === "example.com")).toBe(false);
      }
      expect(r.rankingUrl === null).toBe(r.position === null);
    }
    expect(inTop10).toBeGreaterThan(30);
  });
});

describe("failures and latency", () => {
  it("never fails at rate 0 and always fails at rate 1 with a retryable error", async () => {
    const ok = new MockSeoProvider({ failureRate: 0 });
    await expect(ok.getRankings(rankInput)).resolves.toBeTruthy();
    const bad = new MockSeoProvider({ failureRate: 1 });
    const error = await bad.getRankings(rankInput).catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.retryable).toBe(true);
  });

  it("fails about as often as the rate says", async () => {
    const rng = makeRng("failure-test");
    const provider = new MockSeoProvider({ failureRate: 0.3, random: rng.next });
    let failed = 0;
    const runs = 1000;
    for (let i = 0; i < runs; i++) {
      try {
        await provider.getBacklinkSummary("example.com");
      } catch {
        failed++;
      }
    }
    expect(failed / runs).toBeGreaterThan(0.25);
    expect(failed / runs).toBeLessThan(0.35);
  });

  it("testConnection always works, even when calls fail", async () => {
    const result = await new MockSeoProvider({ failureRate: 1 }).testConnection();
    expect(result.ok).toBe(true);
    expect(result.balanceUsd).toBeGreaterThan(0);
  });

  it("waits for the latency", async () => {
    const start = Date.now();
    await new MockSeoProvider({ latencyMs: 60 }).getBacklinkSummary("example.com");
    expect(Date.now() - start).toBeGreaterThanOrEqual(55);
  });
});

describe("keyword ideas", () => {
  const p = new MockSeoProvider({ now: () => DAY0 });
  const input = { seed: "Dental Implants", locationCode: 2840, languageCode: "en", limit: 15 };

  it("starts with the seed and uses modifiers", async () => {
    const { data } = await p.getKeywordIdeas(input);
    expect(data).toHaveLength(15);
    expect(data[0]!.keyword).toBe("dental implants");
    const text = data.map((d) => d.keyword).join(" | ");
    expect(text).toMatch(/best|near me|price|how to|vs|for beginners|review|cheap|2026/);
    expect(new Set(data.map((d) => d.keyword)).size).toBe(data.length);
  });

  it("keeps numbers in range and has a 12 month trend", async () => {
    const { data } = await p.getKeywordIdeas({ ...input, limit: 18 });
    for (const idea of data) {
      expect(idea.volume).toBeGreaterThanOrEqual(10);
      expect(idea.volume).toBeLessThanOrEqual(100_000);
      expect(idea.cpcMicros).toBeGreaterThanOrEqual(100_000);
      expect(idea.cpcMicros).toBeLessThanOrEqual(15_000_000);
      expect(idea.difficulty).toBeGreaterThanOrEqual(0);
      expect(idea.difficulty).toBeLessThanOrEqual(100);
      expect(idea.trend).toHaveLength(12);
      expect(["informational", "commercial", "transactional", "navigational", "local"]).toContain(
        idea.intent,
      );
    }
  });

  it("is stable on a day and only wobbles slightly on the next", async () => {
    const a = (await p.getKeywordIdeas(input)).data;
    const a2 = (await p.getKeywordIdeas(input)).data;
    expect(a).toEqual(a2);
    const b = (await new MockSeoProvider({ now: () => DAY1 }).getKeywordIdeas(input)).data;
    for (let i = 0; i < a.length; i++) {
      expect(a[i]!.keyword).toBe(b[i]!.keyword);
      const ratio = b[i]!.volume / a[i]!.volume;
      expect(ratio).toBeGreaterThan(0.94);
      expect(ratio).toBeLessThan(1.06);
      expect(b[i]!.difficulty).toBe(a[i]!.difficulty);
    }
  });

  it("respects the limit", async () => {
    expect((await p.getKeywordIdeas({ ...input, limit: 3 })).data).toHaveLength(3);
    expect((await p.getKeywordIdeas({ ...input, limit: 0 })).data).toHaveLength(0);
  });
});

describe("audit", () => {
  const start = new Date("2026-03-10T10:00:00Z");
  const at = (seconds: number) => new Date(start.getTime() + seconds * 1000);

  it("goes from queued to running to completed over the audit time", async () => {
    let now = start;
    const p = new MockSeoProvider({ now: () => now, auditSeconds: 20 });
    const { data } = await p.startAudit({ domain: "Example.com", maxPages: 100 });
    expect((await p.getAuditStatus(data.taskId)).data).toEqual({ status: "queued", progress: 0 });
    now = at(10);
    const running = (await p.getAuditStatus(data.taskId)).data;
    expect(running.status).toBe("running");
    expect(running.progress).toBeGreaterThan(0);
    expect(running.progress).toBeLessThan(100);
    now = at(20);
    expect((await p.getAuditStatus(data.taskId)).data).toEqual({
      status: "completed",
      progress: 100,
    });
  });

  it("refuses to give a result before it is finished (retryable)", async () => {
    const p = new MockSeoProvider({ now: () => start, auditSeconds: 20 });
    const { data } = await p.startAudit({ domain: "example.com", maxPages: 50 });
    const error = await p.getAuditResult(data.taskId).catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.retryable).toBe(true);
  });

  it("works across instances because the task id carries the state", async () => {
    const first = new MockSeoProvider({ now: () => start, auditSeconds: 5 });
    const { data } = await first.startAudit({ domain: "example.com", maxPages: 60 });
    const second = new MockSeoProvider({ now: () => at(6), auditSeconds: 5 });
    const result = (await second.getAuditResult(data.taskId)).data;
    const again = (
      await new MockSeoProvider({ now: () => at(60), auditSeconds: 5 }).getAuditResult(data.taskId)
    ).data;
    expect(result).toEqual(again);
  });

  it("returns 20 to 300 pages capped by maxPages, with known issue codes", async () => {
    let now = start;
    const p = new MockSeoProvider({ now: () => now, auditSeconds: 1 });
    for (const maxPages of [5, 50, 1000]) {
      now = start;
      const { data: task } = await p.startAudit({ domain: `site${maxPages}.com`, maxPages });
      now = at(100);
      const { data } = await p.getAuditResult(task.taskId);
      expect(data.pagesCrawled).toBe(data.pages.length);
      expect(data.pagesCrawled).toBeLessThanOrEqual(maxPages);
      expect(data.pagesCrawled).toBeLessThanOrEqual(300);
      if (maxPages >= 300) expect(data.pagesCrawled).toBeGreaterThanOrEqual(20);
      for (const issue of data.issues) {
        expect(AUDIT_ISSUE_CODES).toContain(issue.code);
        expect(["CRITICAL", "WARNING", "NOTICE"]).toContain(issue.severity);
      }
      const perPage = data.pages.reduce((sum, page) => sum + page.issueCount, 0);
      expect(perPage).toBe(data.issues.length);
    }
  });

  it("finishes at once when the audit time is 0", async () => {
    const p = new MockSeoProvider({ now: () => start, auditSeconds: 0 });
    const { data } = await p.startAudit({ domain: "example.com", maxPages: 30 });
    expect((await p.getAuditStatus(data.taskId)).data.status).toBe("completed");
  });

  it("rejects task ids it does not know", async () => {
    const error = await new MockSeoProvider().getAuditStatus("somebody-else-123").catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.retryable).toBe(false);
  });
});

describe("backlinks, ranked keywords, AI and reviews", () => {
  const p = new MockSeoProvider({ now: () => DAY0 });

  it("summarises backlinks with sensible numbers", async () => {
    const { data } = await p.getBacklinkSummary("Example.com");
    expect(data.domain).toBe("example.com");
    expect(data.referringDomains).toBeLessThanOrEqual(data.totalBacklinks);
    expect(data.dofollowPercent).toBeGreaterThanOrEqual(0);
    expect(data.dofollowPercent).toBeLessThanOrEqual(100);
  });

  it("pages through backlinks consistently", async () => {
    const first10 = (await p.getBacklinks({ domain: "example.com", limit: 10, offset: 0 })).data;
    const first20 = (await p.getBacklinks({ domain: "example.com", limit: 20, offset: 0 })).data;
    const next10 = (await p.getBacklinks({ domain: "example.com", limit: 10, offset: 10 })).data;
    expect(first20.slice(0, 10)).toEqual(first10);
    expect(first20.slice(10)).toEqual(next10);
    for (const link of first10)
      if (link.lostAt)
        expect(link.lastSeen <= link.lostAt || link.lastSeen === link.lostAt).toBe(true);
  });

  it("lists ranked keywords sorted by position", async () => {
    const { data } = await p.getRankedKeywords({
      domain: "example.com",
      locationCode: 2840,
      languageCode: "en",
      limit: 30,
    });
    expect(data).toHaveLength(30);
    for (let i = 1; i < data.length; i++)
      expect(data[i]!.position).toBeGreaterThanOrEqual(data[i - 1]!.position);
  });

  it("answers AI visibility checks consistently within a day", async () => {
    const input = {
      prompt: "best dentist in town",
      brand: "Bright Dental",
      domain: "brightdental.com",
      engine: "chatgpt" as const,
    };
    const a = (await p.checkAiVisibility(input)).data;
    expect(a).toEqual((await p.checkAiVisibility(input)).data);
    expect(a.brandMentioned || a.mentionPosition === null).toBe(true);
    if (a.brandMentioned) expect(a.mentionPosition).toBeGreaterThanOrEqual(1);
  });

  it("returns reviews with ratings from 1 to 5", async () => {
    const { data } = await p.getReviews({ businessName: "Bright Dental", locationCode: 2840 });
    expect(data.rating).toBeGreaterThanOrEqual(1);
    expect(data.rating).toBeLessThanOrEqual(5);
    expect(data.recent.length).toBeGreaterThan(0);
    for (const r of data.recent) expect(r.rating).toBeGreaterThanOrEqual(1);
  });

  it("keeps five reviews fixed and brings one new review each week", async () => {
    const at = (iso: string) => new MockSeoProvider({ now: () => new Date(iso) });
    const input = { businessName: "Bright Dental", locationCode: 2840 };
    const key = (r: { author: string; rating: number; text: string }) =>
      `${r.author}|${r.rating}|${r.text}`;
    const first = (await at("2026-03-03T10:00:00Z").getReviews(input)).data;
    const sameWeek = (await at("2026-03-04T10:00:00Z").getReviews(input)).data;
    const nextWeek = (await at("2026-03-11T10:00:00Z").getReviews(input)).data;

    expect(first.recent).toHaveLength(8);
    expect(sameWeek.recent.map(key)).toEqual(first.recent.map(key));
    const known = new Set(first.recent.map(key));
    expect(nextWeek.recent.filter((r) => !known.has(key(r)))).toHaveLength(1);
    expect(nextWeek.rating).toBeGreaterThanOrEqual(1);
    expect(nextWeek.rating).toBeLessThanOrEqual(5);
  });
});

describe("cost estimates", () => {
  const p = new MockSeoProvider();
  it("charges more for live checks and scales with units", () => {
    expect(p.estimateCostMicros("rankings", 100)).toBe(60_000);
    expect(p.estimateCostMicros("rankings", 100, "live")).toBe(200_000);
    expect(p.estimateCostMicros("audit_page", 200)).toBe(50_000);
    expect(p.estimateCostMicros("keyword_ideas", 1)).toBeGreaterThan(0);
    expect(p.estimateCostMicros("rankings", 0)).toBe(0);
  });
});
