import { z } from "zod";
import { getEnv } from "@/env";
import { GOOGLE_NONCE_COOKIE, readOAuthState, sameText } from "@/server/auth/oauth-state";
import { can } from "@/server/auth/permissions";
import { getSessionUser } from "@/server/auth/session";
import { loadTenantContext } from "@/server/auth/tenant-context";
import { logger } from "@/server/logger";
import { GoogleAuthError, GoogleTemporaryError } from "@/server/providers/google/types";
import { limitRequest } from "@/server/request-limit";
import { completeGoogleConnect } from "@/server/services/google";

const query = z.object({
  code: z.string().min(1).max(2000).optional(),
  state: z.string().min(1).max(2000),
  error: z.string().max(200).optional(),
});

const cookieValue = (header: string | null, name: string) =>
  header
    ?.split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${name}=`))
    ?.slice(name.length + 1);

/**
 * Where Google sends the person back. The `state` must have our signature, must not be older than
 * 10 minutes, must belong to the signed-in person and must match the cookie set when they left.
 * Then the code is exchanged for tokens, which are saved encrypted.
 */
export async function GET(request: Request): Promise<Response> {
  const limited = await limitRequest(request, "google-callback", 20);
  if (limited) return limited;
  const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return new Response("Bad request", { status: 400 });

  const user = await getSessionUser();
  if (!user?.emailVerified) return new Response("Unauthorized", { status: 401 });

  const env = getEnv();
  const state = readOAuthState(parsed.data.state, env.BETTER_AUTH_SECRET);
  const nonce = cookieValue(request.headers.get("cookie"), GOOGLE_NONCE_COOKIE);
  if (!state || state.userId !== user.id || !nonce || !sameText(nonce, state.nonce)) {
    return new Response("This sign-in link is not valid or has expired. Start again.", {
      status: 400,
    });
  }
  const ctx = await loadTenantContext(user.id, state.slug);
  if (!ctx || ctx.agencyId !== state.agencyId) return new Response("Not found", { status: 404 });
  if (!can(ctx.role, "content.edit")) return new Response("Forbidden", { status: 403 });

  const back = (result: string) =>
    new Response(null, {
      status: 302,
      headers: {
        Location: new URL(
          `/app/${state.slug}/projects/${state.projectId}/analytics?google=${result}`,
          env.APP_URL,
        ).toString(),
        "Cache-Control": "no-store",
        // The nonce is used once.
        "Set-Cookie": `${GOOGLE_NONCE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/api/google; Max-Age=0`,
      },
    });

  if (parsed.data.error || !parsed.data.code) return back("denied");
  try {
    await completeGoogleConnect(ctx, state.projectId, parsed.data.code);
    return back("connected");
  } catch (error) {
    if (error instanceof GoogleAuthError || error instanceof GoogleTemporaryError) {
      logger.warn({ err: error }, "google connect failed");
      return back("failed");
    }
    logger.error({ err: error }, "google connect error");
    return back("failed");
  }
}
