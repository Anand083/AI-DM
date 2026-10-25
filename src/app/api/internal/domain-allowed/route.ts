import { getEnv } from "@/env";
import { normalizeHost } from "@/lib/custom-domain";
import { findAgencySlugByDomain } from "@/server/services/custom-domain";

/**
 * For the web server that issues certificates on demand (Caddy). 200 only for a domain that an
 * active agency has verified, 404 for everything else. Gives no details.
 */
export async function GET(request: Request): Promise<Response> {
  if (!getEnv().CUSTOM_DOMAINS_ENABLED) return new Response("Not found", { status: 404 });
  const domain = normalizeHost(new URL(request.url).searchParams.get("domain") ?? "");
  const slug = domain ? await findAgencySlugByDomain(domain) : null;
  return new Response(slug ? "ok" : "Not found", {
    status: slug ? 200 : 404,
    headers: { "Cache-Control": "no-store" },
  });
}
