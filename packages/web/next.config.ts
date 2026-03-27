import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@claw/shared-db"],
};

export default nextConfig;
