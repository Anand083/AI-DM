import "server-only";

/** A file name that is safe in a header: letters, numbers and dashes only. */
export function pdfFileName(title: string, periodEnd: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "report"}-${periodEnd}.pdf`;
}

/** The PDF as a download. Private: it must not be cached by shared caches. */
export function pdfResponse(bytes: Buffer, title: string, periodEnd: string): Response {
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.length),
      "Content-Disposition": `attachment; filename="${pdfFileName(title, periodEnd)}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
