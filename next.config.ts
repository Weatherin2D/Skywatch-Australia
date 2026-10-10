import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin workspace root so pages-site/package-lock.json does not steal Turbopack root.
  turbopack: {
    root: process.cwd(),
  },
  // Standalone is for Docker/Railway. Vercel uses its own output pipeline.
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
