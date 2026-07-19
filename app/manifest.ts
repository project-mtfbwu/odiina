import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Odiina",
    short_name: "Odiina",
    description:
      "A private raw-life and work feed that turns daily activity into traceable personal intelligence.",
    start_url: "/feed",
    display: "standalone",
    background_color: "#f5f4f0",
    theme_color: "#6254b8",
  };
}
