import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CloudCountry",
    short_name: "CloudCountry",
    description:
      "Australian weather — radar, warnings, forecasts, and deeper insight.",
    start_url: "/",
    display: "standalone",
    background_color: "#070b16",
    theme_color: "#070b16",
    orientation: "any",
    icons: [
      {
        src: "/icon",
        sizes: "32x32",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
