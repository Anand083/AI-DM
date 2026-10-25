import { z } from "zod";
import { getEnv } from "@/env";
import { GOOGLE_NONCE_COOKIE, makeOAuthState, newNonce } from "@/server/auth/oauth-state";
import { can } from "@/server/auth/permissions";
import { getSessionUser } from "@/server/auth/session";
import { loadTenantContext } from "@/server/auth/tenant-context";
import { logger } from "@/server/logger";
import { limitRequest } from "@/server/request-limit";
import { AppError } from "@/server/services/errors";
import { beginGoogleConnect } from "@/server/services/google";

const query = z.object({
  agency: z.string().min(1).max(100),
  project: z.string().min(1).max(100),
});

/**
 * Starts connecting Google for a project. Only a signed-in member who may edit can start it.
 * It sends the person to Google with a signed `state`; a cookie with the same random value ties
 * the way back to this browser.
 */
export async function GET(request: Request): Promise<Response> {
  const limited = await limitRequest(request, "google-start", 20);
  if (limited) return limited;
  const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return new Response("Bad request", { status: 400 });

  const user = await getSessionUser();
  if (!user?.emailVerified) return new Response("Unauthorized", { status: 401 });
  const ctx = await loadTenantContext(user.id, parsed.data.agency);
  if (!ctx) return new Response("Not found", { status: 404 });
  if (!can(ctx.role, "content.edit")) return new Response("Forbidden", { status: 403 });

  const env = getEnv();
  const nonce = newNonce();
  const state = makeOAuthState(
    {
      userId: user.id,
      agencyId: ctx.agencyId,
      slug: parsed.data.agency,
      projectId: parsed.data.project,
      nonce,
    },
    env.BETTER_AUTH_SECRET,
  );
  try {
    const url = await beginGoogleConnect(
      { ...ctx, slug: parsed.data.agency },
      parsed.data.project,
      state,
    );
    return new Response(null, {
      status: 302,
      headers: {
        Location: url,
        "Cache-Control": "no-store",
        "Set-Cookie": `${GOOGLE_NONCE_COOKIE}=${nonce}; HttpOnly; SameSite=Lax; Path=/api/google; Max-Age=600${env.COOKIE_SECURE ? "; Secure" : ""}`,
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return new Response(error.message, { status: error.code === "NOT_FOUND" ? 404 : 403 });
    }
    logger.error({ err: error }, "google connect start failed");
    return new Response("Something went wrong", { status: 500 });
  }
}
