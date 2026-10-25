const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Cleans what a person typed into a host name: "https://Portal.Example.com/x" gives
 * "portal.example.com". Unlike website domains, "www" is kept. Ports, paths and raw IP
 * addresses are refused. Returns null when it is not a usable host.
 */
export function normalizeHost(input: string): string | null {
  let value = input.trim().toLowerCase();
  if (!value || /\s/.test(value)) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(value)) value = `http://${value}`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.port || url.username || url.password) return null;
  const host = url.hostname.replace(/\.$/, "");
  if (host.length > 253 || !host.includes(".")) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return null;
  const labels = host.split(".");
  if (!labels.every((label) => LABEL.test(label) || label.startsWith("xn--"))) return null;
  const tld = labels[labels.length - 1]!;
  if (!/^[a-z]{2,63}$/.test(tld) && !tld.startsWith("xn--")) return null;
  return host;
}

/** The host from a Host header: lower case, no port. */
export function hostOf(headerValue: string | null | undefined): string {
  return (headerValue ?? "").trim().toLowerCase().replace(/:\d+$/, "");
}

export type HostKind = { kind: "platform" } | { kind: "custom"; host: string };

/**
 * Decides whether a request is for the platform itself or for an agency's own domain.
 * `platformHosts` are the hosts of APP_URL and BETTER_AUTH_URL, plus localhost.
 */
export function classifyHost(
  headerValue: string | null | undefined,
  platformHosts: readonly string[],
): HostKind {
  const host = hostOf(headerValue);
  if (!host || platformHosts.includes(host) || host === "localhost" || host === "127.0.0.1") {
    return { kind: "platform" };
  }
  return { kind: "custom", host };
}

/**
 * The path to show for a request on an agency's own domain. "/" is the portal home and other
 * paths live under the portal too. Paths that already start with the portal prefix of that
 * agency pass through; another agency's portal prefix is refused (null).
 */
export function portalPathFor(pathname: string, agencySlug: string): string | null {
  const own = `/portal/${agencySlug}`;
  if (pathname === own || pathname.startsWith(`${own}/`)) return pathname;
  if (pathname === "/portal" || pathname.startsWith("/portal/")) return null;
  return pathname === "/" ? own : `${own}${pathname}`;
}

/** The two DNS records an agency must add. `token` proves they own the domain. */
export function dnsInstructions(domain: string, cnameTarget: string, token: string) {
  return [
    { type: "CNAME", name: domain, value: cnameTarget },
    { type: "TXT", name: `_portal-verify.${domain}`, value: `portal-verify=${token}` },
  ] as const;
}
