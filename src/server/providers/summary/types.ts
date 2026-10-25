import type { ReportModel } from "@/lib/report-model";

/** What the summary writer sees: the report numbers, without the summary itself. */
export type SummaryInput = Omit<ReportModel, "summary">;

export type ReplyInput = {
  businessName: string;
  reviewerName: string;
  /** 1 to 5. */
  rating: number;
  text: string;
};

export interface SummaryProvider {
  readonly name: string;
  /** Writes a short plain-English summary of the report for the client. */
  write(input: SummaryInput): Promise<string>;
  /** Suggests a reply to a customer review. A person reads and edits it before it is posted. */
  suggestReply(input: ReplyInput): Promise<string>;
}
