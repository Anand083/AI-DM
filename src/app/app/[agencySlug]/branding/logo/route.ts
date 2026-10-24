import { getSessionUser } from "@/server/auth/session";
import { loadTenantContext } from "@/server/auth/tenant-context";
import { logger } from "@/server/logger";
import { AppError } from "@/server/services/errors";
import { MAX_LOGO_BYTES } from "@/server/services/logo";
import { readLogo, removeLogo, setLogo } from "@/server/services/branding";

type Params = { params: Promise<{ agencySlug: string }> };

async function authorize(agencySlug: string) {
  const user = await getSessionUser();
  if (!user?.emailVerified)
    return { ok: false, response: new Response("Unauthorized", { status: 401 }) } as const;
  const ctx = await loadTenantContext(user.id, agencySlug);
  if (!ctx) return { ok: false, response: new Response("Not found", { status: 404 }) } as const;
  return { ok: true, ctx } as const;
}

function failure(error: unknown): Response {
  if (error instanceof AppError) {
    const status = error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 : 400;
    return Response.json({ error: error.message, fieldErrors: error.fieldErrors }, { status });
  }
  logger.error({ err: error }, "logo request failed");
  return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}

/** The agency logo, for people in the agency (the app and the branding page). */
export async function GET(_request: Request, { params }: Params): Promise<Response> {
  const auth = await authorize((await params).agencySlug);
  if (!auth.ok) return auth.response;
  const logo = await readLogo(auth.ctx.agencyId);
  if (!logo) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(logo.bytes), {
    headers: {
      "Content-Type": logo.contentType,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}

/** Upload a new logo. Multipart form with a file field named "logo". */
export async function POST(request: Request, { params }: Params): Promise<Response> {
  const auth = await authorize((await params).agencySlug);
  if (!auth.ok) return auth.response;
  // Refuse big bodies before reading them. A little extra room is allowed for the form wrapper.
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_LOGO_BYTES + 64 * 1024) {
    return Response.json(
      {
        error: "The logo must be 1 MB or smaller.",
        fieldErrors: { logo: "The logo must be 1 MB or smaller." },
      },
      { status: 413 },
    );
  }
  try {
    const form = await request.formData();
    const file = form.get("logo");
    if (!(file instanceof File)) {
      return Response.json(
        {
          error: "Choose an image to upload.",
          fieldErrors: { logo: "Choose an image to upload." },
        },
        { status: 400 },
      );
    }
    const branding = await setLogo(auth.ctx, Buffer.from(await file.arrayBuffer()));
    return Response.json({ ok: true, logoVersion: branding.logoVersion });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(_request: Request, { params }: Params): Promise<Response> {
  const auth = await authorize((await params).agencySlug);
  if (!auth.ok) return auth.response;
  try {
    await removeLogo(auth.ctx);
    return Response.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
