import type { ReportModel } from "@/lib/report-model";

/** What the summary writer sees: the report numbers, without the summary itself. */
export type SummaryInput = Omit<ReportModel, "summary">;

export interface SummaryProvider {
  readonly name: string;
  /** Writes a short plain-English summary of the report for the client. */
  write(input: SummaryInput): Promise<string>;
}
