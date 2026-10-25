import { mockAnswer, type AssistantAnswer, type AssistantBundle } from "@/lib/assistant";
import type { AssistantProvider } from "./types";

/** Answers from fixed rules over the facts. No model call, no cost, same answer for the same facts. */
export class MockAssistantProvider implements AssistantProvider {
  readonly name = "mock";

  async answer(question: string, bundle: AssistantBundle): Promise<AssistantAnswer> {
    return mockAnswer(question, bundle);
  }
}
