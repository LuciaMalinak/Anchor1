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
};

export default nextConfig;
