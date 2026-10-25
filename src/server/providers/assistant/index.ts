import "server-only";
import { getEnv } from "@/env";
import { logger } from "@/server/logger";
import { getOpenRouterClient } from "../llm";
import { LlmAssistantProvider } from "./llm";
import { MockAssistantProvider } from "./mock";
import type { AssistantProvider } from "./types";

export type { AssistantProvider } from "./types";

let provider: AssistantProvider | undefined;

/** The mock by default; a language model (with the mock as backup) when `ASSISTANT_PROVIDER=openrouter`. */
export function getAssistantProvider(): AssistantProvider {
  if (provider) return provider;
  const client = getEnv().ASSISTANT_PROVIDER === "openrouter" ? getOpenRouterClient() : null;
  provider = client
    ? new LlmAssistantProvider(client, (reason) =>
        logger.warn({ reason }, "assistant fell back to the fixed-rule answer"),
      )
    : new MockAssistantProvider();
  return provider;
}
