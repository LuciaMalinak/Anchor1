import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Run with Node's own require: ffmpeg-static points at a binary on disk
  // and sharp loads a native module (LinkedIn bot videos).
  serverExternalPackages: ["ffmpeg-static", "sharp"],
};

export default nextConfig;
