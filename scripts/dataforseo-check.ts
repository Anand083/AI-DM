/**
 * Runs each real DataForSEO adapter call once, with tiny inputs, and prints what came back.
 * Use the free Sandbox first: DATAFORSEO_BASE_URL=https://sandbox.dataforseo.com. The Sandbox
 * answers with made-up data in the real shapes, so this proves the calls and the mapping work.
 * It needs DATAFORSEO_LOGIN and the API password from https://app.dataforseo.com/api-access
 * (not the account password) in .env.
 *
 *   pnpm dataforseo:check
 */
import { DataForSeoProvider } from "@/server/providers/seo/dataforseo";
import type { ProviderResult } from "@/server/providers/seo/types";

const login = process.env.DATAFORSEO_LOGIN;
const password = process.env.DATAFORSEO_PASSWORD;
const baseUrl = process.env.DATAFORSEO_BASE_URL ?? "https://sandbox.dataforseo.com";
if (!login || !password) {
  console.error("Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD (the API password) in .env.");
  process.exit(2);
}

const provider = new DataForSeoProvider({ login, password, baseUrl });
const place = { locationCode: 2840, languageCode: "en" };
let failed = 0;

async function step<T>(
  name: string,
  run: () => Promise<ProviderResult<T>>,
  show: (d: T) => string,
) {
  try {
    const out = await run();
    const cost = ((out.costMicros ?? 0) / 1_000_000).toFixed(4);
    console.log(`ok    ${name}: ${show(out.data)} (cost $${cost})`);
    return out.data;
  } catch (error) {
    failed++;
    console.log(`FAIL  ${name}: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

async function main() {
  console.log(`Checking ${baseUrl}`);
  const conn = await provider.testConnection();
  console.log(`${conn.ok ? "ok   " : "FAIL "} connection: ${conn.message ?? ""}`);
  if (!conn.ok) process.exit(1);

  await step(
    "rankings",
    () =>
      provider.getRankings({
        domain: "example.com",
        keywords: ["seo tools"],
        ...place,
        device: "desktop",
        priority: "live",
      }),
    (d) =>
      `${d.length} keyword(s), position ${d[0]?.position ?? "none"}, ${d[0]?.topResults.length ?? 0} top results`,
  );
  await step(
    "bing rankings",
    () => provider.getBingRankings({ domain: "example.com", keywords: ["seo tools"], ...place }),
    (d) => `${d.length} keyword(s), position ${d[0]?.position ?? "none"}`,
  );
  await step(
    "keyword ideas",
    () => provider.getKeywordIdeas({ seed: "seo tools", ...place, limit: 5 }),
    (d) => `${d.length} ideas, first "${d[0]?.keyword ?? ""}" volume ${d[0]?.volume ?? "?"}`,
  );
  await step(
    "keyword metrics",
    () => provider.getKeywordMetrics({ keywords: ["seo tools", "rank tracker"], ...place }),
    (d) =>
      d
        .map(
          (m) =>
            `${m.keyword}: vol ${m.volume ?? "?"} diff ${m.difficulty ?? "?"} trend ${m.trend.length}`,
        )
        .join("; "),
  );
  await step(
    "ranked keywords",
    () => provider.getRankedKeywords({ domain: "example.com", ...place, limit: 5 }),
    (d) => `${d.length} keywords`,
  );
  await step(
    "backlink summary",
    () => provider.getBacklinkSummary("example.com"),
    (d) =>
      `${d.totalBacklinks} links, ${d.referringDomains} domains, rating ${d.domainRating}, +${d.newLast30Days}/-${d.lostLast30Days}`,
  );
  await step(
    "backlinks",
    () => provider.getBacklinks({ domain: "example.com", limit: 5, offset: 0 }),
    (d) => `${d.length} links, first from ${d[0]?.sourceDomain ?? "none"}`,
  );
  await step(
    "referring domains",
    () => provider.getReferringDomains({ domain: "example.com", limit: 5 }),
    (d) => `${d.length} domains`,
  );

  const started = await step(
    "audit start",
    () => provider.startAudit({ domain: "example.com", maxPages: 10 }),
    (d) => `task ${d.taskId}`,
  );
  if (started) {
    for (let i = 0; i < 20; i++) {
      const status = await step(
        "audit status",
        () => provider.getAuditStatus(started.taskId),
        (d) => `${d.status} ${d.progress}%`,
      );
      if (!status || status.status === "completed" || status.status === "failed") break;
      await new Promise((r) => setTimeout(r, 6000));
    }
    await step(
      "audit result",
      () => provider.getAuditResult(started.taskId),
      (d) =>
        `${d.pagesCrawled} pages, ${d.issues.length} issues (${[...new Set(d.issues.map((x) => x.code))].join(", ") || "none"})`,
    );
  }
  console.log(failed === 0 ? "\nAll calls worked." : `\n${failed} call(s) failed.`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
