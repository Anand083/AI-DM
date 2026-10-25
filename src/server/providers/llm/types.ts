export type LlmRequest = {
  /** Rules for the model. Never put secrets or the platform name here. */
  system: string;
  /** The question or the data to work on. */
  user: string;
  /** Hard limit on the length of the answer. */
  maxTokens: number;
  /** 0 is the most predictable. */
  temperature?: number;
};

export type LlmResponse = {
  text: string;
  /** Tokens the provider says it used, when it says. */
  inputTokens: number | null;
  outputTokens: number | null;
  model: string;
};

/** The model could not answer (network, key, credit, limit or an empty answer). */
export class LlmError extends Error {
  constructor(
    message: string,
    /** True when trying again later may work. */
    readonly retryable: boolean,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export interface LlmClient {
  readonly name: string;
  readonly model: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}
