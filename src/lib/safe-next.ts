/** Only allow paths inside the app, so a link cannot send people to another site. */
export function safeNext(value: string | string[] | undefined, fallback = "/app"): string {
  const next = Array.isArray(value) ? value[0] : value;
  return next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\")
    ? next
    : fallback;
}
