import { formatPosition } from "@/lib/rank-math";
import { LlmError, type LlmClient } from "../llm/types";
import { MockSummaryProvider } from "./mock";
import type { ReplyInput, SummaryInput, SummaryProvider } from "./types";

const MAX_SUMMARY_CHARS = 1200;
const MAX_REPLY_CHARS = 700;

/** One short, plain line of text. Long dashes and markdown are removed. */
export function cleanModelText(text: string, max: number): string {
  const cleaned = text
    .replace(/[–—]/g, ",")
    .replace(/[*_`#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= max) return cleaned;
  const cut = cleaned.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("."));
  return end > max * 0.5 ? cut.slice(0, end + 1) : `${cut.trimEnd()}...`;
}

const SUMMARY_SYSTEM = [
  "You write the short summary at the top of an SEO report that an agency sends to its client.",
  "Write 3 to 5 sentences of plain English for a business owner who is not technical.",
  "Use only the numbers given. Never invent a number, a cause or a promise.",
  "Say what went well and what needs attention. Do not use bullet points, headings or markdown.",
  "Do not mention any software, tool or platform, and do not mention that you are an AI.",
].join(" ");

const REPLY_SYSTEM = [
  "You write a reply a business owner can post under a customer review.",
  "Write 2 to 4 friendly, professional sentences. Thank the person. For a low rating, apologise without admitting fault and invite them to make contact.",
  "Never invent facts, offers or discounts. Do not use markdown. Do not mention any software or that you are an AI.",
].join(" ");

/** Facts for the model: numbers only, no personal data beyond what the report already shows. */
export function summaryFacts(input: SummaryInput): string {
  const { kpis, audit } = input;
  const lines = [
    `Website: ${input.domain}`,
    `Period: ${input.period.label}`,
    `Keywords tracked: ${kpis.tracked}, checked: ${kpis.checked}`,
    `In the top 3: ${kpis.top3}, on the first page: ${kpis.top10}`,
    `Average position: ${kpis.averagePosition === null ? "none" : formatPosition(kpis.averagePosition)}`,
    `Average position change over the period (positive is better): ${kpis.averageChange ?? "unknown"}`,
    `Keywords that moved up: ${kpis.improved}, moved down: ${kpis.declined}`,
  ];
  const up = input.movers.up[0];
  const down = input.movers.down[0];
  if (up) lines.push(`Biggest gain: "${up.phrase}" to position ${formatPosition(up.position)}`);
  if (down)
    lines.push(`Biggest drop: "${down.phrase}" to position ${formatPosition(down.position)}`);
  if (audit) {
    lines.push(
      `Site health score: ${audit.healthScore} of 100, critical issues: ${audit.counts.critical}, warnings: ${audit.counts.warning}`,
    );
  }
  return lines.join("\n");
}

/**
 * Writes report summaries and review replies with a language model. If the model cannot answer
 * for any reason, the fixed-sentence writer answers instead, so a report is never held up.
 */
export class LlmSummaryProvider implements SummaryProvider {
  readonly name: string;
  private readonly fallback = new MockSummaryProvider();

  constructor(
    private readonly client: LlmClient,
    private readonly onFallback: (error: LlmError) => void = () => {},
  ) {
    this.name = client.name;
  }

  async write(input: SummaryInput): Promise<string> {
    try {
      const { text } = await this.client.complete({
        system: SUMMARY_SYSTEM,
        user: summaryFacts(input),
        maxTokens: 350,
      });
      return cleanModelText(text, MAX_SUMMARY_CHARS);
    } catch (error) {
      if (!(error instanceof LlmError)) throw error;
      this.onFallback(error);
      return this.fallback.write(input);
    }
  }

  async suggestReply(input: ReplyInput): Promise<string> {
    try {
      const { text } = await this.client.complete({
        system: REPLY_SYSTEM,
        user: [
          `Business: ${input.businessName}`,
          `Reviewer first name: ${input.reviewerName.trim().split(/\s+/)[0] || "unknown"}`,
          `Stars: ${input.rating} of 5`,
          `Review text: ${input.text.slice(0, 1000)}`,
        ].join("\n"),
        maxTokens: 220,
      });
      return cleanModelText(text, MAX_REPLY_CHARS);
    } catch (error) {
      if (!(error instanceof LlmError)) throw error;
      this.onFallback(error);
      return this.fallback.suggestReply(input);
    }
  }
}
