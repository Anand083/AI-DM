import type { Backlink, BacklinkSummary, ReferringDomain } from "../../types";
import { arr, int, isoDate, num, obj, rating, str } from "./shared";

/**
 * `backlinks/summary/live` plus the 30 day new/lost counts from
 * `backlinks/timeseries_new_lost_summary/live` to a summary.
 */
export function mapBacklinkSummary(
  domain: string,
  summary: unknown,
  timeseries: unknown,
): BacklinkSummary {
  const s = obj(summary);
  const total = int(s.backlinks);
  const attrs = obj(s.referring_links_attributes);
  const nofollow = int(attrs.nofollow);
  const series = arr(obj(timeseries).items).map(obj);
  return {
    domain,
    totalBacklinks: total,
    referringDomains: int(s.referring_domains),
    dofollowPercent:
      total > 0 ? Math.max(0, Math.min(100, Math.round(((total - nofollow) / total) * 100))) : 0,
    newLast30Days: series.reduce((n, i) => n + int(i.new_backlinks), 0),
    lostLast30Days: series.reduce((n, i) => n + int(i.lost_backlinks), 0),
    domainRating: rating(s.rank),
  };
}

/** `backlinks/backlinks/live` to our backlink rows. */
export function mapBacklinks(result: unknown): Backlink[] {
  return arr(obj(result).items)
    .map(obj)
    .map((i) => {
      const lost = i.is_lost === true;
      const lastSeen = isoDate(i.last_visited) ?? isoDate(i.last_seen);
      return {
        sourceUrl: str(i.url_from),
        sourceDomain: str(i.domain_from),
        targetUrl: str(i.url_to),
        anchor: str(i.anchor),
        dofollow: i.dofollow === true,
        firstSeen: isoDate(i.first_seen) ?? new Date(0).toISOString(),
        lastSeen: lastSeen ?? new Date(0).toISOString(),
        lostAt: lost ? (isoDate(i.last_seen) ?? lastSeen) : null,
        sourceRating: rating(i.domain_from_rank ?? i.rank),
      };
    })
    .filter((b) => b.sourceUrl !== "");
}

/** `backlinks/referring_domains/live` to referring domains. */
export function mapReferringDomains(result: unknown): ReferringDomain[] {
  return arr(obj(result).items)
    .map(obj)
    .map((i) => ({
      domain: str(i.domain),
      rating: rating(i.rank),
      backlinks: num(i.backlinks) === null ? 0 : int(i.backlinks),
    }))
    .filter((d) => d.domain !== "");
}
