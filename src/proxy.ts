import { NextResponse, type NextRequest } from "next/server";
import { classifyHost, portalPathFor } from "@/lib/custom-domain";

const SLUG_TTL_MS = 30_000;
const slugCache = new Map<string, { slug: string | null; until: number }>();

function platformHosts(): string[] {
  return [process.env.APP_URL, process.env.BETTER_AUTH_URL, process.env.CUSTOM_DOMAIN_CNAME_TARGET]
    .filter((v): v is string => Boolean(v))
    .map((v) => {
      try {
        return new URL(v.includes("://") ? v : `https://${v}`).hostname.toLowerCase();
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}

/** Asks our own server which agency owns a custom domain. Cached for a short time. */
async function slugForHost(host: string): Promise<string | null> {
  const cached = slugCache.get(host);
  if (cached && cached.until > Date.now()) return cached.slug;
  const internal = process.env.INTERNAL_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`;
  let slug: string | null = null;
  try {
    const response = await fetch(
      `${internal}/api/internal/domain-resolve?host=${encodeURIComponent(host)}`,
      {
        cache: "no-store",
      },
    );
    if (response.ok) slug = ((await response.json()) as { slug?: string }).slug ?? null;
  } catch {
    // If the lookup fails we show a 404 for this request and try again later.
    return null;
  }
  slugCache.set(host, { slug, until: Date.now() + SLUG_TTL_MS });
  return slug;
}

/**
 * Two jobs:
 * 1. On an agency's own domain (when custom domains are on), show that agency's client portal.
 * 2. Before rendering `/app`: no session cookie means go to the login page. This only looks for the
 *    cookie. The real check (valid, verified session) happens in the page or action.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (process.env.CUSTOM_DOMAINS_ENABLED === "true") {
    const kind = classifyHost(request.headers.get("host"), platformHosts());
    if (kind.kind === "custom") {
      // Auth, health and file routes work the same on every host.
      if (pathname.startsWith("/api/")) return NextResponse.next();
      const slug = await slugForHost(kind.host);
      const target = slug ? portalPathFor(pathname, slug) : null;
      if (!target) return new NextResponse("Not found", { status: 404 });
      const url = request.nextUrl.clone();
      url.pathname = target;
      return NextResponse.rewrite(url);
    }
  }

  if (!pathname.startsWith("/app")) return NextResponse.next();
  const hasSession =
    request.cookies.has("better-auth.session_token") ||
    request.cookies.has("__Secure-better-auth.session_token");
  if (hasSession) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/|favicon.ico).*)"] };
