import { createHash } from "node:crypto";
import type { Prisma, PrismaClient, UsageMetric } from "@prisma/client";
import type { LockStore } from "@/server/locks";
import { ProviderError } from "@/server/providers/seo/errors";
import type {
  AiEngine,
  AiVisibilityResult,
  AuditResult,
  AuditStatus,
  Backlink,
  BacklinkSummary,
  KeywordIdea,
  RankedKeyword,
  RankPriority,
  RankResult,
  ReviewSummary,
  SearchDevice,
  SeoDataProvider,
  SeoModule,
  SeoOperation,
} from "@/server/providers/seo/types";

/** Who is asking. The gateway records usage against this agency. */
export type GatewayCaller = { agencyId: string; projectId?: string };

export type GatewayResult<T> = {
  data: T;
  /** True when the answer came from the cache (or from a call another request just finished). */
  cached: boolean;
  /** Cost of the provider call that this request caused, in micro-dollars. 0 for cached answers. */
  costMicros: number;
  /** Which provider produced the data ("mock", "dataforseo"). */
  provider: string;
};

/**
 * Hook for plan limits and the platform budget (Step 9). It runs before a real provider call.
 * Throw to block the call. It is not called for cached answers.
 */
export type GatewayGuard = {
  beforeCall(input: {
    caller: GatewayCaller;
    metric: UsageMetric;
    units: number;
    costMicros: number;
  }): Promise<void>;
};

export type GatewayDeps = {
  provider: (module: SeoModule) => SeoDataProvider;
  /** Needs the `providerCache` and `usageRecord` tables. */
  db: Pick<PrismaClient, "providerCache" | "usageRecord">;
  locks: LockStore;
  now?: () => Date;
  guard?: GatewayGuard;
  /** How long a request waits for another identical request before giving up. */
  lockWaitMs?: number;
  /** How often a waiting request looks at the cache. */
  pollMs?: number;
};

const DAY_MS = 86_400_000;

/** Same value, same text: object keys are sorted so key order does not change the hash. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function requestHash(
  provider: string,
  operation: string,
  input: unknown,
  day?: string,
): string {
  return createHash("sha256")
    .update([provider, operation, stableStringify(input), day ?? ""].join("|"))
    .digest("hex");
}

const utcDay = (d: Date) => d.toISOString().slice(0, 10);
const endOfUtcDay = (d: Date) => new Date((Math.floor(d.getTime() / DAY_MS) + 1) * DAY_MS);

type CachedCall<T> = {
  module: SeoModule;
  /** Name stored on cache and usage rows. */
  operation: string;
  /** Cost table entry. */
  costOperation: SeoOperation;
  input: unknown;
  /** Rankings are different every day, so their hash includes the date. */
  perDay?: boolean;
  /** Seconds the answer stays in the cache. A function can look at the current time. */
  expiresAt: (now: Date) => Date;
  metric: UsageMetric;
  units: number | ((data: T) => number);
  priority?: RankPriority;
  caller: GatewayCaller;
  run: (provider: SeoDataProvider) => Promise<{ data: T; costMicros?: number }>;
};

/**
 * The only door to SEO data. Every module calls the provider through here so that
 * caching, duplicate suppression, usage records and cost tracking happen in one place.
 */
export class SeoGateway {
  private readonly now: () => Date;
  private readonly lockWaitMs: number;
  private readonly pollMs: number;

  constructor(private readonly deps: GatewayDeps) {
    this.now = deps.now ?? (() => new Date());
    this.lockWaitMs = deps.lockWaitMs ?? 30_000;
    this.pollMs = deps.pollMs ?? 100;
  }

  private async readCache<T>(hash: string): Promise<{ data: T; provider: string } | null> {
    const row = await this.deps.db.providerCache.findUnique({ where: { requestHash: hash } });
    if (!row || row.expiresAt <= this.now()) return null;
    return { data: row.response as unknown as T, provider: row.provider };
  }

