import type { MetadataRoute } from "next";
import { getEnv } from "@/env";

/** Public pages may be indexed. The app, admin, portal and shared reports may not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/app/", "/admin/", "/portal/", "/r/", "/api/", "/account/"],
    },
    sitemap: `${getEnv().APP_URL}/sitemap.xml`,
  };
}
