import { MAX_ATTACHMENT_BYTES } from "@/lib/attachments";
import { getSessionUser } from "@/server/auth/session";
import { loadTenantContext } from "@/server/auth/tenant-context";
import { logger } from "@/server/logger";
import { AppError } from "@/server/services/errors";
import { addAttachment } from "@/server/services/task-attachments";

type Params = { params: Promise<{ agencySlug: string; taskId: string }> };

/** Upload a file to a task. Multipart form with a file field named "file". */
export async function POST(request: Request, { params }: Params): Promise<Response> {
  const { agencySlug, taskId } = await params;
  const user = await getSessionUser();
  if (!user?.emailVerified) return new Response("Unauthorized", { status: 401 });
  const ctx = await loadTenantContext(user.id, agencySlug);
  if (!ctx) return new Response("Not found", { status: 404 });
  // Refuse big bodies before reading them. A little extra room is allowed for the form wrapper.
  if (Number(request.headers.get("content-length") ?? 0) > MAX_ATTACHMENT_BYTES + 64 * 1024) {
    return Response.json({ error: "The file is too big." }, { status: 413 });
  }
  try {
    const file = (await request.formData()).get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "Choose a file to upload." }, { status: 400 });
    }
    const saved = await addAttachment(ctx, taskId, {
      name: file.name,
      bytes: Buffer.from(await file.arrayBuffer()),
    });
    return Response.json({ ok: true, id: saved.id });
  } catch (error) {
    if (error instanceof AppError) {
      const status = error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 : 400;
      return Response.json({ error: error.message }, { status });
    }
    logger.error({ err: error }, "task file upload failed");
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
