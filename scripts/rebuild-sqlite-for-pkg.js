import { spawnSync } from "node:child_process";
import path from "node:path";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const betterSqlitePath = path.join("node_modules", "better-sqlite3");
const env = Object.fromEntries(
  Object.entries(process.env).filter((entry) => typeof entry[1] === "string")
);

const result = spawnSync(
  npmCommand,
  ["run", "build-release", "--prefix", betterSqlitePath],
  {
    env: {
      ...env,
      npm_config_target: "18.5.0",
      npm_config_runtime: "node",
      npm_config_disturl: "https://nodejs.org/download/release",
      npm_config_build_from_source: "true"
    },
    shell: process.platform === "win32",
    stdio: "inherit"
  }
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
