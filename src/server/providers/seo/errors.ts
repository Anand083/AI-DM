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

/**
 * A feature the chosen data source cannot give (yet). The message is plain English and safe to
 * show. Callers treat it like NotImplementedError: no retry, no charge.
 */
export class FeatureUnavailableError extends NotImplementedError {
  readonly userMessage: string;
  constructor(feature: string, source = "your data source") {
    super(feature);
    this.userMessage = `${feature} is not available with ${source} yet.`;
    this.message = this.userMessage;
    this.name = "FeatureUnavailableError";
  }
}
