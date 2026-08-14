import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep these on Node instead of bundling them.
  // - better-sqlite3: native module.
  // - tesseract.js: spawns worker_threads and resolves its wasm core / worker
  //   script / lang data relative to its package at runtime; bundling under
  //   turbopack breaks that resolution and hangs createWorker. Externalizing
  //   lets Node require the real package path so the worker spawns correctly.
  // - puppeteer: resolves its downloaded Chromium binary relative to its
  //   package at runtime; bundling under turbopack breaks that resolution and
  //   launch() hangs. Externalizing lets Node require the real package path.
  // - mupdf: WASM-based PDF renderer (page → JPEG for the diagram vision
  //   pipeline). Bundling under turbopack breaks the WASM loader; externalizing
  //   lets Node load it as a real package.
  serverExternalPackages: ["better-sqlite3", "tesseract.js", "puppeteer", "mupdf"],
};

export default nextConfig;
