import { apiList, withApiKey } from "@/server/api/v1";
import { apiListProjects, readApiPage } from "@/server/services/api-v1";

/** GET /api/v1/projects?page=1&per_page=50&client_id=... */
export async function GET(request: Request): Promise<Response> {
  return withApiKey(request, "read:projects", async ({ agencyId }) => {
    const params = new URL(request.url).searchParams;
    const page = readApiPage(params);
    const clientId = params.get("client_id")?.slice(0, 100) || undefined;
    const { rows, total } = await apiListProjects(agencyId, page, clientId);
    return apiList(rows, total, page);
  });
}
