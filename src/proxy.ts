import { NextResponse, type NextRequest } from "next/server";

/**
 * Quick check before rendering `/app`: no session cookie means go to the login page.
 * This only looks for the cookie. The real check (valid, verified session) happens
 * in the page or action with `requireUser()`.
 */
export function proxy(request: NextRequest) {
  const hasSession =
    request.cookies.has("better-auth.session_token") ||
    request.cookies.has("__Secure-better-auth.session_token");
  if (hasSession) return NextResponse.next();

  const url = request.nextUrl.clone();
  const next = request.nextUrl.pathname + request.nextUrl.search;
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(next)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/app/:path*"] };
