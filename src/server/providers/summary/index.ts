import "server-only";
import { MockSummaryProvider } from "./mock";
import type { SummaryProvider } from "./types";

export type { SummaryInput, SummaryProvider } from "./types";

let provider: SummaryProvider | undefined;

/** Only the mock writer exists for now. A real one is a later decision. */
export function getSummaryProvider(): SummaryProvider {
  provider ??= new MockSummaryProvider();
  return provider;
}
