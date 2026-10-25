import { estimateCostMicros } from "../pricing";
import { ProviderError } from "../errors";
import type {
  AiEngine,
  AiTopic,
  BingRank,
  KeywordMetric,
  ReferringDomain,
  AuditCrawlConfig,
  AiVisibilityResult,
  LlmMentionsSummary,
  AuditResult,
  AuditStatus,
  Backlink,
  BacklinkSummary,
  KeywordIdea,
  ProviderResult,
  RankedKeyword,
  RankPriority,
  RankResult,
  ReviewSummary,
  SearchDevice,
  SeoDataProvider,
  SeoOperation,
} from "../types";
import { auditStatusAt, buildAuditResult, makeAuditTaskId, parseAuditTaskId } from "./audit";
import {
  buildBacklink,
  buildBacklinkSummary,
  buildRankedKeywords,
  buildReferringDomains,
} from "./backlinks";
import { buildKeywordIdeas } from "./keywords";
import {
  buildAiTopics,
  buildAiVisibility,
  buildBingRankings,
  buildKeywordMetrics,
  buildLlmMentions,
  buildReviews,
} from "./misc";
import { dayNumber } from "./prng";
import { buildRankResult } from "./rankings";

export type MockOptions = {
  /** Pretend delay for every call, in milliseconds. */
  latencyMs?: number;
  /** Chance (0 to 1) that a call fails with a retryable error. */
  failureRate?: number;
  /** How long a mock audit takes, in seconds. */
  auditSeconds?: number;
  /** For tests: replace the clock. */
  now?: () => Date;
  /** For tests: replace the source of random numbers used for failures. */
  random?: () => number;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Fake SEO data that looks real. The same input on the same UTC day always gives the same
 * answer; the next day changes a little. Nothing here calls the network.
 */
export class MockSeoProvider implements SeoDataProvider {
  readonly name = "mock" as const;
  private readonly latencyMs: number;
  private readonly failureRate: number;
  private readonly auditSeconds: number;
  private readonly now: () => Date;
  private readonly random: () => number;

  constructor(options: MockOptions = {}) {
    this.latencyMs = options.latencyMs ?? 0;
    this.failureRate = options.failureRate ?? 0;
    this.auditSeconds = options.auditSeconds ?? 20;
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? Math.random;
  }

  private async call<T>(fn: () => T): Promise<ProviderResult<T>> {
    if (this.latencyMs > 0) await sleep(this.latencyMs);
    if (this.failureRate > 0 && this.random() < this.failureRate) {
      throw new ProviderError(
        "The mock provider failed on purpose (MOCK_FAILURE_RATE).",
        true,
        "MOCK_FAILURE",
      );
    }
    return { data: fn() };
  }

  async testConnection() {
    return { ok: true, balanceUsd: 100, message: "Mock provider. No real data." };
  }

  getRankings(i: {
    domain: string;
    keywords: string[];
    locationCode: number;
    languageCode: string;
    device: SearchDevice;
    priority: RankPriority;
  }): Promise<ProviderResult<RankResult[]>> {
    return this.call(() => {
      const day = dayNumber(this.now());
      const seen = new Set<string>();
      const results: RankResult[] = [];
      for (const raw of i.keywords) {
        const keyword = raw.trim().toLowerCase();
        if (!keyword || seen.has(keyword)) continue;
        seen.add(keyword);
        results.push(
          buildRankResult(
            {
              domain: i.domain.toLowerCase(),
              keyword,
              locationCode: i.locationCode,
              languageCode: i.languageCode,
              device: i.device,
            },
            day,
          ),
        );
      }
      return results;
    });
  }

  getKeywordIdeas(i: {
    seed: string;
    locationCode: number;
    languageCode: string;
    limit: number;
  }): Promise<ProviderResult<KeywordIdea[]>> {
    return this.call(() =>
      buildKeywordIdeas(i.seed, i.locationCode, i.languageCode, i.limit, this.now()),
    );
  }

  getKeywordMetrics(i: {
    keywords: string[];
    locationCode: number;
    languageCode: string;
  }): Promise<ProviderResult<KeywordMetric[]>> {
    return this.call(() =>
      buildKeywordMetrics({ keywords: i.keywords, day: dayNumber(this.now()) }),
    );
  }

  getReferringDomains(i: {
    domain: string;
    limit: number;
  }): Promise<ProviderResult<ReferringDomain[]>> {
    return this.call(() => buildReferringDomains(i.domain.toLowerCase(), i.limit));
  }

  getBingRankings(i: {
    domain: string;
    keywords: string[];
    locationCode: number;
    languageCode: string;
  }): Promise<ProviderResult<BingRank[]>> {
    return this.call(() =>
      buildBingRankings({
        domain: i.domain.toLowerCase(),
        keywords: i.keywords,
        day: dayNumber(this.now()),
      }),
    );
  }

  startAudit(i: {
    domain: string;
    maxPages: number;
    config?: AuditCrawlConfig;
  }): Promise<ProviderResult<{ taskId: string }>> {
    return this.call(() => ({
      taskId: makeAuditTaskId(
        i.domain.toLowerCase(),
        i.maxPages,
        this.now(),
        i.config?.excludePaths ?? [],
      ),
    }));
  }

  getAuditStatus(taskId: string): Promise<ProviderResult<AuditStatus>> {
    return this.call(() =>
      auditStatusAt(parseAuditTaskId(taskId).startedAt, this.now(), this.auditSeconds),
    );
  }

  getAuditResult(taskId: string): Promise<ProviderResult<AuditResult>> {
    return this.call(() => {
      const { domain, maxPages, startedAt, excludePaths } = parseAuditTaskId(taskId);
      if (auditStatusAt(startedAt, this.now(), this.auditSeconds).status !== "completed") {
        throw new ProviderError("The audit is not finished yet.", true, "NOT_READY");
      }
      return buildAuditResult(domain, maxPages, startedAt, excludePaths);
    });
  }

  getBacklinkSummary(domain: string): Promise<ProviderResult<BacklinkSummary>> {
    return this.call(() => buildBacklinkSummary(domain.toLowerCase(), this.now()));
  }

  getBacklinks(i: {
    domain: string;
    limit: number;
    offset: number;
  }): Promise<ProviderResult<Backlink[]>> {
    return this.call(() => {
      const now = this.now();
      const domain = i.domain.toLowerCase();
      const total = buildBacklinkSummary(domain, now).totalBacklinks;
      const count = Math.max(0, Math.min(i.limit, total - i.offset));
      return Array.from({ length: count }, (_, k) => buildBacklink(domain, i.offset + k, now));
    });
  }

  getRankedKeywords(i: {
    domain: string;
    locationCode: number;
    languageCode: string;
    limit: number;
  }): Promise<ProviderResult<RankedKeyword[]>> {
    return this.call(() =>
      buildRankedKeywords(i.domain.toLowerCase(), i.locationCode, i.languageCode, i.limit),
    );
  }

  checkAiVisibility(i: {
    prompt: string;
    brand: string;
    domain: string;
    engine: AiEngine;
  }): Promise<ProviderResult<AiVisibilityResult>> {
    return this.call(() =>
      buildAiVisibility({ ...i, domain: i.domain.toLowerCase(), day: dayNumber(this.now()) }),
    );
  }

  getAiTopicDemand(i: {
    seed: string;
    locationCode: number;
    languageCode: string;
    limit: number;
  }): Promise<ProviderResult<AiTopic[]>> {
    return this.call(() =>
      buildAiTopics({ seed: i.seed, limit: i.limit, day: dayNumber(this.now()) }),
    );
  }

  getLlmMentions(i: {
    domain: string;
    locationCode: number;
    languageCode: string;
  }): Promise<ProviderResult<LlmMentionsSummary[]>> {
    return this.call(() =>
      buildLlmMentions({ domain: i.domain.toLowerCase(), day: dayNumber(this.now()) }),
    );
  }

  getReviews(i: {
    businessName: string;
    locationCode: number;
  }): Promise<ProviderResult<ReviewSummary>> {
    return this.call(() => buildReviews(i.businessName, i.locationCode, this.now()));
  }

  estimateCostMicros(op: SeoOperation, units: number, priority?: RankPriority): number {
    return estimateCostMicros(op, units, priority);
  }
}
