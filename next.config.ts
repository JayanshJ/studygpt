import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module; keep it on Node instead of bundling it.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
