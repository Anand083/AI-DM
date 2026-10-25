import type { NextConfig } from "next";
import { NON_FRAMEABLE_SOURCE, securityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  // A small self-contained server for the Docker image.
  output: "standalone",
  // Public report links must never be indexed or stored by shared caches.
  async headers() {
    return [
      // Security headers on everything except the pages meant to be framed by other sites.
      {
        source: NON_FRAMEABLE_SOURCE,
        headers: securityHeaders({ dev: process.env.NODE_ENV !== "production" }),
      },
      {
        source: "/r/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "private, no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
