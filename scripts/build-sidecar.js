import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const bundleOnly = process.argv.includes("--bundle-only");
const renameOnly = process.argv.includes("--rename-only");
// Must match the package.json "name" — pkg derives output filenames from it
// (e.g. "jewellery-erp-win.exe"). A mismatch here makes the rename silently no-op
// and the Tauri build then fails: "resource path binaries\app-server-...exe doesn't exist".
const appName = "jewellery-erp";

// Create target directory if it doesn't exist
const binariesDir = path.join("src-tauri", "binaries");
if (!fs.existsSync(binariesDir)) {
  fs.mkdirSync(binariesDir, { recursive: true });
}

if (!renameOnly) {
  // Bundle backend to CommonJS using esbuild.
  console.log("Bundling Node.js backend using esbuild...");
  execSync("npx esbuild ./src/server.ts --bundle --platform=node --target=node18 --outfile=dist/server.cjs --external:better-sqlite3 --external:serialport", { stdio: "inherit" });
}

if (bundleOnly) {
  process.exit(0);
}

if (!renameOnly) {
  // Build sidecar binaries using pkg.
  console.log("Compiling bundled backend using pkg...");
  execSync("npx pkg . --targets node18-win-x64,node18-macos-x64 --out-path src-tauri/binaries", { stdio: "inherit" });
}

// Rename binaries to target triples required by Tauri
const winSrc = path.join(binariesDir, `${appName}-win.exe`);
const winDest = path.join(binariesDir, "app-server-x86_64-pc-windows-msvc.exe");

const macSrc = path.join(binariesDir, `${appName}-macos`);
const macDest = path.join(binariesDir, "app-server-x86_64-apple-darwin");

if (fs.existsSync(winSrc)) {
  fs.renameSync(winSrc, winDest);
  console.log(`Renamed Windows sidecar binary: ${winSrc} -> ${winDest}`);
} else {
  console.warn(`Windows sidecar binary not found at: ${winSrc}`);
}

if (fs.existsSync(macSrc)) {
  fs.renameSync(macSrc, macDest);
  console.log(`Renamed macOS sidecar binary: ${macSrc} -> ${macDest}`);
} else {
  console.warn(`macOS sidecar binary not found at: ${macSrc}`);
}
