/** Paths other sites may put in a frame (the lead widget, Step 32). Everything else cannot be framed. */
export const FRAMEABLE_PATHS = ["widget"] as const;

export type Header = { key: string; value: string };

export function contentSecurityPolicy(options: { dev: boolean }): string {
  const { dev } = options;
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // Next.js adds small inline scripts to every page, and pages are not all rendered per request,
    // so a per-request nonce is not possible everywhere. Other sites' scripts are still blocked.
    "script-src": ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : [])],
    // Inline style attributes carry the agency's brand colours.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...(dev ? ["ws:", "wss:"] : [])],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

/**
 * Headers for every page and route. HSTS is only sent from production builds (browsers ignore it
 * over plain HTTP anyway). `frame-ancestors 'none'` and X-Frame-Options both stop clickjacking.
 */
export function securityHeaders(options: { dev: boolean }): Header[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(options) },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    ...(options.dev
      ? []
      : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
  ];
}

/** The Next.js `source` pattern that matches everything except the frameable paths. */
export const NON_FRAMEABLE_SOURCE = `/((?!(?:${FRAMEABLE_PATHS.join("|")})(?:/|$)).*)`;
