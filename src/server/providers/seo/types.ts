/**
 * Internal types for SEO data. Real providers must map their own response shapes to these
 * (see `dataforseo/mappers`). Nothing outside a provider adapter sees a vendor shape.
 * Dates are ISO strings so results can be stored as JSON in the cache.
 */

export type SearchDevice = "desktop" | "mobile";
export type RankPriority = "standard" | "live";

export type SerpFeature =
  | "featured_snippet"
  | "people_also_ask"
  | "local_pack"
  | "image_pack"
  | "video"
  | "sitelinks"
  | "knowledge_panel";

export type SerpResult = { position: number; domain: string; url: string; title: string };

export type RankResult = {
  keyword: string;
  /** 1 to 100, or null when the domain is not in the top 100. */
  position: number | null;
  rankingUrl: string | null;
  serpFeatures: SerpFeature[];
  /** The top 10 results of the search. */
  topResults: SerpResult[];
};

export type KeywordIntent =
  "informational" | "commercial" | "transactional" | "navigational" | "local";

export type KeywordIdea = {
  keyword: string;
  /** Searches per month. */
  volume: number;
  /** Cost per click in micro-dollars (1,000,000 = $1). */
  cpcMicros: number;
  /** 0 (easy) to 100 (hard). */
  difficulty: number;
  intent: KeywordIntent;
  /** Searches per month for the last 12 months, oldest first. */
  trend: number[];
};

export type AuditSeverity = "CRITICAL" | "WARNING" | "NOTICE";

export type AuditIssueFound = {
  code: string;
  severity: AuditSeverity;
  url: string;
  details?: Record<string, string | number | boolean>;
};

export type AuditPageResult = {
  url: string;
  statusCode: number;
  title: string | null;
  loadTimeMs: number;
  wordCount: number;
  issueCount: number;
};

export type AuditStatus = {
  status: "queued" | "running" | "completed" | "failed";
  /** 0 to 100. */
  progress: number;
  error?: string;
};

export type AuditResult = {
  pagesCrawled: number;
  pages: AuditPageResult[];
  issues: AuditIssueFound[];
};

export type BacklinkSummary = {
  domain: string;
  totalBacklinks: number;
  referringDomains: number;
  dofollowPercent: number;
  newLast30Days: number;
  lostLast30Days: number;
  /** 0 to 100. */
  domainRating: number;
};

export type Backlink = {
  sourceUrl: string;
  sourceDomain: string;
  targetUrl: string;
  anchor: string;
  dofollow: boolean;
  firstSeen: string;
  lastSeen: string;
  /** Set when the link disappeared. */
  lostAt: string | null;
  sourceRating: number;
};

export type RankedKeyword = {
  keyword: string;
  position: number;
  volume: number;
  url: string;
};

export type AiEngine = "chatgpt" | "gemini" | "perplexity" | "google_ai_overview";

export type AiVisibilityResult = {
  engine: AiEngine;
  prompt: string;
  brandMentioned: boolean;
  domainCited: boolean;
  /** Where the brand shows up among the brands named in the answer (1 = first), or null. */
  mentionPosition: number | null;
  sentiment: "positive" | "neutral" | "negative" | null;
  answerSnippet: string;
  citedUrls: string[];
};

export type Review = {
  author: string;
  rating: number;
  text: string;
  publishedAt: string;
};

export type ReviewSummary = {
  businessName: string;
  rating: number;
  reviewCount: number;
  recent: Review[];
};

export type SeoOperation =
  | "rankings"
  | "keyword_ideas"
  | "audit_page"
  | "backlink_summary"
  | "backlinks"
  | "ranked_keywords"
  | "ai_visibility"
  | "reviews";

/** Modules that can each use a different provider (`SEO_PROVIDER_OVERRIDES`). */
export const SEO_MODULES = [
  "rankings",
  "keywords",
  "audit",
  "backlinks",
  "competitors",
  "ai",
  "reviews",
] as const;
export type SeoModule = (typeof SEO_MODULES)[number];

/** What a provider call returns. `costMicros` is the real cost when the vendor reports it. */
export type ProviderResult<T> = { data: T; costMicros?: number };

export interface SeoDataProvider {
  readonly name: "mock" | "dataforseo";
  testConnection(): Promise<{ ok: boolean; balanceUsd?: number; message?: string }>;
  getRankings(i: {
    domain: string;
    keywords: string[];
    locationCode: number;
    languageCode: string;
    device: SearchDevice;
    priority: RankPriority;
  }): Promise<ProviderResult<RankResult[]>>;
  getKeywordIdeas(i: {
    seed: string;
    locationCode: number;
    languageCode: string;
    limit: number;
  }): Promise<ProviderResult<KeywordIdea[]>>;
  startAudit(i: { domain: string; maxPages: number }): Promise<ProviderResult<{ taskId: string }>>;
  getAuditStatus(taskId: string): Promise<ProviderResult<AuditStatus>>;
  getAuditResult(taskId: string): Promise<ProviderResult<AuditResult>>;
  getBacklinkSummary(domain: string): Promise<ProviderResult<BacklinkSummary>>;
  getBacklinks(i: {
    domain: string;
    limit: number;
    offset: number;
  }): Promise<ProviderResult<Backlink[]>>;
  getRankedKeywords(i: {
    domain: string;
    locationCode: number;
    languageCode: string;
    limit: number;
  }): Promise<ProviderResult<RankedKeyword[]>>;
  checkAiVisibility(i: {
    prompt: string;
    brand: string;
    domain: string;
    engine: AiEngine;
  }): Promise<ProviderResult<AiVisibilityResult>>;
  getReviews(i: {
    businessName: string;
    locationCode: number;
  }): Promise<ProviderResult<ReviewSummary>>;
  /** Estimated cost in micro-dollars (1,000,000 = $1) for `units` of an operation. */
  estimateCostMicros(op: SeoOperation, units: number, priority?: RankPriority): number;
}
