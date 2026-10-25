import type { MetadataRoute } from "next";
import { getEnv } from "@/env";

const PAGES = ["", "/features", "/pricing", "/about", "/contact", "/terms", "/privacy"] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const base = getEnv().APP_URL.replace(/\/$/, "");
  return PAGES.map((path) => ({ url: `${base}${path}` }));
}
