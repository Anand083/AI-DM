import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mapAuditPage, mapAuditStatus } from "./mappers/onpage";
import { DataForSeoProvider } from "./index";

/**
 * These tests run the adapter against made-up responses written from the vendor documentation.
 * They prove our mapping and request shapes, not that the vendor's real answers look the same.
 * `scripts/dataforseo-check.ts` runs the same calls against the free Sandbox for that.
 */
const BASE = "https://sandbox.dataforseo.test";
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const reply = (result: unknown[], cost = 0.002) =>
  HttpResponse.json({
    status_code: 20000,
    status_message: "Ok.",
    cost,
    tasks: [{ id: "t1", status_code: 20000, status_message: "Ok.", result }],
  });

const provider = () => new DataForSeoProvider({ login: "a@b.test", password: "x", baseUrl: BASE });

describe("rankings", () => {
  it("finds the domain, top results and features, and adds up the cost", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(`${BASE}/v3/serp/google/organic/live/advanced`, async ({ request }) => {
        const body = (await request.json()) as { keyword: string }[];
        bodies.push(body[0]);
        const kw = body[0]!.keyword;
        return reply(
          [
            {
              items:
                kw === "running shoes"
                  ? [
                      { type: "featured_snippet", rank_group: 1 },
                      {
                        type: "organic",
                        rank_group: 1,
                        domain: "other.com",
                        url: "https://other.com/a",
                        title: "A",
                      },
                      {
                        type: "organic",
                        rank_group: 2,
                        domain: "www.shoes.test",
                        url: "https://www.shoes.test/run",
                        title: "Run",
                        links: [{ title: "x" }],
                      },
                      { type: "people_also_ask" },
                    ]
                  : [
                      {
                        type: "organic",
                        rank_group: 1,
                        domain: "other.com",
                        url: "https://other.com",
                        title: "O",
                      },
                    ],
            },
          ],
          0.002,
        );
      }),
    );
    const out = await provider().getRankings({
      domain: "shoes.test",
      keywords: ["running shoes", "no match"],
      locationCode: 2840,
      languageCode: "en",
      device: "mobile",
      priority: "standard",
    });
    expect(bodies[0]).toMatchObject({
      keyword: "running shoes",
      location_code: 2840,
      language_code: "en",
      device: "mobile",
      depth: 100,
    });
    expect(out.costMicros).toBe(4000);
    const [a, b] = out.data;
    expect(a).toMatchObject({
      keyword: "running shoes",
      position: 2,
      rankingUrl: "https://www.shoes.test/run",
    });
    expect(a!.serpFeatures.sort()).toEqual(["featured_snippet", "people_also_ask", "sitelinks"]);
    expect(a!.topResults.map((r) => r.position)).toEqual([1, 2]);
    expect(b).toMatchObject({ position: null, rankingUrl: null });
  });

  it("reads Bing positions", async () => {
    server.use(
      http.post(`${BASE}/v3/serp/bing/organic/live/advanced`, () =>
        reply([
          {
            items: [
              { type: "organic", rank_group: 4, domain: "shoes.test", url: "https://shoes.test/" },
            ],
          },
        ]),
      ),
    );
    const out = await provider().getBingRankings({
      domain: "shoes.test",
      keywords: ["x"],
      locationCode: 2840,
      languageCode: "en",
    });
    expect(out.data).toEqual([{ keyword: "x", position: 4, url: "https://shoes.test/" }]);
  });
});

