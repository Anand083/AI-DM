import { getSessionUser } from "@/server/auth/session";
import { loadTenantContext } from "@/server/auth/tenant-context";
import { logger } from "@/server/logger";
import { AppError } from "@/server/services/errors";
import { readReportPdf } from "@/server/services/reports";
import { pdfResponse } from "@/server/reports/pdf-response";

type Params = { params: Promise<{ agencySlug: string; reportId: string }> };

/** The PDF of a report, for people in the agency. */
export async function GET(_request: Request, { params }: Params): Promise<Response> {
  const { agencySlug, reportId } = await params;
  const user = await getSessionUser();
  if (!user?.emailVerified) return new Response("Unauthorized", { status: 401 });
  const ctx = await loadTenantContext(user.id, agencySlug);
  if (!ctx) return new Response("Not found", { status: 404 });
  try {
    const pdf = await readReportPdf(ctx, reportId);
    if (!pdf) return new Response("Not found", { status: 404 });
    return pdfResponse(pdf.bytes, pdf.title, pdf.periodEnd);
  } catch (error) {
    if (error instanceof AppError) {
      return new Response(error.message, { status: error.code === "FORBIDDEN" ? 403 : 404 });
    }
    logger.error({ err: error }, "report download failed");
    return new Response("Something went wrong.", { status: 500 });
  }
}
