import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as schema from "./schema.js";

const packagedProcess = process as NodeJS.Process & { pkg?: unknown };

function resolveDbPath() {
  if (process.env.NODE_ENV === "test") {
    return "test.sqlite";
  }

  // `process.pkg` exists only under the legacy pkg-compiled sidecar. The packaged
  // Tauri app now runs the backend with a bundled node.exe and signals packaged
  // mode via ERP_PACKAGED so we still store data under the user's home directory.
  if (packagedProcess.pkg || process.env.ERP_PACKAGED === "1") {
    const dataDir = path.join(os.homedir(), ".shree-erp");
    fs.mkdirSync(dataDir, { recursive: true });
    return path.join(dataDir, "sqlite.db");
  }

  return "sqlite.db";
}

const dbPath = resolveDbPath();
applyPendingRestore(dbPath);
console.log(`[DB] Connected to SQLite database: ${dbPath}`);
const sqlite = connectSqlite(dbPath);

export const db = drizzle(sqlite, { schema });
export { sqlite };
export function getDbPath() {
  return dbPath;
}

// Apply a staged restore (sqlite.db.pending-restore) before any connection opens.
// Doing the swap here — with no open handle — avoids the Windows EPERM that breaks
// renaming over a live SQLite file, and clears stale WAL/SHM from the replaced DB.
function applyPendingRestore(databasePath: string) {
  const pending = `${databasePath}.pending-restore`;
  if (!fs.existsSync(pending)) return;
  try {
    for (const suffix of ["-wal", "-shm"]) {
      const sidecar = `${databasePath}${suffix}`;
      if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
    }
    fs.renameSync(pending, databasePath);
    for (const leftover of [
      path.join(path.dirname(databasePath), "restore_pending.flag"),
      `${databasePath}.restoring`
    ]) {
      if (fs.existsSync(leftover)) fs.unlinkSync(leftover);
    }
    console.log("[DB] Applied staged database restore.");
  } catch (error) {
    writeCrashLog(error);
  }
}

function connectSqlite(databasePath: string) {
  try {
    const database = new Database(databasePath);
    database.pragma("foreign_keys = ON");
    database.pragma("journal_mode = WAL");
    database.pragma("synchronous = NORMAL");
    return database;
  } catch (error) {
    writeCrashLog(error);
    throw error;
  }
}

function writeCrashLog(error: unknown) {
  try {
    const crashDir = path.join(os.homedir(), ".shree-erp");
    fs.mkdirSync(crashDir, { recursive: true });
    const detail = error instanceof Error ? error.stack ?? error.message : String(error);
    // Append — the Tauri shell logs launch context to the same file, and a
    // crash must not wipe it.
    fs.appendFileSync(path.join(crashDir, "crash_log.txt"), `[${new Date().toISOString()}]\n${detail}\n`, "utf8");
  } catch {
    // Avoid masking the original database startup error.
  }
}