describe("keywords", () => {
  it("maps ideas with trend, cost per click and intent", async () => {
    server.use(
      http.post(`${BASE}/v3/dataforseo_labs/google/keyword_ideas/live`, () =>
        reply([
          {
            items: [
              {
                keyword: "trail shoes",
                keyword_info: {
                  search_volume: 1200,
                  cpc: 1.25,
                  monthly_searches: [
                    { year: 2026, month: 2, search_volume: 10 },
                    { year: 2025, month: 12, search_volume: 8 },
                    { year: 2026, month: 1, search_volume: 9 },
                  ],
                },
                keyword_properties: { keyword_difficulty: 140 },
                search_intent_info: { main_intent: "transactional" },
              },
              { keyword: "", keyword_info: {} },
            ],
          },
        ]),
      ),
    );
    const out = await provider().getKeywordIdeas({
      seed: "shoes",
      locationCode: 2840,
      languageCode: "en",
      limit: 50,
    });
    expect(out.data).toEqual([
      {
        keyword: "trail shoes",
        volume: 1200,
        cpcMicros: 1_250_000,
        difficulty: 100,
        intent: "transactional",
        trend: [8, 9, 10],
      },
    ]);
  });

  it("joins search volume and difficulty by phrase and keeps unknown ones empty", async () => {
    server.use(
      http.post(`${BASE}/v3/keywords_data/google_ads/search_volume/live`, () =>
        reply([{ keyword: "Trail Shoes", search_volume: 500, cpc: 0.5, monthly_searches: [] }]),
      ),
      http.post(`${BASE}/v3/dataforseo_labs/google/bulk_keyword_difficulty/live`, () =>
        reply([{ items: [{ keyword: "trail shoes", keyword_difficulty: 33.4 }] }]),
      ),
    );
    const out = await provider().getKeywordMetrics({
      keywords: ["trail shoes", "nothing"],
      locationCode: 2840,
      languageCode: "en",
    });
    expect(out.data[0]).toEqual({
      keyword: "trail shoes",
      volume: 500,
      cpcMicros: 500_000,
      difficulty: 33,
      trend: [],
    });
    expect(out.data[1]).toEqual({
      keyword: "nothing",
      volume: null,
      cpcMicros: null,
      difficulty: null,
      trend: [],
    });
  });

  it("maps ranked keywords", async () => {
    server.use(
      http.post(`${BASE}/v3/dataforseo_labs/google/ranked_keywords/live`, () =>
        reply([
          {
            items: [
              {
                keyword_data: { keyword: "boots", keyword_info: { search_volume: 90 } },
                ranked_serp_element: {
                  serp_item: { rank_group: 3, url: "https://shoes.test/boots" },
                },
              },
            ],
          },
        ]),
      ),
    );
    const out = await provider().getRankedKeywords({
      domain: "shoes.test",
      locationCode: 2840,
      languageCode: "en",
      limit: 10,
    });
    expect(out.data).toEqual([
      { keyword: "boots", position: 3, volume: 90, url: "https://shoes.test/boots" },
    ]);
  });
});

describe("backlinks", () => {
  it("builds the summary from two calls", async () => {
    server.use(
      http.post(`${BASE}/v3/backlinks/summary/live`, () =>
        reply([
          {
            backlinks: 200,
            referring_domains: 40,
            rank: 456,
            referring_links_attributes: { nofollow: 50 },
          },
        ]),
      ),
      http.post(`${BASE}/v3/backlinks/timeseries_new_lost_summary/live`, () =>
        reply([
          {
            items: [
              { new_backlinks: 12, lost_backlinks: 3 },
              { new_backlinks: 5, lost_backlinks: 1 },
            ],
          },
        ]),
      ),
    );
    const out = await provider().getBacklinkSummary("shoes.test");
    expect(out.data).toEqual({
      domain: "shoes.test",
      totalBacklinks: 200,
      referringDomains: 40,
      dofollowPercent: 75,
      newLast30Days: 17,
      lostLast30Days: 4,
      domainRating: 46,
    });
  });

  it("maps links, lost links and referring domains", async () => {
    server.use(
      http.post(`${BASE}/v3/backlinks/backlinks/live`, async ({ request }) => {
        const body = (await request.json()) as { limit: number; offset: number }[];
        expect(body[0]).toMatchObject({ limit: 10, offset: 20, backlinks_status_type: "all" });
        return reply([
          {
            items: [
              {
                url_from: "https://a.test/p",
                domain_from: "a.test",
                url_to: "https://shoes.test/",
                anchor: "shoes",
                dofollow: true,
                first_seen: "2026-01-02 10:00:00 +00:00",
                last_seen: "2026-03-01 10:00:00 +00:00",
                is_lost: false,
                domain_from_rank: 300,
              },
              {
                url_from: "https://b.test/p",
                domain_from: "b.test",
                url_to: "https://shoes.test/x",
                anchor: "",
                dofollow: false,
                first_seen: "2026-01-05 10:00:00 +00:00",
                last_seen: "2026-02-01 10:00:00 +00:00",
                is_lost: true,
              },
              { url_from: "", domain_from: "c.test" },
            ],
          },
        ]);
      }),
      http.post(`${BASE}/v3/backlinks/referring_domains/live`, () =>
        reply([{ items: [{ domain: "a.test", rank: 810, backlinks: 7 }, { domain: "" }] }]),
      ),
    );
    const p = provider();
    const links = await p.getBacklinks({ domain: "shoes.test", limit: 10, offset: 20 });
    expect(links.data).toHaveLength(2);
    expect(links.data[0]).toMatchObject({
      sourceDomain: "a.test",
      dofollow: true,
      lostAt: null,
      sourceRating: 30,
    });
    expect(links.data[1]!.lostAt).toBe("2026-02-01T10:00:00.000Z");
    const refs = await p.getReferringDomains({ domain: "shoes.test", limit: 10 });
    expect(refs.data).toEqual([{ domain: "a.test", rating: 81, backlinks: 7 }]);
  });
});

