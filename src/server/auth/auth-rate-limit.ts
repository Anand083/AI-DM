import { consume, type RateLimitStore } from "@/server/rate-limit";

/** Auth endpoints that are limited, by Better Auth path. */
export const LIMITED_AUTH_PATHS = new Map<string, string>([
  ["/sign-in/email", "sign-in"],
  ["/sign-up/email", "sign-up"],
  ["/request-password-reset", "reset"],
  ["/forget-password", "reset"],
]);

export class AuthRateLimitError extends Error {
  constructor(readonly retryAfterSec: number) {
    super("Too many attempts. Please wait a few minutes and try again.");
    this.name = "AuthRateLimitError";
  }
}

/** First address of `x-forwarded-for` (set by our reverse proxy), or "unknown". */
export function clientIp(headers: Headers | undefined): string {
  const forwarded = headers?.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers?.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Counts one attempt against the IP and the email. Throws AuthRateLimitError when either
 * is over the limit. Paths that are not limited are ignored.
 */
export async function enforceAuthRateLimit(
  store: RateLimitStore,
  input: { path: string; ip: string; email?: string },
  config: { limit: number; windowSec: number },
): Promise<void> {
  const action = LIMITED_AUTH_PATHS.get(input.path);
  if (!action) return;
  const keys = [`auth:${action}:ip:${input.ip}`];
  if (input.email) keys.push(`auth:${action}:email:${input.email.trim().toLowerCase()}`);
  for (const key of keys) {
    const result = await consume(store, { key, ...config });
    if (!result.allowed) throw new AuthRateLimitError(result.retryAfterSec);
  }
}
