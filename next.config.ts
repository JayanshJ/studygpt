import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep these on Node instead of bundling them.
  // - better-sqlite3: native module.
  // - tesseract.js: spawns worker_threads and resolves its wasm core / worker
  //   script / lang data relative to its package at runtime; bundling under
  //   turbopack breaks that resolution and hangs createWorker. Externalizing
  //   lets Node require the real package path so the worker spawns correctly.
  serverExternalPackages: ["better-sqlite3", "tesseract.js"],
};

export default nextConfig;
