import { limitRequest } from "@/server/request-limit";
import { pdfResponse } from "@/server/reports/pdf-response";
import { getSharedReport, readSharedPdf } from "@/server/services/shared-reports";

type Params = { params: Promise<{ token: string }> };

/** The PDF behind a public share link. Same rules as the page: unknown or expired gives 404. */
export async function GET(request: Request, { params }: Params): Promise<Response> {
  const limited = await limitRequest(request, "share", 60);
  if (limited) return limited;
  const shared = await getSharedReport((await params).token);
  const bytes = shared ? await readSharedPdf(shared) : null;
  if (!shared || !bytes) return new Response("Not found", { status: 404 });
  return pdfResponse(bytes, shared.title, shared.periodEnd);
}
