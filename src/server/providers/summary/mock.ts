import { formatPosition } from "@/lib/rank-math";
import type { ReplyInput, SummaryInput, SummaryProvider } from "./types";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Writes the summary from the numbers with fixed sentences. No AI call, no cost, same text for
 * the same numbers. A real writer can replace it later by implementing `SummaryProvider`.
 */
export class MockSummaryProvider implements SummaryProvider {
  readonly name = "mock";

  async write(input: SummaryInput): Promise<string> {
    return buildSummary(input);
  }

  async suggestReply(input: ReplyInput): Promise<string> {
    return buildReply(input);
  }
}

/** A polite reply that fits the number of stars. Same text for the same review. */
export function buildReply(input: ReplyInput): string {
  const name = input.reviewerName.trim() || "there";
  if (input.rating >= 4) {
    return `Hi ${name}, thank you for the kind words! We are glad you had a good experience with ${input.businessName} and we hope to see you again soon.`;
  }
  if (input.rating === 3) {
    return `Hi ${name}, thank you for your feedback. We are glad part of your visit went well and we would like to do better. Please contact us and tell us what we could improve.`;
  }
  return `Hi ${name}, we are sorry that your experience with ${input.businessName} did not meet your expectations. We would like to put this right. Please contact us directly so we can talk about what happened.`;
}

export function buildSummary(input: SummaryInput): string {
  const { kpis, period, audit } = input;
  const parts: string[] = [];

  if (kpis.checked === 0) {
    parts.push(
      `We track ${plural(kpis.tracked, "keyword")} for ${input.domain}, but none have been checked yet, so there are no rankings to report for ${period.label}.`,
    );
  } else {
    parts.push(
      `Between ${period.label}, we checked ${plural(kpis.checked, "keyword")} for ${input.domain}. ` +
        `${plural(kpis.top3, "keyword")} ${kpis.top3 === 1 ? "is" : "are"} in the top 3 and ${kpis.top10} ${kpis.top10 === 1 ? "is" : "are"} on the first page.`,
    );
    if (kpis.averagePosition !== null) {
      const change = kpis.averageChange;
      const trend =
        change === null || change === 0
          ? "about the same as at the start"
          : change > 0
            ? `${change} places better than at the start`
            : `${Math.abs(change)} places lower than at the start`;
      parts.push(`The average position is ${formatPosition(kpis.averagePosition)}, ${trend}.`);
    }
    if (kpis.improved + kpis.declined > 0) {
      parts.push(
        `${plural(kpis.improved, "keyword")} moved up and ${plural(kpis.declined, "keyword")} moved down.`,
      );
    }
    const best = input.movers.up[0];
    if (best && best.change !== null) {
      parts.push(
        `The biggest gain was "${best.phrase}", up ${best.change} ${best.change === 1 ? "place" : "places"} to ${formatPosition(best.position)}.`,
      );
    }
  }

  if (audit) {
    const issues = audit.counts.critical + audit.counts.warning + audit.counts.notice;
    const compare =
      audit.previousScore === null
        ? ""
        : audit.healthScore > audit.previousScore
          ? ` This is up from ${audit.previousScore}.`
          : audit.healthScore < audit.previousScore
            ? ` This is down from ${audit.previousScore}.`
            : " This is the same as last time.";
    parts.push(
      `The latest site check scored ${audit.healthScore} out of 100 across ${plural(audit.pagesCrawled, "page")}, with ${plural(issues, "issue")} to look at.${compare}`,
    );
  }

  return parts.join(" ");
}
