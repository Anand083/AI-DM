/** The most issues shown to a visitor. */
export const TOP_ISSUES = 5;
/** Pages the mini audit looks at. */
export const LEAD_AUDIT_PAGES = 5;

export type LeadIssue = {
  code: string;
  title: string;
  severity: "CRITICAL" | "WARNING" | "NOTICE";
  fix: string;
  /** On how many of the checked pages the issue was found. */
  pages: number;
};

const SEVERITY_ORDER = { CRITICAL: 0, WARNING: 1, NOTICE: 2 } as const;

/**
 * The few issues worth showing a visitor: grouped by type, most serious first, then the ones found
 * on the most pages. `lookup` gives the readable text for a code.
 */
export function topIssues(
  found: readonly { code: string }[],
  lookup: (code: string) => Omit<LeadIssue, "code" | "pages">,
  limit = TOP_ISSUES,
): LeadIssue[] {
  const pages = new Map<string, number>();
  for (const f of found) pages.set(f.code, (pages.get(f.code) ?? 0) + 1);
  return [...pages.entries()]
    .map(([code, count]) => ({ code, pages: count, ...lookup(code) }))
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        b.pages - a.pages ||
        a.title.localeCompare(b.title),
    )
    .slice(0, limit);
}

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,59}$/;

/** The text an agency pastes into its website. */
export function embedCode(appUrl: string, slug: string): string {
  const origin = appUrl.replace(/\/$/, "");
  return `<script src="${origin}/widget/embed.js" data-agency="${slug}" async></script>`;
}

/**
 * The script that website owners load. It puts the widget page in a frame right where the script
 * tag is, and resizes the frame when the widget tells it how tall it is. It only trusts messages
 * from our own address and from that frame.
 */
export function embedScript(): string {
  return `(function () {
  var script = document.currentScript;
  if (!script) return;
  var slug = script.getAttribute("data-agency");
  if (!slug || !/^[a-z0-9][a-z0-9-]{0,59}$/.test(slug)) return;
  var origin = new URL(script.src).origin;
  var frame = document.createElement("iframe");
  frame.src = origin + "/widget/" + encodeURIComponent(slug);
  frame.title = "Free website check";
  frame.loading = "lazy";
  frame.style.cssText = "width:100%;border:0;display:block;min-height:380px";
  script.parentNode.insertBefore(frame, script);
  window.addEventListener("message", function (event) {
    if (event.origin !== origin || event.source !== frame.contentWindow) return;
    var data = event.data;
    if (data && data.type === "lead-widget-height" && typeof data.height === "number") {
      frame.style.height = Math.min(Math.max(data.height, 200), 2000) + "px";
    }
  });
})();
`;
}
