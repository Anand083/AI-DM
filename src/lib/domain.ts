const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Cleans what a person typed into a plain domain: "https://www.Example.com/page?x=1" becomes
 * "example.com". Subdomains other than "www" are kept. Returns null if it is not a valid domain.
 */
export function normalizeDomain(input: string): string | null {
  let value = input.trim().toLowerCase();
  if (!value) return null;
  if (/\s/.test(value)) return null;

  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(value)) value = `http://${value}`;
  let host: string;
  try {
    host = new URL(value).hostname;
  } catch {
    return null;
  }
  host = host.replace(/\.$/, "");
  if (host.startsWith("www.")) host = host.slice(4);

  if (host.length > 253 || !host.includes(".")) return null;
  // Raw IP addresses are not websites we can track.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || host.startsWith("["))
    return null;
  const labels = host.split(".");
  const tld = labels[labels.length - 1]!;
  if (!labels.every((label) => LABEL.test(label) || label.startsWith("xn--"))) return null;
  if (!/^[a-z]{2,63}$/.test(tld) && !tld.startsWith("xn--")) return null;
  return host;
}

/** Turns a typed website into a full https:// URL for storing on a client, or null if invalid. */
export function normalizeWebsite(input: string): string | null {
  const domain = normalizeDomain(input);
  return domain ? `https://${domain}` : null;
}
