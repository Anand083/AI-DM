import { AUDIT_ISSUE_SEVERITY, type AuditIssueCode } from "./issue-codes";

export type IssueInfo = {
  code: AuditIssueCode;
  title: string;
  severity: "CRITICAL" | "WARNING" | "NOTICE";
  /** Why it matters, in plain English. */
  why: string;
  /** What to do about it, in plain English. */
  fix: string;
};

type Text = { title: string; why: string; fix: string };

const TEXT: Record<AuditIssueCode, Text> = {
  missing_title: {
    title: "Page has no title",
    why: "The title is the headline people see in Google. Without one, Google makes up its own and the page looks unprofessional.",
    fix: "Add a short, clear title to the page (about 50 to 60 characters) that says what the page is about.",
  },
  duplicate_title: {
    title: "Same title on several pages",
    why: "When pages share a title, Google cannot tell them apart and people do not know which result to click.",
    fix: "Give every page its own title that describes that page.",
  },
  title_too_long: {
    title: "Title is too long",
    why: "Google cuts long titles off, so people may miss the important words.",
    fix: "Shorten the title to about 60 characters and put the main words first.",
  },
  missing_meta_description: {
    title: "No meta description",
    why: "The description is the short text under the title in Google. A good one makes more people click.",
    fix: "Write a description of 120 to 155 characters that explains what the page offers.",
  },
  duplicate_meta_description: {
    title: "Same description on several pages",
    why: "Repeated descriptions make results look alike and give people no reason to choose your page.",
    fix: "Write a different description for each page.",
  },
  missing_h1: {
    title: "No main heading (H1)",
    why: "The main heading tells visitors and search engines what the page is about.",
    fix: "Add one clear H1 heading at the top of the page.",
  },
  multiple_h1: {
    title: "More than one main heading (H1)",
    why: "Several main headings make the page structure unclear.",
    fix: "Keep one H1 and turn the others into H2 or H3 headings.",
  },
  broken_link_4xx: {
    title: "Broken page (404 or similar)",
    why: "Visitors and Google land on an error page. This hurts trust and wastes the links that point to it.",
    fix: "Restore the page, or redirect the old address to the best matching page, and fix links that point to it.",
  },
  server_error_5xx: {
    title: "Server error (5xx)",
    why: "The website failed to answer. Visitors cannot see the page and Google may drop it from results.",
    fix: "Ask your developer or host to check the server logs and fix the error. Check again after it is fixed.",
  },
  redirect_chain: {
    title: "Page goes through several redirects",
    why: "Each extra redirect slows the page down and can lose some of the value of links.",
    fix: "Point links straight to the final address, and make old addresses redirect once.",
  },
  slow_page: {
    title: "Page loads slowly",
    why: "Slow pages lose visitors, and Google prefers fast pages.",
    fix: "Make images smaller, remove scripts you do not need, and use caching. Aim for under 3 seconds.",
  },
  large_image: {
    title: "Image is too large",
    why: "Big image files slow the page down, especially on phones.",
    fix: "Resize the image to the size it is shown at and save it in a modern format such as WebP.",
  },
  missing_alt_text: {
    title: "Image has no description (alt text)",
    why: "Alt text helps people who cannot see the image and helps Google understand it.",
    fix: "Add a short description of what the image shows in the image's alt field.",
  },
  no_https: {
    title: "Website is not secure (no HTTPS)",
    why: "Browsers warn visitors that the site is not secure, and Google ranks secure sites higher.",
    fix: "Install an SSL certificate and make every page load over https://.",
  },
  mixed_content: {
    title: "Secure page loads insecure files",
    why: "Browsers may block the insecure files or show a warning, which breaks the page and scares visitors.",
    fix: "Change links to images, scripts and styles from http:// to https://.",
  },
  noindex_page: {
    title: "Page is hidden from Google (noindex)",
    why: "Google is told not to show this page. That is fine for private pages, but a mistake for pages you want found.",
    fix: "If the page should appear in Google, remove the noindex tag.",
  },
  missing_canonical: {
    title: "No canonical address",
    why: "Without it, Google may treat several addresses of the same page as different pages.",
    fix: "Add a canonical tag that points to the main address of the page.",
  },
  thin_content: {
    title: "Very little text on the page",
    why: "Pages with almost no text rarely rank and may look low quality to Google.",
    fix: "Add useful content that answers what visitors are looking for, or combine the page with a related one.",
  },
  missing_structured_data: {
    title: "No structured data",
    why: "Structured data helps Google show extras like ratings, prices and questions in the results.",
    fix: "Add schema.org markup that fits the page, such as Organization, Product or FAQ.",
  },
  not_mobile_friendly: {
    title: "Page is hard to use on a phone",
    why: "Most searches happen on phones. Google ranks mobile-friendly pages higher.",
    fix: "Use a responsive design: readable text, buttons that are easy to tap, and no sideways scrolling.",
  },
  missing_sitemap: {
    title: "No sitemap found",
    why: "A sitemap lists your pages so Google can find them all.",
    fix: "Create a sitemap.xml file, add it to your robots.txt, and submit it in Google Search Console.",
  },
  robots_blocking: {
    title: "robots.txt blocks search engines",
    why: "Google is told not to visit parts of the site or the whole site. Blocked pages cannot rank.",
    fix: "Open robots.txt and remove the rules that block pages you want in Google.",
  },
  orphan_page: {
    title: "No links point to this page",
    why: "Pages with no links from other pages are hard for visitors and Google to find.",
    fix: "Link to the page from related pages and from your menu or sitemap.",
  },
  duplicate_content: {
    title: "Same text on several pages",
    why: "When pages share most of their text, Google has to pick one and may pick the wrong one.",
    fix: "Rewrite the pages so each is unique, merge them, or point the copies to the main page with a canonical tag.",
  },
  poor_lcp: {
    title: "Main content appears slowly (LCP)",
    why: "Largest Contentful Paint is how long the biggest part of the page takes to show. Over 4 seconds is poor and is a Google ranking signal.",
    fix: "Make the top image smaller, load it first, and speed up the server. Aim for under 2.5 seconds.",
  },
  poor_cls: {
    title: "Page jumps while loading (CLS)",
    why: "Cumulative Layout Shift measures content that moves as the page loads. Jumping buttons annoy visitors and hurt rankings.",
    fix: "Set a width and height on images and ads, and do not insert content above what people are reading. Aim for under 0.1.",
  },
  poor_inp: {
    title: "Page reacts slowly to taps and clicks (INP)",
    why: "Interaction to Next Paint is how fast the page answers a click. Over 500 ms feels broken and is a Google ranking signal.",
    fix: "Remove heavy scripts, split long tasks and delay tools you do not need straight away. Aim for under 200 ms.",
  },
  invalid_structured_data: {
    title: "Structured data has errors",
    why: "Google ignores markup it cannot read, so you lose rich results such as ratings and questions.",
    fix: "Test the page in Google's Rich Results Test and fix the missing or wrong fields it lists.",
  },
  sitemap_errors: {
    title: "Sitemap lists bad addresses",
    why: "A sitemap that lists broken, redirected or blocked pages wastes Google's time and hides the good pages.",
    fix: "Keep only live, indexable pages in the sitemap and rebuild it after changes.",
  },
};

export const ISSUE_CATALOG: Record<AuditIssueCode, IssueInfo> = Object.fromEntries(
  (Object.keys(TEXT) as AuditIssueCode[]).map((code) => [
    code,
    { code, severity: AUDIT_ISSUE_SEVERITY[code], ...TEXT[code] },
  ]),
) as Record<AuditIssueCode, IssueInfo>;

/** Info for any code. Unknown codes (for example from a future provider) get a plain fallback. */
export function issueInfo(code: string): IssueInfo {
  const known = (ISSUE_CATALOG as Record<string, IssueInfo>)[code];
  if (known) return known;
  return {
    code: code as AuditIssueCode,
    severity: "NOTICE",
    title: code.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
    why: "This is something the audit found that may affect how your site performs in search.",
    fix: "Check the affected pages and fix the problem.",
  };
}

const SEVERITY_ORDER = { CRITICAL: 0, WARNING: 1, NOTICE: 2 } as const;
export const severityRank = (s: keyof typeof SEVERITY_ORDER) => SEVERITY_ORDER[s];
