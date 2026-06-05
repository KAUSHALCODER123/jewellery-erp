/**
 * Ensures better-sqlite3 native bindings match the current Node.js ABI.
 * Run automatically before dev:backend via npm "predev:backend" hook.
 */
const { execSync } = require("node:child_process");
const path = require("node:path");

function loadBetterSqlite3() {
  // eslint-disable-next-line import/no-dynamic-require, global-require
  require(path.join(process.cwd(), "node_modules", "better-sqlite3"));
}

function needsRebuild(error) {
  const message = error instanceof Error ? error.message : String(error);
  const code = error && typeof error === "object" && "code" in error ? error.code : "";
  return (
    code === "ERR_DLOPEN_FAILED" ||
    message.includes("NODE_MODULE_VERSION") ||
    message.includes("Could not locate the bindings file") ||
    message.includes("was compiled against a different Node.js version")
  );
}

try {
  loadBetterSqlite3();
} catch (error) {
  if (!needsRebuild(error)) {
    throw error;
  }

  console.log(
    `[better-sqlite3] Native module mismatch for Node ${process.version} (ABI ${process.versions.modules}). Rebuilding…`
  );

  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  execSync(`${npm} rebuild better-sqlite3`, {
    stdio: "inherit",
    cwd: process.cwd(),
    shell: process.platform === "win32"
  });

  loadBetterSqlite3();
  console.log("[better-sqlite3] Rebuild successful.");
}
