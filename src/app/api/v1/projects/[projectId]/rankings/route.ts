import { apiList, withApiKey } from "@/server/api/v1";
import { apiListRankings, readApiPage } from "@/server/services/api-v1";

/** GET /api/v1/projects/{projectId}/rankings: the latest position of each keyword. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  const { projectId } = await params;
  return withApiKey(request, "read:rankings", async ({ agencyId }) => {
    const page = readApiPage(new URL(request.url).searchParams);
    const { rows, total } = await apiListRankings(agencyId, projectId.slice(0, 100), page);
    return apiList(rows, total, page);
  });
}
