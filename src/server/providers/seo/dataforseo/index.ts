import { logger } from "@/server/logger";
import { FeatureUnavailableError, ProviderError } from "../errors";
import { estimateCostMicros } from "../pricing";
import { assertTaskOk, DataForSeoClient } from "./client";
import { mapTasksReady, mapUserData } from "./mappers";
import { mapBacklinks, mapBacklinkSummary, mapReferringDomains } from "./mappers/backlinks";
import { mapKeywordIdeas, mapKeywordMetrics, mapRankedKeywords } from "./mappers/labs";
import { mapAuditPage, mapAuditStatus, mapSiteIssues } from "./mappers/onpage";
import { mapBingRank, mapSerpResult } from "./mappers/serp";
import type {
  AuditCrawlConfig,
  AuditIssueFound,
  AuditPageResult,
  AiEngine,
  AiTopic,
  BingRank,
  KeywordMetric,
  ListingResult,
  ReferringDomain,
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

/**
 * The real DataForSEO adapter. Calls use the Live endpoints, so every answer comes back at once.
 * Vendor response shapes are mapped to our own types in `./mappers`; nothing else knows them.
 * Directory listings, AI visibility, AI topics, AI mentions and reviews are not built yet and
 * throw FeatureUnavailableError.
 */
export type DataForSeoOptions = { login: string; password: string; baseUrl: string };

/** Paths that list finished tasks, per operation. Audit tasks are checked with the summary call instead (Step 8c). */
export const TASKS_READY_PATH: Record<string, string> = {
  rankings: "/v3/serp/google/organic/tasks_ready",
  reviews: "/v3/business_data/google/reviews/tasks_ready",
};

/** Live calls run a few at a time so one big keyword list does not flood the service. */
const LIVE_PARALLEL = 5;
const AUDIT_PAGE_SIZE = 500;
const MAX_AUDIT_PAGES = 5000;

export class DataForSeoProvider implements SeoDataProvider {
  readonly name = "dataforseo" as const;
  readonly client: DataForSeoClient;

  constructor(options: DataForSeoOptions & { client?: DataForSeoClient }) {
    this.client =
      options.client ??
      new DataForSeoClient({
        login: options.login,
        password: options.password,
        baseUrl: options.baseUrl,
        logger,
      });
  }

  /** Free call that checks the login and returns the account balance. */
  async testConnection(): Promise<{ ok: boolean; balanceUsd?: number; message?: string }> {
    try {
      const { response } = await this.client.get<{ login?: string; money?: { balance?: number } }>(
        "/v3/appendix/user_data",
      );
      return mapUserData(response);
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Could not reach DataForSEO.",
      };
    }
  }

  /** Ids of finished tasks for an operation (used by the poll job). Returns [] if the operation has no such call. */
  async listReadyTaskIds(operation: string): Promise<string[]> {
    const path = TASKS_READY_PATH[operation];
    if (!path) return [];
    const { response } = await this.client.get<{ id: string; tag?: string }>(path);
    return mapTasksReady(response).map((task) => task.id);
  }
  /** One Live call. Returns the first task's result list and what it cost. */
  private async live(
    path: string,
    body: unknown,
  ): Promise<{ result: unknown[]; costMicros: number }> {
    const { tasks, costMicros } = await this.client.post(path, [body]);
    const task = tasks[0];
    if (!task) throw new ProviderError("DataForSEO returned no task.", true, "SERVER");
    assertTaskOk(task);
    return { result: task.result ?? [], costMicros };
  }

  /** Runs one Live call per item, a few at a time, and adds up the cost. */
  private async liveEach<T>(
    items: T[],
    run: (item: T) => Promise<{ result: unknown[]; costMicros: number }>,
  ): Promise<{ results: unknown[][]; costMicros: number }> {
    const results: unknown[][] = [];
    let costMicros = 0;
    for (let i = 0; i < items.length; i += LIVE_PARALLEL) {
      const done = await Promise.all(items.slice(i, i + LIVE_PARALLEL).map(run));
      for (const d of done) {
        results.push(d.result);
        costMicros += d.costMicros;
      }
    }
    return { results, costMicros };
  }

  async getRankings(i: {
    domain: string;
    keywords: string[];
    locationCode: number;
    languageCode: string;
    device: SearchDevice;
    priority: RankPriority;
  }): Promise<ProviderResult<RankResult[]>> {
    // The Live endpoint answers at once for both priorities. The cheaper queued (Standard)
    // route is a later cost saving.
    const { results, costMicros } = await this.liveEach(i.keywords, (keyword) =>
      this.live("/v3/serp/google/organic/live/advanced", {
        keyword,
        location_code: i.locationCode,
        language_code: i.languageCode,
        device: i.device,
        depth: 100,
      }),
    );
    return {
      data: i.keywords.map((keyword, n) => mapSerpResult(keyword, i.domain, results[n]?.[0])),
      costMicros,
    };
  }

  async getKeywordIdeas(i: {
    seed: string;
    locationCode: number;
    languageCode: string;
    limit: number;
  }): Promise<ProviderResult<KeywordIdea[]>> {
    const { result, costMicros } = await this.live(
      "/v3/dataforseo_labs/google/keyword_ideas/live",
      {
        keywords: [i.seed],
        location_code: i.locationCode,
        language_code: i.languageCode,
        limit: Math.min(Math.max(i.limit, 1), 1000),
        include_serp_info: false,
      },
    );
    return { data: mapKeywordIdeas(result[0]), costMicros };
  }

  async getKeywordMetrics(i: {
    keywords: string[];
    locationCode: number;
    languageCode: string;
  }): Promise<ProviderResult<KeywordMetric[]>> {
    const common = { location_code: i.locationCode, language_code: i.languageCode };
    const [volume, difficulty] = await Promise.all([
      this.live("/v3/keywords_data/google_ads/search_volume/live", {
        keywords: i.keywords,
        ...common,
      }),
      this.live("/v3/dataforseo_labs/google/bulk_keyword_difficulty/live", {
        keywords: i.keywords,
        ...common,
      }),
    ]);
    return {
      data: mapKeywordMetrics(i.keywords, volume.result, difficulty.result[0]),
      costMicros: volume.costMicros + difficulty.costMicros,
    };
  }

  async getBingRankings(i: {
    domain: string;
    keywords: string[];
    locationCode: number;
    languageCode: string;
  }): Promise<ProviderResult<BingRank[]>> {
    const { results, costMicros } = await this.liveEach(i.keywords, (keyword) =>
      this.live("/v3/serp/bing/organic/live/advanced", {
        keyword,
        location_code: i.locationCode,
        language_code: i.languageCode,
        depth: 100,
      }),
    );
    return {
      data: i.keywords.map((keyword, n) => mapBingRank(keyword, i.domain, results[n]?.[0])),
      costMicros,
    };
  }

  async getReferringDomains(i: {
    domain: string;
    limit: number;
  }): Promise<ProviderResult<ReferringDomain[]>> {
    const { result, costMicros } = await this.live("/v3/backlinks/referring_domains/live", {
      target: i.domain,
      limit: Math.min(Math.max(i.limit, 1), 1000),
      include_subdomains: true,
      order_by: ["rank,desc"],
    });
    return { data: mapReferringDomains(result[0]), costMicros };
  }

  async getBacklinkSummary(domain: string): Promise<ProviderResult<BacklinkSummary>> {
    const from = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const [summary, series] = await Promise.all([
      this.live("/v3/backlinks/summary/live", { target: domain, include_subdomains: true }),
      this.live("/v3/backlinks/timeseries_new_lost_summary/live", {
        target: domain,
        date_from: from,
        group_range: "month",
      }),
    ]);
    return {
      data: mapBacklinkSummary(domain, summary.result[0], series.result[0]),
      costMicros: summary.costMicros + series.costMicros,
    };
  }

  async getBacklinks(i: {
    domain: string;
    limit: number;
    offset: number;
  }): Promise<ProviderResult<Backlink[]>> {
    const { result, costMicros } = await this.live("/v3/backlinks/backlinks/live", {
      target: i.domain,
      mode: "as_is",
      include_subdomains: true,
      backlinks_status_type: "all",
      limit: Math.min(Math.max(i.limit, 1), 1000),
      offset: Math.max(i.offset, 0),
      order_by: ["rank,desc"],
    });
    return { data: mapBacklinks(result[0]), costMicros };
  }

  async getRankedKeywords(i: {
    domain: string;
    locationCode: number;
    languageCode: string;
    limit: number;
  }): Promise<ProviderResult<RankedKeyword[]>> {
    const { result, costMicros } = await this.live(
      "/v3/dataforseo_labs/google/ranked_keywords/live",
      {
        target: i.domain,
        location_code: i.locationCode,
        language_code: i.languageCode,
        limit: Math.min(Math.max(i.limit, 1), 1000),
        order_by: ["ranked_serp_element.serp_item.rank_group,asc"],
      },
    );
    return { data: mapRankedKeywords(result[0]), costMicros };
  }

  async startAudit(i: {
    domain: string;
    maxPages: number;
    config?: AuditCrawlConfig;
  }): Promise<ProviderResult<{ taskId: string }>> {
    const { tasks, costMicros } = await this.client.post("/v3/on_page/task_post", [
      {
        target: i.domain,
        max_crawl_pages: Math.min(Math.max(i.maxPages, 1), 10_000),
        load_resources: true,
        enable_javascript: false,
        validate_micromarkup: true,
        ...(i.config?.mobile ? { browser_preset: "mobile" } : {}),
      },
    ]);
    const task = tasks[0];
    if (!task) throw new ProviderError("DataForSEO returned no task.", true, "SERVER");
    assertTaskOk(task);
    return { data: { taskId: task.id }, costMicros };
  }

  private async auditSummary(taskId: string) {
    const { tasks, costMicros } = await this.client.get(
      `/v3/on_page/summary/${encodeURIComponent(taskId)}`,
    );
    const task = tasks[0];
    if (!task) throw new ProviderError("DataForSEO returned no task.", true, "SERVER");
    assertTaskOk(task);
    return { summary: task.result?.[0], costMicros };
  }

  async getAuditStatus(taskId: string): Promise<ProviderResult<AuditStatus>> {
    const { summary, costMicros } = await this.auditSummary(taskId);
    return { data: mapAuditStatus(summary), costMicros };
  }

  async getAuditResult(taskId: string): Promise<ProviderResult<AuditResult>> {
    const { summary, costMicros: first } = await this.auditSummary(taskId);
    const domain = String(
      (summary as { domain_info?: { name?: string } } | undefined)?.domain_info?.name ?? "",
    );
    const pages: AuditPageResult[] = [];
    const issues: AuditIssueFound[] = mapSiteIssues(domain, summary);
    let costMicros = first;
    for (let offset = 0; offset < MAX_AUDIT_PAGES; offset += AUDIT_PAGE_SIZE) {
      const { result, costMicros: c } = await this.live("/v3/on_page/pages", {
        id: taskId,
        limit: AUDIT_PAGE_SIZE,
        offset,
      });
      costMicros += c;
      const items = ((result[0] as { items?: unknown[] } | undefined)?.items ?? []) as unknown[];
      for (const item of items) {
        const mapped = mapAuditPage(item);
        pages.push(mapped.page);
        issues.push(...mapped.issues);
      }
      if (items.length < AUDIT_PAGE_SIZE) break;
    }
    return { data: { pagesCrawled: pages.length, pages, issues, diagnostics: null }, costMicros };
  }

  getListings(_i: {
    name: string;
    address: string;
    phone: string;
    city: string;
    sources: string[];
  }): Promise<ProviderResult<ListingResult[]>> {
    throw new FeatureUnavailableError("Directory listing checks", "DataForSEO");
  }
  checkAiVisibility(_i: {
    prompt: string;
    brand: string;
    domain: string;
    engine: AiEngine;
  }): Promise<ProviderResult<AiVisibilityResult>> {
    throw new FeatureUnavailableError("AI visibility checks", "DataForSEO");
  }
  getAiTopicDemand(_i: {
    seed: string;
    locationCode: number;
    languageCode: string;
    limit: number;
  }): Promise<ProviderResult<AiTopic[]>> {
    throw new FeatureUnavailableError("AI topic demand", "DataForSEO");
  }
  getLlmMentions(_i: {
    domain: string;
    locationCode: number;
    languageCode: string;
  }): Promise<ProviderResult<LlmMentionsSummary[]>> {
    throw new FeatureUnavailableError("AI answer mentions", "DataForSEO");
  }
  getReviews(_i: {
    businessName: string;
    locationCode: number;
  }): Promise<ProviderResult<ReviewSummary>> {
    throw new FeatureUnavailableError("Review tracking", "DataForSEO");
  }
  estimateCostMicros(op: SeoOperation, units: number, priority?: RankPriority): number {
    return estimateCostMicros(op, units, priority);
  }
}
