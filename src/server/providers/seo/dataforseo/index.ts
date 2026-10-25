import { logger } from "@/server/logger";
import { NotImplementedError } from "../errors";
import { estimateCostMicros } from "../pricing";
import { DataForSeoClient } from "./client";
import { mapTasksReady, mapUserData } from "./mappers";
import type {
  AiEngine,
  AiTopic,
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
 * Placeholder for the real DataForSEO adapter. Step 8b adds the HTTP client and a working
 * `testConnection()`; Step 8c implements the rest against the free sandbox.
 * Vendor response shapes will be mapped to our own types in `./mappers`.
 */
export type DataForSeoOptions = { login: string; password: string; baseUrl: string };

/** Paths that list finished tasks, per operation. Audit tasks are checked with the summary call instead (Step 8c). */
export const TASKS_READY_PATH: Record<string, string> = {
  rankings: "/v3/serp/google/organic/tasks_ready",
  reviews: "/v3/business_data/google/reviews/tasks_ready",
};

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
  getRankings(_i: {
    domain: string;
    keywords: string[];
    locationCode: number;
    languageCode: string;
    device: SearchDevice;
    priority: RankPriority;
  }): Promise<ProviderResult<RankResult[]>> {
    throw new NotImplementedError("DataForSEO getRankings");
  }
  getKeywordIdeas(_i: {
    seed: string;
    locationCode: number;
    languageCode: string;
    limit: number;
  }): Promise<ProviderResult<KeywordIdea[]>> {
    throw new NotImplementedError("DataForSEO getKeywordIdeas");
  }
  startAudit(_i: {
    domain: string;
    maxPages: number;
  }): Promise<ProviderResult<{ taskId: string }>> {
    throw new NotImplementedError("DataForSEO startAudit");
  }
  getAuditStatus(_taskId: string): Promise<ProviderResult<AuditStatus>> {
    throw new NotImplementedError("DataForSEO getAuditStatus");
  }
  getAuditResult(_taskId: string): Promise<ProviderResult<AuditResult>> {
    throw new NotImplementedError("DataForSEO getAuditResult");
  }
  getBacklinkSummary(_domain: string): Promise<ProviderResult<BacklinkSummary>> {
    throw new NotImplementedError("DataForSEO getBacklinkSummary");
  }
  getBacklinks(_i: {
    domain: string;
    limit: number;
    offset: number;
  }): Promise<ProviderResult<Backlink[]>> {
    throw new NotImplementedError("DataForSEO getBacklinks");
  }
  getRankedKeywords(_i: {
    domain: string;
    locationCode: number;
    languageCode: string;
    limit: number;
  }): Promise<ProviderResult<RankedKeyword[]>> {
    throw new NotImplementedError("DataForSEO getRankedKeywords");
  }
  checkAiVisibility(_i: {
    prompt: string;
    brand: string;
    domain: string;
    engine: AiEngine;
  }): Promise<ProviderResult<AiVisibilityResult>> {
    throw new NotImplementedError("DataForSEO checkAiVisibility");
  }
  getAiTopicDemand(_i: {
    seed: string;
    locationCode: number;
    languageCode: string;
    limit: number;
  }): Promise<ProviderResult<AiTopic[]>> {
    throw new NotImplementedError("DataForSEO getAiTopicDemand");
  }
  getLlmMentions(_i: {
    domain: string;
    locationCode: number;
    languageCode: string;
  }): Promise<ProviderResult<LlmMentionsSummary[]>> {
    throw new NotImplementedError("DataForSEO getLlmMentions");
  }
  getReviews(_i: {
    businessName: string;
    locationCode: number;
  }): Promise<ProviderResult<ReviewSummary>> {
    throw new NotImplementedError("DataForSEO getReviews");
  }
  estimateCostMicros(op: SeoOperation, units: number, priority?: RankPriority): number {
    return estimateCostMicros(op, units, priority);
  }
}
