import { apiList, withApiKey } from "@/server/api/v1";
import { apiListAlerts, readApiPage } from "@/server/services/api-v1";

/** GET /api/v1/alerts?unread=1 */
export async function GET(request: Request): Promise<Response> {
  return withApiKey(request, "read:alerts", async ({ agencyId }) => {
    const params = new URL(request.url).searchParams;
    const page = readApiPage(params);
    const { rows, total } = await apiListAlerts(agencyId, page, params.get("unread") === "1");
    return apiList(rows, total, page);
  });
}
