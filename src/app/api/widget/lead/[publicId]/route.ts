import { limitRequest } from "@/server/request-limit";
import { getLeadStatus } from "@/server/services/leads";

/**
 * The widget asks here, every few seconds, whether the visitor's mini audit is done. The long
 * random id in the address is the only key, requests are limited by IP, and the answer holds the
 * result only: never the email or anything about the agency.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ publicId: string }> },
): Promise<Response> {
  const limited = await limitRequest(request, "widget-status", 120);
  if (limited) return limited;
  const status = await getLeadStatus((await params).publicId);
  if (!status) return new Response("Not found", { status: 404 });
  return Response.json(status, {
    headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}
