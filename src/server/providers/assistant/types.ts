import type { AssistantAnswer, AssistantBundle } from "@/lib/assistant";

export interface AssistantProvider {
  /** "mock" or the name of the model service. Shown next to every answer. */
  readonly name: string;
  answer(question: string, bundle: AssistantBundle): Promise<AssistantAnswer>;
}
