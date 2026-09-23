import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/about", destination: "/", permanent: false },
      { source: "/climate", destination: "/", permanent: false },
      { source: "/contact", destination: "/", permanent: false },
      { source: "/data-sources", destination: "/", permanent: false },
      { source: "/disclaimer", destination: "/", permanent: false },
      { source: "/learn", destination: "/", permanent: false },
      { source: "/observations", destination: "/", permanent: false },
      { source: "/soundings", destination: "/", permanent: false },
      { source: "/weather-map", destination: "/", permanent: false },
      { source: "/severe-weather", destination: "/risk", permanent: false },
    ];
  },
};

export default nextConfig;
