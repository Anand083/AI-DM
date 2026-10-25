import "server-only";
import { hasScope, parseBearer, type ApiScope } from "@/lib/api-keys";
import { logger } from "@/server/logger";
import { allow, limitRequest } from "@/server/request-limit";
import { authenticateApiKey, type ApiPrincipal } from "@/server/services/api-keys";
import { AppError } from "@/server/services/errors";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

export const apiError = (status: number, code: string, message: string) =>
  json(status, { error: { code, message } });

/**
 * Wraps a public API route: limits the caller by address, checks the key and its scope, limits
 * the key, and turns errors into JSON. The handler only sees the agency the key belongs to.
 */
export async function withApiKey(
  request: Request,
  scope: ApiScope,
  handler: (principal: ApiPrincipal) => Promise<Response>,
): Promise<Response> {
  const limited = await limitRequest(request, "api-v1-ip", 600);
  if (limited) return limited;
  const key = parseBearer(request.headers.get("authorization"));
  if (!key) return apiError(401, "unauthorized", "Send your key as: Authorization: Bearer <key>.");
  let principal: ApiPrincipal | null;
  try {
    principal = await authenticateApiKey(key);
  } catch (error) {
    logger.error({ err: error }, "api key check failed");
    return apiError(500, "server_error", "Something went wrong.");
  }
  if (!principal) return apiError(401, "unauthorized", "This key is not valid.");
  if (!hasScope(principal.scopes, scope))
    return apiError(403, "forbidden", `This key does not have the ${scope} permission.`);
  const keyLimit = await allow(`api-v1-key:${principal.keyId}`, 120, 60);
  if (!keyLimit.allowed)
    return json(
      429,
      { error: { code: "rate_limited", message: "Too many requests. Please wait a moment." } },
      { "Retry-After": String(keyLimit.retryAfterSec) },
    );
  try {
    return await handler(principal);
  } catch (error) {
    if (error instanceof AppError) {
      const status = error.code === "NOT_FOUND" ? 404 : 400;
      return apiError(status, error.code.toLowerCase(), error.message);
    }
    logger.error({ err: error }, "api v1 request failed");
    return apiError(500, "server_error", "Something went wrong.");
  }
}

export const apiList = <T>(rows: T[], total: number, page: { page: number; perPage: number }) =>
  json(200, { data: rows, page: page.page, perPage: page.perPage, total });
