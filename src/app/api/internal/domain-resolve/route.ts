import { limitRequest } from "@/server/request-limit";
import { getEnv } from "@/env";
import { normalizeHost } from "@/lib/custom-domain";
import { findAgencySlugByDomain } from "@/server/services/custom-domain";

/** Used by `proxy.ts` to find which agency owns a custom domain. Public info: it is in the portal URL. */
export async function GET(request: Request): Promise<Response> {
  const limited = await limitRequest(request, "domain-resolve", 1200);
  if (limited) return limited;
  if (!getEnv().CUSTOM_DOMAINS_ENABLED) return new Response("Not found", { status: 404 });
  const host = normalizeHost(new URL(request.url).searchParams.get("host") ?? "");
  const slug = host ? await findAgencySlugByDomain(host) : null;
  if (!slug)
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return Response.json({ slug }, { headers: { "Cache-Control": "no-store" } });
}
