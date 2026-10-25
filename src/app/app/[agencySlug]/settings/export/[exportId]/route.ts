import { getSessionUser } from "@/server/auth/session";
import { loadTenantContext } from "@/server/auth/tenant-context";
import { logger } from "@/server/logger";
import { AppError } from "@/server/services/errors";
import { readExport } from "@/server/services/data-export";

type Params = { params: Promise<{ agencySlug: string; exportId: string }> };

/** The data export zip. Owners of that agency only. */
export async function GET(_request: Request, { params }: Params): Promise<Response> {
  const { agencySlug, exportId } = await params;
  const user = await getSessionUser();
  if (!user?.emailVerified) return new Response("Unauthorized", { status: 401 });
  const ctx = await loadTenantContext(user.id, agencySlug);
  if (!ctx) return new Response("Not found", { status: 404 });
  try {
    const file = await readExport(ctx, exportId);
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(file.bytes.length),
        "Content-Disposition": `attachment; filename="${agencySlug}-data-${file.createdAt.toISOString().slice(0, 10)}.zip"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return new Response(error.message, { status: error.code === "FORBIDDEN" ? 403 : 404 });
    }
    logger.error({ err: error }, "export download failed");
    return new Response("Something went wrong.", { status: 500 });
  }
}
