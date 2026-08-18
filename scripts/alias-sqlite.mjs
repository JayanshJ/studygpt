// Patch the Next 16 Turbopack production build so server-external packages
// (here: better-sqlite3) are required by their REAL name instead of the
// synthetic per-build hashed name Turbopack emits.
//
// Background: Next's server chunks contain
//   require("better-sqlite3-90e2652d1716b047")
// and Next's runtime require-hook is supposed to map that synthetic name to
// the real package. That mapping works for `next start` from a repo, but
// breaks inside a packaged Electron app (the hook can't resolve the synthetic
// name there → "Cannot find module 'better-sqlite3-<hash>'" → every DB route
// 500s). Rewriting the require to use the real package name sidesteps the
// hook entirely, so resolution works everywhere.
//
// Idempotent: rewrites only the synthetic form. Run after `next build`.
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverDir = join(root, ".next", "server");

if (!existsSync(serverDir)) {
  console.warn("[patch-sqlite] No .next/server found — skipping.");
  process.exit(0);
}

// Match require("better-sqlite3-<hexhash>") (double or single quotes).
const pattern = /require\("(better-sqlite3-[a-z0-9]+)"\)|require\('(better-sqlite3-[a-z0-9]+)'\)/g;

function patchFile(path) {
  let content;
  try { content = readFileSync(path, "utf8"); } catch { return 0; }
  if (!content.includes("better-sqlite3-")) return 0;
  let count = 0;
  const next = content.replace(pattern, (m, a, b) => {
    count++;
    return m.includes('"') ? 'require("better-sqlite3")' : "require('better-sqlite3')";
  });
  if (count > 0) writeFileSync(path, next);
  return count;
}

let total = 0;
let files = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p);
    else if (name.endsWith(".js")) {
      const c = patchFile(p);
      if (c > 0) { total += c; files++; }
    }
  }
}
walk(serverDir);

if (total === 0) {
  console.warn("[patch-sqlite] No synthetic better-sqlite3-<hash> requires found — nothing to patch.");
} else {
  console.log(`[patch-sqlite] Rewrote ${total} synthetic require(s) across ${files} file(s) to require("better-sqlite3").`);
}