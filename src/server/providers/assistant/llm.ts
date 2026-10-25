import {
  ASSISTANT_SYSTEM,
  bundleToText,
  parseModelAnswer,
  untrusted,
  type AssistantAnswer,
  type AssistantBundle,
} from "@/lib/assistant";
import { LlmError, type LlmClient } from "../llm/types";
import { MockAssistantProvider } from "./mock";
import type { AssistantProvider } from "./types";

/**
 * Answers with a language model, from the fact block only. If the model cannot answer, or its
 * reply is not a usable answer, the fixed-rule answer is given instead and a warning is logged,
 * so a person is never left without a reply.
 */
export class LlmAssistantProvider implements AssistantProvider {
  readonly name: string;
  private readonly fallback = new MockAssistantProvider();

  constructor(
    private readonly client: LlmClient,
    private readonly onFallback: (reason: string) => void = () => {},
  ) {
    this.name = client.name;
  }

  async answer(question: string, bundle: AssistantBundle): Promise<AssistantAnswer> {
    try {
      const { text } = await this.client.complete({
        system: ASSISTANT_SYSTEM,
        user: `${bundleToText(bundle)}\n\nQuestion: ${untrusted(question, 500)}`,
        maxTokens: 900,
        temperature: 0.2,
      });
      const parsed = parseModelAnswer(text);
      if (parsed) return parsed;
      this.onFallback("the reply was not a usable answer");
    } catch (error) {
      if (!(error instanceof LlmError)) throw error;
      this.onFallback(error.message);
    }
    return this.fallback.answer(question, bundle);
  }
}
