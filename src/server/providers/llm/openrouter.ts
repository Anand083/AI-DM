import { LlmError, type LlmClient, type LlmRequest, type LlmResponse } from "./types";

type Options = {
  apiKey: string;
  model: string;
  baseUrl?: string;
  /** Milliseconds before the call is given up. */
  timeoutMs?: number;
  /** For tests: replace the network. */
  fetch?: typeof fetch;
};

/**
 * Talks to OpenRouter's chat completions API (one key, many models). It sends only what the
 * caller gives it, asks for a short answer, and turns every failure into an `LlmError` so the
 * caller can fall back instead of failing the whole job.
 */
export class OpenRouterClient implements LlmClient {
  readonly name = "openrouter";
  readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: Options) {
    this.model = options.model;
    this.baseUrl = (options.baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetch ?? ((...args) => fetch(...args));
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: request.maxTokens,
          temperature: request.temperature ?? 0.3,
          // Short writing tasks do not need the model to think first; thinking would eat the token limit.
          reasoning: { enabled: false },
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.user },
          ],
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new LlmError(
        timedOut
          ? "The AI service took too long to answer."
          : "The AI service could not be reached.",
        true,
      );
    }
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new LlmError("The AI service refused the key.", false, res.status);
      }
      if (res.status === 402) {
        throw new LlmError("The AI account has no credit left.", false, res.status);
      }
      if (res.status === 429 || res.status >= 500) {
        throw new LlmError("The AI service is busy. Try again later.", true, res.status);
      }
      throw new LlmError(`The AI service refused the request (${res.status}).`, false, res.status);
    }
    const body = (await res.json().catch(() => null)) as {
      choices?: { message?: { content?: unknown } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      model?: string;
    } | null;
    const content = body?.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content.trim() : "";
    if (!text) throw new LlmError("The AI service gave an empty answer.", true);
    return {
      text,
      inputTokens: body?.usage?.prompt_tokens ?? null,
      outputTokens: body?.usage?.completion_tokens ?? null,
      model: body?.model ?? this.model,
    };
  }
}
