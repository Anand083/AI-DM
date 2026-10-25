import { describe, expect, it } from "vitest";
import {
  contentSecurityPolicy,
  NON_FRAMEABLE_SOURCE,
  securityHeaders,
  widgetHeaders,
} from "./security-headers";

const get = (headers: ReturnType<typeof securityHeaders>, key: string) =>
  headers.find((h) => h.key === key)?.value;

describe("security headers", () => {
  it("sends the full set in production, including HSTS", () => {
    const headers = securityHeaders({ dev: false });
    expect(get(headers, "X-Frame-Options")).toBe("DENY");
    expect(get(headers, "X-Content-Type-Options")).toBe("nosniff");
    expect(get(headers, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(get(headers, "Permissions-Policy")).toContain("camera=()");
    expect(get(headers, "Strict-Transport-Security")).toContain("max-age=63072000");
    const csp = get(headers, "Content-Security-Policy")!;
    for (const part of [
      "default-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ]) {
      expect(csp).toContain(part);
    }
    expect(csp).not.toContain("unsafe-eval");
  });

  it("allows eval and websockets only while developing, and never sends HSTS then", () => {
    const dev = securityHeaders({ dev: true });
    expect(get(dev, "Strict-Transport-Security")).toBeUndefined();
    expect(contentSecurityPolicy({ dev: true })).toContain("'unsafe-eval'");
    expect(contentSecurityPolicy({ dev: true })).toContain("ws:");
    expect(contentSecurityPolicy({ dev: false })).not.toContain("ws:");
  });

  it("does not allow other sites' scripts", () => {
    expect(contentSecurityPolicy({ dev: false })).not.toMatch(/script-src[^;]*https?:/);
  });

  it("the framing rule skips only the widget paths", () => {
    // The pattern is also a valid regular expression, which is how Next.js reads it.
    const matches = (path: string) => new RegExp(`^${NON_FRAMEABLE_SOURCE}$`).test(path);
    expect(matches("/")).toBe(true);
    expect(matches("/app/acme")).toBe(true);
    expect(matches("/widgetry")).toBe(true);
    expect(matches("/widget")).toBe(false);
    expect(matches("/widget/abc")).toBe(false);
  });
});

describe("widget headers", () => {
  it("allow framing by any site but stay strict otherwise", () => {
    const headers = widgetHeaders({ dev: false });
    const csp = get(headers, "Content-Security-Policy")!;
    expect(csp).toContain("frame-ancestors *");
    expect(csp).not.toContain("frame-ancestors 'none'");
    for (const part of [
      "default-src 'self'",
      "object-src 'none'",
      "form-action 'self'",
      "base-uri 'self'",
    ]) {
      expect(csp).toContain(part);
    }
    expect(csp).not.toMatch(/script-src[^;]*https?:/);
    // Framing is allowed, so there is no X-Frame-Options.
    expect(get(headers, "X-Frame-Options")).toBeUndefined();
    expect(get(headers, "X-Robots-Tag")).toBe("noindex, nofollow");
    expect(get(headers, "X-Content-Type-Options")).toBe("nosniff");
    expect(get(headers, "Strict-Transport-Security")).toContain("max-age");
    expect(get(widgetHeaders({ dev: true }), "Strict-Transport-Security")).toBeUndefined();
  });

  it("does not loosen the normal headers", () => {
    expect(contentSecurityPolicy({ dev: false })).toContain("frame-ancestors 'none'");
  });
});
