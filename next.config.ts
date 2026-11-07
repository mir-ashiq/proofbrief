import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // TypeScript errors fail the build (no ignoreBuildErrors bypass); a separate
  // `bunx tsc --noEmit` also runs in development. See README for the checks.
  reactStrictMode: false,
};

export default nextConfig;
