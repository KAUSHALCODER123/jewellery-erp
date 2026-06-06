import { execSync } from "node:child_process";
import fs from "node:fs";

// 1. Mount prefixes from server.ts: app.use("/api/x", xRouter)
const server = fs.readFileSync("src/server.ts", "utf8");
const mounts = {};
for (const m of server.matchAll(/app\.use\(\s*["']([^"']+)["']\s*,\s*([A-Za-z0-9_]+)\s*\)/g)) {
  // a router can be mounted twice (e.g. inventory + stone at /api/inventory); keep first
  if (!mounts[m[2]]) mounts[m[2]] = m[1];
}

// 2. All frontend /api references (literal) from tsx
const feRaw = execSync('grep -rhoE "/api/[a-zA-Z0-9/_.-]+" src --include=*.tsx').toString().split("\n").filter(Boolean);
const fe = new Set(feRaw);

function feHas(fullPath) {
  const staticPrefix = fullPath.split("/:")[0];
  for (const f of fe) {
    if (f === fullPath || f === staticPrefix) return true;
    if (staticPrefix.length > 7 && f.startsWith(staticPrefix)) return true;
    if (f.length > 7 && staticPrefix.startsWith(f)) return true;
  }
  return false;
}

const files = execSync('grep -rlE "Router\\.(get|post|put|patch|delete)\\(" src --include=*.ts').toString().split("\n").filter(Boolean);
const gaps = [];
let total = 0;
for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  const routerVars = [...src.matchAll(/(?:const|export const)\s+([A-Za-z0-9_]+)\s*=\s*Router\(\)/g)].map((m) => m[1]);
  for (const v of routerVars) {
    const prefix = mounts[v];
    if (!prefix) continue;
    const esc = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(esc + "\\.(get|post|put|patch|delete)\\(\\s*[\"'`]([^\"'`]+)", "g");
    for (const m of src.matchAll(re)) {
      total++;
      const method = m[1].toUpperCase();
      const sub = m[2];
      const full = (prefix + (sub === "/" ? "" : sub)).replace(/\/+/g, "/");
      if (!feHas(full)) gaps.push(`${method.padEnd(6)} ${full}   [${file.replace(/^src\//, "")}]`);
    }
  }
}
console.log(`Checked ${total} backend endpoints across ${files.length} router files.`);
console.log(`UNREFERENCED IN FRONTEND (${gaps.length}):\n`);
console.log(gaps.sort().join("\n"));
