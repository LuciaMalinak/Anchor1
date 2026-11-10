import type { MetadataRoute } from "next";

// Makes Anchor installable on phones ("Add to Home Screen" on iPhone,
// "Install app" on Android): opens full-screen on the dashboard, with the
// Anchor icon. Icons come from scripts/generate-brand-assets.mjs.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Anchor.AI",
    short_name: "Anchor.AI",
    description: "Meeting context that carries forward.",
    id: "/dashboard",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#12294A",
    theme_color: "#12294A",
    icons: [
      { src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
