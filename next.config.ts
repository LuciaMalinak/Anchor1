import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Run with Node's own require: ffmpeg-static points at a binary on disk
  // and sharp loads a native module (LinkedIn bot videos).
  serverExternalPackages: ["ffmpeg-static", "sharp"],
  // Next.js 16.4 builds couldn't load the Tailwind PostCSS plugin from its
  // default child-process workers ("Cannot find module @tailwindcss/postcss");
  // worker threads load it fine. Needs Node 22 (.node-version): on Node
  // 24.13.1+ Next falls back to child processes.
  experimental: { turbopackPluginRuntimeStrategy: "workerThreads" },
  // Standard browser protections every page is sent with (the checks a
  // client's IT security scan looks for): HTTPS only, no embedding Anchor.AI
  // inside another site, no guessing file types, no full URLs leaked to
  // other sites, and no camera or location access. The microphone stays
  // allowed for Anchor.AI's own pages (recording and Ask Anchor voice).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
        ],
      },
    ];
  },
};

export default nextConfig;
