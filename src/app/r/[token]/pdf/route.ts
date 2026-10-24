import { pdfResponse } from "@/server/reports/pdf-response";
import { getSharedReport, readSharedPdf } from "@/server/services/shared-reports";

type Params = { params: Promise<{ token: string }> };

/** The PDF behind a public share link. Same rules as the page: unknown or expired gives 404. */
export async function GET(_request: Request, { params }: Params): Promise<Response> {
  const shared = await getSharedReport((await params).token);
  const bytes = shared ? await readSharedPdf(shared) : null;
  if (!shared || !bytes) return new Response("Not found", { status: 404 });
  return pdfResponse(bytes, shared.title, shared.periodEnd);
}
