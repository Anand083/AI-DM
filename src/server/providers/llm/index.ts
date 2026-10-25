import "server-only";
import { getEnv } from "@/env";
import { OpenRouterClient } from "./openrouter";
import type { LlmClient } from "./types";

export type { LlmClient } from "./types";

let client: LlmClient | null | undefined;
let openRouter: LlmClient | null | undefined;

/** The OpenRouter client when a key is set, whatever feature asks. */
export function getOpenRouterClient(): LlmClient | null {
  if (openRouter !== undefined) return openRouter;
  const env = getEnv();
  openRouter = env.OPENROUTER_API_KEY
    ? new OpenRouterClient({
        apiKey: env.OPENROUTER_API_KEY,
        model: env.OPENROUTER_MODEL,
        baseUrl: env.OPENROUTER_BASE_URL,
      })
    : null;
  return openRouter;
}

/** The language model client, or null when `SUMMARY_PROVIDER=mock` (the default). */
export function getLlmClient(): LlmClient | null {
  if (client !== undefined) return client;
  client = getEnv().SUMMARY_PROVIDER === "openrouter" ? getOpenRouterClient() : null;
  return client;
}
