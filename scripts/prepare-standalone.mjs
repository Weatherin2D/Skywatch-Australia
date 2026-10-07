/**
 * Copy public + static assets into Next.js standalone output for self-hosting
 * (Railway Railpack / `npm start` without Docker).
 */
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const standalone = join(root, ".next", "standalone");
const staticDir = join(root, ".next", "static");
const publicDir = join(root, "public");

if (!existsSync(standalone)) {
  console.warn("[prepare-standalone] .next/standalone missing — skip");
  process.exit(0);
}

if (existsSync(staticDir)) {
  const dest = join(standalone, ".next", "static");
  mkdirSync(join(standalone, ".next"), { recursive: true });
  cpSync(staticDir, dest, { recursive: true });
}

if (existsSync(publicDir)) {
  cpSync(publicDir, join(standalone, "public"), { recursive: true });
}

console.log("[prepare-standalone] copied public + .next/static into standalone");
