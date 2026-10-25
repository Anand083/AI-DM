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

/** Search numbers for one exact phrase (not ideas around it). */
export type KeywordMetric = {
  keyword: string;
  /** Searches per month. Null when the vendor has no number for the phrase. */
  volume: number | null;
  /** Cost per click in micro-dollars. */
  cpcMicros: number | null;
  /** 0 (easy) to 100 (hard). */
  difficulty: number | null;
  /** Searches per month for the last 12 months, oldest first. Empty when unknown. */
  trend: number[];
};

/** A rank on the Bing search engine. */
export type BingRank = { keyword: string; position: number | null; url: string | null };

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
  /** Core Web Vitals when the vendor measured them. LCP and INP in ms, CLS times 1000. */
  lcpMs?: number | null;
  cls?: number | null;
  inpMs?: number | null;
};

/** What the crawl found out about robots.txt and the sitemap. */
export type SiteDiagnostics = {
  robots: {
    found: boolean;
    /** True when the file tells every crawler to stay away from the whole site. */
    blocksAll: boolean;
    disallowRules: number;
    sitemapUrls: string[];
  };
  sitemap: {
    found: boolean;
    urls: number;
    /** Listed addresses that were broken, redirected or blocked. */
    badUrls: number;
  };
};

/** Crawl settings of a project. */
export type AuditCrawlConfig = {
  /** Address paths to skip, for example /cart. */
  excludePaths: string[];
  respectRobots: boolean;
  mobile: boolean;
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
  diagnostics?: SiteDiagnostics | null;
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

export type AiEngine = "chatgpt" | "gemini" | "perplexity" | "claude" | "google_ai_overview";

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

/** How much people ask AI assistants about a topic. Estimated by the vendor, not exact. */
export type AiTopic = {
  topic: string;
  /** Estimated AI searches a month. */
  aiSearchVolume: number;
  /** Change over the last 3 months, in percent. */
  changePercent: number;
};

/** How often AI answers about the field name a domain. Only some engines are covered. */
export type LlmMentionsSummary = {
  engine: "google_ai_overview" | "chatgpt";
  /** Answers that mention or link to the domain. */
  mentions: number;
  /** Estimated AI searches a month of the questions that led to those mentions. */
  aiSearchVolume: number;
  topQuestions: { question: string; mentions: number }[];
};

/** One website that links to a domain. */
export type ReferringDomain = {
  domain: string;
  /** 0 to 100, the authority of the linking website. */
  rating: number;
  /** How many links it has to the domain. */
  backlinks: number;
};

/** What one directory shows for a business. */
export type ListingResult = {
  source: string;
  found: boolean;
  name: string | null;
  address: string | null;
  phone: string | null;
  url: string | null;
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
  | "keyword_metrics"
  | "bing_rankings"
  | "referring_domains"
  | "listings"
  | "ai_topics"
  | "llm_mentions"
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
  getKeywordMetrics(i: {
    keywords: string[];
    locationCode: number;
    languageCode: string;
  }): Promise<ProviderResult<KeywordMetric[]>>;
  getBingRankings(i: {
    domain: string;
    keywords: string[];
    locationCode: number;
    languageCode: string;
  }): Promise<ProviderResult<BingRank[]>>;
  getReferringDomains(i: {
    domain: string;
    limit: number;
  }): Promise<ProviderResult<ReferringDomain[]>>;
  getListings(i: {
    name: string;
    address: string;
    phone: string;
    city: string;
    sources: string[];
  }): Promise<ProviderResult<ListingResult[]>>;
  startAudit(i: {
    domain: string;
    maxPages: number;
    config?: AuditCrawlConfig;
  }): Promise<ProviderResult<{ taskId: string }>>;
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
  getAiTopicDemand(i: {
    seed: string;
    locationCode: number;
    languageCode: string;
    limit: number;
  }): Promise<ProviderResult<AiTopic[]>>;
  getLlmMentions(i: {
    domain: string;
    locationCode: number;
    languageCode: string;
  }): Promise<ProviderResult<LlmMentionsSummary[]>>;
  getReviews(i: {
    businessName: string;
    locationCode: number;
  }): Promise<ProviderResult<ReviewSummary>>;
  /** Estimated cost in micro-dollars (1,000,000 = $1) for `units` of an operation. */
  estimateCostMicros(op: SeoOperation, units: number, priority?: RankPriority): number;
}
