import "server-only";
import { logger } from "@/server/logger";
import { getLlmClient } from "../llm";
import { LlmSummaryProvider } from "./llm";
import { MockSummaryProvider } from "./mock";
import type { SummaryProvider } from "./types";

export type { SummaryInput, SummaryProvider } from "./types";

let provider: SummaryProvider | undefined;

/** The mock writer by default; a language model (with the mock as the backup) when configured. */
export function getSummaryProvider(): SummaryProvider {
  if (provider) return provider;
  const client = getLlmClient();
  provider = client
    ? new LlmSummaryProvider(client, (error) =>
        logger.warn(
          { message: error.message, status: error.status },
          "summary fell back to the fixed writer",
        ),
      )
    : new MockSummaryProvider();
  return provider;
}
