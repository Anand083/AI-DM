import { getSessionUser } from "@/server/auth/session";
import { loadTenantContext } from "@/server/auth/tenant-context";
import { logger } from "@/server/logger";
import { AppError } from "@/server/services/errors";
import { deleteAttachment, readAttachment } from "@/server/services/task-attachments";

type Params = { params: Promise<{ agencySlug: string; taskId: string; attachmentId: string }> };

function failure(error: unknown): Response {
  if (error instanceof AppError) {
    const status = error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 : 400;
    return Response.json({ error: error.message }, { status });
  }
  logger.error({ err: error }, "task file request failed");
  return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}

async function authorize(agencySlug: string) {
  const user = await getSessionUser();
  if (!user?.emailVerified) return null;
  return loadTenantContext(user.id, agencySlug);
}

/** Download. Always sent as a file, never shown in the page, so a hostile file cannot run. */
export async function GET(_request: Request, { params }: Params): Promise<Response> {
  const { agencySlug, taskId, attachmentId } = await params;
  const user = await getSessionUser();
  if (!user?.emailVerified) return new Response("Unauthorized", { status: 401 });
  const ctx = await loadTenantContext(user.id, agencySlug);
  if (!ctx) return new Response("Not found", { status: 404 });
  try {
    const file = await readAttachment(ctx, taskId, attachmentId);
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(_request: Request, { params }: Params): Promise<Response> {
  const { agencySlug, taskId, attachmentId } = await params;
  const ctx = await authorize(agencySlug);
  if (!ctx) return new Response("Not found", { status: 404 });
  try {
    await deleteAttachment(ctx, taskId, attachmentId);
    return Response.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
