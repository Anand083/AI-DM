import "server-only";
import { getEnv } from "@/env";
import { OpenRouterClient } from "./openrouter";
import type { LlmClient } from "./types";

export type { LlmClient } from "./types";

let client: LlmClient | null | undefined;

/** The language model client, or null when `SUMMARY_PROVIDER=mock` (the default). */
export function getLlmClient(): LlmClient | null {
  if (client !== undefined) return client;
  const env = getEnv();
  client =
    env.SUMMARY_PROVIDER === "openrouter" && env.OPENROUTER_API_KEY
      ? new OpenRouterClient({
          apiKey: env.OPENROUTER_API_KEY,
          model: env.OPENROUTER_MODEL,
          baseUrl: env.OPENROUTER_BASE_URL,
        })
      : null;
  return client;
}
