import { NotImplementedError } from "../errors";
import { estimateCostMicros } from "../pricing";
import type {
  AiEngine,
  AiVisibilityResult,
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
export class DataForSeoProvider implements SeoDataProvider {
  readonly name = "dataforseo" as const;

  testConnection(): Promise<{ ok: boolean; balanceUsd?: number; message?: string }> {
    throw new NotImplementedError("DataForSEO testConnection");
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