  private async cachedCall<T>(call: CachedCall<T>): Promise<GatewayResult<T>> {
    const provider = this.deps.provider(call.module);
    const now = this.now();
    const hash = requestHash(
      provider.name,
      call.operation,
      call.input,
      call.perDay ? utcDay(now) : undefined,
    );

    const hit = await this.readCache<T>(hash);
    if (hit) return { ...hit, cached: true, costMicros: 0 };

    const lockKey = `seo:${hash}`;
    const deadline = Date.now() + this.lockWaitMs;
    let token: string | null = null;
    while (!(token = await this.deps.locks.acquire(lockKey, 60_000))) {
      // Someone else is asking the provider the same thing. Wait for their answer.
      await new Promise((resolve) => setTimeout(resolve, this.pollMs));
      const waited = await this.readCache<T>(hash);
      if (waited) return { ...waited, cached: true, costMicros: 0 };
      if (Date.now() > deadline) {
        throw new ProviderError(
          "Another identical request is taking too long. Please try again.",
          true,
          "LOCK_TIMEOUT",
        );
      }
    }

    try {
      // The other request may have finished between our cache check and getting the lock.
      const again = await this.readCache<T>(hash);
      if (again) return { ...again, cached: true, costMicros: 0 };

      if (this.deps.guard && typeof call.units === "number") {
        await this.deps.guard.beforeCall({
          caller: call.caller,
          metric: call.metric,
          units: call.units,
          costMicros: provider.estimateCostMicros(call.costOperation, call.units, call.priority),
        });
      }

      const result = await call.run(provider);
      const units = typeof call.units === "function" ? call.units(result.data) : call.units;
      const costMicros =
        result.costMicros ?? provider.estimateCostMicros(call.costOperation, units, call.priority);

      await this.deps.db.providerCache.upsert({
        where: { requestHash: hash },
        create: {
          provider: provider.name,
          operation: call.operation,
          requestHash: hash,
          response: result.data as unknown as Prisma.InputJsonValue,
          expiresAt: call.expiresAt(now),
        },
        update: {
          response: result.data as unknown as Prisma.InputJsonValue,
          expiresAt: call.expiresAt(now),
        },
      });
      await this.deps.db.usageRecord.create({
        data: {
          agencyId: call.caller.agencyId,
          projectId: call.caller.projectId,
          metric: call.metric,
          quantity: units,
          costMicros,
          provider: provider.name,
          operation: call.operation,
          requestHash: hash,
        },
      });
      return { data: result.data, cached: false, costMicros, provider: provider.name };
    } finally {
      await this.deps.locks.release(lockKey, token);
    }
  }

  /** Not cached and not counted: starting an audit and checking progress are cheap steps. */
  private async plain<T>(
    module: SeoModule,
    run: (p: SeoDataProvider) => Promise<{ data: T }>,
  ): Promise<T> {
    return (await run(this.deps.provider(module))).data;
  }

  getRankings(
    caller: GatewayCaller,
    input: {
      domain: string;
      keywords: string[];
      locationCode: number;
      languageCode: string;
      device: SearchDevice;
      priority?: RankPriority;
    },
  ): Promise<GatewayResult<RankResult[]>> {
    const priority = input.priority ?? "standard";
    const keywords = [
      ...new Set(input.keywords.map((k) => k.trim().toLowerCase()).filter(Boolean)),
    ].sort();
    const normalized = { ...input, domain: input.domain.toLowerCase(), keywords, priority };
    return this.cachedCall({
      module: "rankings",
      operation: priority === "live" ? "rankings_live" : "rankings",
      costOperation: "rankings",
      input: normalized,
      perDay: true,
      expiresAt: endOfUtcDay,
      metric: priority === "live" ? "LIVE_CHECK" : "RANK_CHECK",
      units: keywords.length,
      priority,
      caller,
      run: (p) => p.getRankings(normalized),
    });
  }

  getKeywordIdeas(
    caller: GatewayCaller,
    input: { seed: string; locationCode: number; languageCode: string; limit: number },
  ): Promise<GatewayResult<KeywordIdea[]>> {
    const normalized = { ...input, seed: input.seed.trim().toLowerCase().replace(/\s+/g, " ") };
    return this.cachedCall({
      module: "keywords",
      operation: "keyword_ideas",
      costOperation: "keyword_ideas",
      input: normalized,
      expiresAt: (now) => new Date(now.getTime() + 30 * DAY_MS),
      metric: "KEYWORD_RESEARCH",
      units: 1,
      caller,
      run: (p) => p.getKeywordIdeas(normalized),
    });
  }

  startAudit(
    _caller: GatewayCaller,
    input: { domain: string; maxPages: number },
  ): Promise<{ taskId: string }> {
    return this.plain("audit", (p) => p.startAudit(input));
  }