describe("audit", () => {
  it("starts a crawl and returns its id", async () => {
    server.use(
      http.post(`${BASE}/v3/on_page/task_post`, async ({ request }) => {
        const body = (await request.json()) as { target: string; max_crawl_pages: number }[];
        expect(body[0]).toMatchObject({ target: "shoes.test", max_crawl_pages: 50 });
        return HttpResponse.json({
          status_code: 20000,
          status_message: "Ok.",
          cost: 0.0001,
          tasks: [{ id: "crawl-9", status_code: 20100, status_message: "Task Created." }],
        });
      }),
    );
    const out = await provider().startAudit({ domain: "shoes.test", maxPages: 50 });
    expect(out.data.taskId).toBe("crawl-9");
  });

  it("maps progress", () => {
    expect(
      mapAuditStatus({
        crawl_progress: "in_progress",
        crawl_status: { max_crawl_pages: 50, pages_crawled: 10 },
      }),
    ).toEqual({ status: "running", progress: 20 });
    expect(
      mapAuditStatus({
        crawl_progress: "in_progress",
        crawl_status: { max_crawl_pages: 50, pages_crawled: 0 },
      }).status,
    ).toBe("queued");
    expect(mapAuditStatus({ crawl_progress: "finished" })).toEqual({
      status: "completed",
      progress: 100,
    });
  });

  it("turns page checks into our issue codes", () => {
    const { page, issues } = mapAuditPage({
      url: "https://shoes.test/a",
      status_code: 404,
      meta: { title: "", htags: { h1: ["a", "b"] }, content: { plain_text_word_count: 120 } },
      page_timing: {
        duration_time: 3200.4,
        largest_contentful_paint: 4100,
        cumulative_layout_shift: 0.123,
      },
      checks: {
        no_title: true,
        is_4xx_code: true,
        no_h1_tag: false,
        is_http: true,
        unknown_check: true,
      },
      inbound_links_count: 0,
    });
    expect(issues.map((i) => i.code).sort()).toEqual([
      "broken_link_4xx",
      "missing_title",
      "multiple_h1",
      "no_https",
    ]);
    expect(issues.find((i) => i.code === "missing_title")!.severity).toBe("CRITICAL");
    expect(page).toMatchObject({
      statusCode: 404,
      title: null,
      loadTimeMs: 3200,
      wordCount: 120,
      issueCount: 4,
      lcpMs: 4100,
      cls: 123,
      inlinks: 0,
    });
  });

  it("reads every page of the result, with the sitemap check", async () => {
    server.use(
      http.get(`${BASE}/v3/on_page/summary/crawl-9`, () =>
        reply([
          {
            crawl_progress: "finished",
            domain_info: { name: "shoes.test", checks: { sitemap: false } },
          },
        ]),
      ),
      http.post(`${BASE}/v3/on_page/pages`, async ({ request }) => {
        const body = (await request.json()) as { offset: number }[];
        const items =
          body[0]!.offset === 0
            ? Array.from({ length: 500 }, (_, i) => ({
                url: `https://shoes.test/${i}`,
                status_code: 200,
                checks: {},
              }))
            : [
                {
                  url: "https://shoes.test/last",
                  status_code: 200,
                  checks: { no_description: true },
                },
              ];
        return reply([{ items }]);
      }),
    );
    const out = await provider().getAuditResult("crawl-9");
    expect(out.data.pagesCrawled).toBe(501);
    expect(out.data.issues.map((i) => i.code).sort()).toEqual([
      "missing_meta_description",
      "missing_sitemap",
    ]);
  });
});

describe("errors", () => {
  it("turns a failed task into an error", async () => {
    server.use(
      http.post(`${BASE}/v3/dataforseo_labs/google/keyword_ideas/live`, () =>
        HttpResponse.json({
          status_code: 20000,
          status_message: "Ok.",
          tasks: [{ id: "t", status_code: 40501, status_message: "Invalid Field: 'limit'." }],
        }),
      ),
    );
    await expect(
      provider().getKeywordIdeas({ seed: "x", locationCode: 2840, languageCode: "en", limit: 5 }),
    ).rejects.toThrow(/Invalid Field/);
  });
});
