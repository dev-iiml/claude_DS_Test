import type { MetadataRoute } from "next";

import { colors } from "@/design/tokens";

/** Installable as a home-screen app on iPhone/Android (standalone, dark). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CreatorCo",
    short_name: "CreatorCo",
    description: "A premium professional and financial network for creators.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: colors.dark.paper,
    theme_color: colors.dark.paper,
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
