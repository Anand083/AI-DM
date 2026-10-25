import { apiList, withApiKey } from "@/server/api/v1";
import { apiListClients, readApiPage } from "@/server/services/api-v1";

/** GET /api/v1/clients?page=1&per_page=50 */
export async function GET(request: Request): Promise<Response> {
  return withApiKey(request, "read:clients", async ({ agencyId }) => {
    const page = readApiPage(new URL(request.url).searchParams);
    const { rows, total } = await apiListClients(agencyId, page);
    return apiList(rows, total, page);
  });
}
