/**
 * Builds the offline backend sidecar WITHOUT pkg.
 *
 * Why not pkg: pkg produces an unsigned ~70MB executable that Windows Defender
 * (and most AV vendors) flag as a false-positive Trojan, and it cannot load the
 * better-sqlite3 native .node from its virtual snapshot filesystem. Both issues
 * vanish if we instead ship the *official, code-signed* node.exe and run our
 * bundled server.cjs with it.
 *
 * Output layout (staged under src-tauri/):
 *   binaries/app-server-x86_64-pc-windows-msvc.exe   <- a copy of node.exe (signed)
 *   resources/backend/server.cjs                     <- esbuild bundle of the backend
 *   resources/backend/drizzle/**                     <- migrations
 *   resources/backend/node_modules/**                <- only the native deps kept external
 *
 * The Tauri shell then spawns:  app-server.exe  <resources>/backend/server.cjs
 * with cwd = ~/.shree-erp (writable) and ERP_PACKAGED=1.
 */
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const rootPkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const tauriDir = path.join(root, "src-tauri");
const binariesDir = path.join(tauriDir, "binaries");
const resourcesDir = path.join(tauriDir, "resources");
const backendDir = path.join(resourcesDir, "backend");
const drizzleSrc = path.join(root, "drizzle");
const drizzleDst = path.join(backendDir, "drizzle");

const WIN_SIDECAR = "app-server-x86_64-pc-windows-msvc.exe";

function run(cmd, opts = {}) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: "inherit", shell: true, ...opts });
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// 1. Clean staging.
console.log("Cleaning previous sidecar staging...");
fs.rmSync(resourcesDir, { recursive: true, force: true });
fs.mkdirSync(backendDir, { recursive: true });
fs.mkdirSync(binariesDir, { recursive: true });

// 2. Bundle the backend to a single CommonJS file (keeps native modules external).
run("node scripts/build-sidecar.js --bundle-only");
fs.copyFileSync(path.join(root, "dist", "server.cjs"), path.join(backendDir, "server.cjs"));

// 3. Install ONLY the native deps that esbuild left external, next to server.cjs.
//    Versions are pulled from the root manifest so they never drift.
const nativeDeps = ["better-sqlite3", "serialport", "@serialport/parser-readline"];
const dependencies = {};
for (const name of nativeDeps) {
  const version = rootPkg.dependencies[name];
  if (!version) throw new Error(`Expected ${name} in root package.json dependencies`);
  dependencies[name] = version;
}
fs.writeFileSync(
  path.join(backendDir, "package.json"),
  JSON.stringify({ name: "erp-backend-runtime", private: true, dependencies }, null, 2)
);
run("npm install --omit=dev --no-audit --no-fund --no-package-lock", { cwd: backendDir });

// 4. Rebuild better-sqlite3 from source against THIS node (the same node.exe we
//    ship in step 6) so the native ABI matches exactly.
run("npm rebuild better-sqlite3", { cwd: backendDir });

// 5. Copy migrations alongside server.cjs.
console.log("\nCopying drizzle migrations...");
copyDir(drizzleSrc, drizzleDst);

// 6. Ship the running (signed, official) node.exe as the sidecar binary.
const nodeExe = process.execPath;
const sidecarDest = path.join(binariesDir, WIN_SIDECAR);
fs.copyFileSync(nodeExe, sidecarDest);
console.log(`\nCopied signed node runtime as sidecar:\n  ${nodeExe}\n  -> ${sidecarDest}`);

console.log("\nSidecar (node.exe) build complete.");
