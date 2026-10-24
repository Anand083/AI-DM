/** A provider call failed. `retryable` tells the job runner whether trying again can help. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** A provider method that is planned but not built yet. */
export class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`${feature} is not implemented yet.`);
    this.name = "NotImplementedError";
  }
}
