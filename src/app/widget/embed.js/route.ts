import { embedScript } from "@/lib/lead-widget";

/** The script agencies paste into their website. It is the same for every agency. */
export async function GET(): Promise<Response> {
  return new Response(embedScript(), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
