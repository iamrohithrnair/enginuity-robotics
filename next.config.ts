import type { NextConfig } from "next";

const nextConfig: NextConfig = {
   
  distDir: process.env.RC_DIST_DIR || ".next",
  cacheComponents: true,
   
  devIndicators: false,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