  getAuditStatus(taskId: string): Promise<AuditStatus> {
    return this.plain("audit", (p) => p.getAuditStatus(taskId));
  }

  /** The result is cached by task id, and usage (one unit per crawled page) is written once. */
  getAuditResult(caller: GatewayCaller, taskId: string): Promise<GatewayResult<AuditResult>> {
    return this.cachedCall({
      module: "audit",
      operation: "audit_result",
      costOperation: "audit_page",
      input: { taskId },
      expiresAt: (now) => new Date(now.getTime() + 30 * DAY_MS),
      metric: "AUDIT_PAGE",
      units: (data) => data.pagesCrawled,
      caller,
      run: (p) => p.getAuditResult(taskId),
    });
  }

  /**
   * The result of a lead widget mini audit. It counts as one lead audit (not as audit pages), and
   * the cost is that of the pages crawled.
   */
  getLeadAuditResult(caller: GatewayCaller, taskId: string): Promise<GatewayResult<AuditResult>> {
    return this.cachedCall({
      module: "audit",
      operation: "lead_audit_result",
      costOperation: "audit_page",
      input: { taskId },
      expiresAt: (now) => new Date(now.getTime() + 7 * DAY_MS),
      metric: "LEAD_AUDIT",
      units: 1,
      caller,
      run: async (p) => {
        const result = await p.getAuditResult(taskId);
        return {
          data: result.data,
          costMicros: p.estimateCostMicros("audit_page", result.data.pagesCrawled),
        };
      },
    });
  }

  getBacklinkSummary(
    caller: GatewayCaller,
    domain: string,
  ): Promise<GatewayResult<BacklinkSummary>> {
    const normalized = { domain: domain.toLowerCase() };
    return this.cachedCall({
      module: "backlinks",
      operation: "backlink_summary",
      costOperation: "backlink_summary",
      input: normalized,
      expiresAt: (now) => new Date(now.getTime() + 7 * DAY_MS),
      metric: "BACKLINK_QUERY",
      units: 1,
      caller,
      run: (p) => p.getBacklinkSummary(normalized.domain),
    });
  }

  getBacklinks(
    caller: GatewayCaller,
    input: { domain: string; limit: number; offset: number },
  ): Promise<GatewayResult<Backlink[]>> {
    const normalized = { ...input, domain: input.domain.toLowerCase() };
    return this.cachedCall({
      module: "backlinks",
      operation: "backlinks",
      costOperation: "backlinks",
      input: normalized,
      expiresAt: (now) => new Date(now.getTime() + 7 * DAY_MS),
      metric: "BACKLINK_QUERY",
      units: input.limit,
      caller,
      run: (p) => p.getBacklinks(normalized),
    });
  }

  getRankedKeywords(
    caller: GatewayCaller,
    input: { domain: string; locationCode: number; languageCode: string; limit: number },
  ): Promise<GatewayResult<RankedKeyword[]>> {
    const normalized = { ...input, domain: input.domain.toLowerCase() };
    return this.cachedCall({
      module: "competitors",
      operation: "ranked_keywords",
      costOperation: "ranked_keywords",
      input: normalized,
      expiresAt: (now) => new Date(now.getTime() + 7 * DAY_MS),
      metric: "COMPETITOR_QUERY",
      units: input.limit,
      caller,
      run: (p) => p.getRankedKeywords(normalized),
    });
  }

  checkAiVisibility(
    caller: GatewayCaller,
    input: { prompt: string; brand: string; domain: string; engine: AiEngine },
  ): Promise<GatewayResult<AiVisibilityResult>> {
    const normalized = { ...input, domain: input.domain.toLowerCase() };
    return this.cachedCall({
      module: "ai",
      operation: "ai_visibility",
      costOperation: "ai_visibility",
      input: normalized,
      perDay: true,
      expiresAt: endOfUtcDay,
      metric: "AI_CHECK",
      units: 1,
      caller,
      run: (p) => p.checkAiVisibility(normalized),
    });
  }

  getReviews(
    caller: GatewayCaller,
    input: { businessName: string; locationCode: number },
  ): Promise<GatewayResult<ReviewSummary>> {
    return this.cachedCall({
      module: "reviews",
      operation: "reviews",
      costOperation: "reviews",
      input,
      perDay: true,
      expiresAt: endOfUtcDay,
      metric: "REVIEW_QUERY",
      units: 1,
      caller,
      run: (p) => p.getReviews(input),
    });
  }
}
