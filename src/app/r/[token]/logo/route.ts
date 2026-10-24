import { getSharedReport, readSharedLogo } from "@/server/services/shared-reports";

type Params = { params: Promise<{ token: string }> };

/** The agency logo for a public report page. Only works while the share link works. */
export async function GET(_request: Request, { params }: Params): Promise<Response> {
  const shared = await getSharedReport((await params).token);
  const logo = shared ? await readSharedLogo(shared) : null;
  if (!logo) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(logo.bytes), {
    headers: {
      "Content-Type": logo.contentType,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
