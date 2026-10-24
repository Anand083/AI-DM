import { ProviderError } from "../errors";

/** One task inside a DataForSEO response. */
export type DfsTask<R = unknown> = {
  id: string;
  status_code: number;
  status_message: string;
  cost?: number;
  data?: Record<string, unknown>;
  result?: R[] | null;
  result_count?: number;
};

export type DfsResponse<R = unknown> = {
  status_code: number;
  status_message: string;
  cost?: number;
  tasks_count?: number;
  tasks_error?: number;
  tasks?: DfsTask<R>[];
};

export type ClientLogger = {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
};

export type DfsClientOptions = {
  login: string;
  password: string;
  baseUrl: string;
  /** Replace for tests. */
  fetch?: typeof fetch;
  /** Replace for tests, so retries do not wait. */
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseMs?: number;
  logger?: ClientLogger;
};

export type DfsResult<R = unknown> = {
  response: DfsResponse<R>;
  tasks: DfsTask<R>[];
  /** Cost of the call in micro-dollars (1,000,000 = $1). */
  costMicros: number;
};

/** DataForSEO puts its own status code in the body. 20000 is OK, 20100 means "task created". */
export function isOkStatus(code: number): boolean {
  return code >= 20000 && code < 30000;
}

/** Turns a DataForSEO status code into one of our errors. Returns null for OK codes. */
export function errorForStatus(code: number, message: string): ProviderError | null {
  if (isOkStatus(code)) return null;
  const text = `DataForSEO: ${message} (${code})`;
  if (code === 40101 || code === 40100) return new ProviderError(text, false, "AUTH");
  if (code === 40200 || code === 40210 || code === 40201)
    return new ProviderError(text, false, "NO_FUNDS");
  if (code === 40202) return new ProviderError(text, true, "RATE_LIMIT");
  if (code === 40400 || code === 40401) return new ProviderError(text, false, "NOT_FOUND");
  if (code >= 50000) return new ProviderError(text, true, "SERVER");
  return new ProviderError(text, false, "BAD_REQUEST");
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Small HTTP client for DataForSEO. It signs in with Basic auth, retries when the service is
 * busy (HTTP 429 or 5xx, network errors, timeouts), looks at the status code inside the body,
 * reads the real cost, and never logs the login or password.
 */
export class DataForSeoClient {
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly authHeader: string;
  private readonly baseUrl: string;
  private readonly logger?: ClientLogger;

  constructor(options: DfsClientOptions) {
    this.fetchFn = options.fetch ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.retryBaseMs = options.retryBaseMs ?? 1000;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.authHeader = `Basic ${Buffer.from(`${options.login}:${options.password}`).toString("base64")}`;
    this.logger = options.logger;
  }

  get<R = unknown>(path: string): Promise<DfsResult<R>> {
    return this.request<R>("GET", path);
  }

  post<R = unknown>(path: string, body: unknown): Promise<DfsResult<R>> {
    return this.request<R>("POST", path, body);
  }

  private async request<R>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<DfsResult<R>> {
    const started = Date.now();
    let lastError: ProviderError | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) await this.sleep(this.retryBaseMs * 2 ** (attempt - 1));
      try {
        const http = await this.fetchFn(`${this.baseUrl}${path}`, {
          method,
          headers: {
            Authorization: this.authHeader,
            Accept: "application/json",
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (http.status === 429 || http.status >= 500) {
          lastError = new ProviderError(
            `DataForSEO answered HTTP ${http.status}`,
            true,
            http.status === 429 ? "RATE_LIMIT" : "SERVER",
          );
          this.logger?.warn(
            { path, status: http.status, attempt },
            "dataforseo request will be retried",
          );
          continue;
        }
        if (http.status === 401 || http.status === 403) {
          throw new ProviderError("DataForSEO rejected the login or password.", false, "AUTH");
        }

        const json = (await http.json()) as DfsResponse<R>;
        const topError = errorForStatus(json.status_code, json.status_message);
        if (topError) {
          if (topError.retryable && attempt < this.maxRetries) {
            lastError = topError;
            this.logger?.warn(
              { path, code: json.status_code, attempt },
              "dataforseo request will be retried",
            );
            continue;
          }
          throw topError;
        }

        const tasks = json.tasks ?? [];
        const costMicros = Math.round((json.cost ?? 0) * 1_000_000);
        this.logger?.info(
          {
            path,
            method,
            durationMs: Date.now() - started,
            costMicros,
            taskIds: tasks.map((t) => t.id),
            attempts: attempt + 1,
          },
          "dataforseo request",
        );
        return { response: json, tasks, costMicros };
      } catch (error) {
        if (error instanceof ProviderError) {
          if (!error.retryable) throw error;
          lastError = error;
          continue;
        }
        // Network failure, timeout, or a body that is not JSON.
        const reason = error instanceof Error ? error.message : "unknown error";
        lastError = new ProviderError(`DataForSEO request failed: ${reason}`, true, "NETWORK");
        this.logger?.warn({ path, attempt, reason }, "dataforseo request will be retried");
      }
    }
    throw lastError ?? new ProviderError("DataForSEO request failed", true);
  }
}

/** Throws the right error for a task that failed inside an otherwise OK response. */
export function assertTaskOk(task: DfsTask): void {
  const error = errorForStatus(task.status_code, task.status_message);
  if (error) throw error;
}
