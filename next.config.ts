import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Keep Turbopack rooted on this app when pages-site/ also has a lockfile.
  turbopack: {
    root: projectRoot,
  },
  // Standalone output is for Railway/Docker self-host. Vercel uses its own bundling.
  ...(process.env.VERCEL ? {} : { output: "standalone" as const }),
  async redirects() {
    return [
      { source: "/about", destination: "/", permanent: false },
      { source: "/contact", destination: "/", permanent: false },
      { source: "/data-sources", destination: "/", permanent: false },
      { source: "/disclaimer", destination: "/", permanent: false },
      { source: "/learn", destination: "/", permanent: false },
      { source: "/observations", destination: "/", permanent: false },
      { source: "/weather-map", destination: "/", permanent: false },
      { source: "/severe-weather", destination: "/risk", permanent: false },
    ];
  },
};

export default nextConfig;
