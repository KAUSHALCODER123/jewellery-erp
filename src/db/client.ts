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

  if (packagedProcess.pkg) {
    const dataDir = path.join(os.homedir(), ".shree-erp");
    fs.mkdirSync(dataDir, { recursive: true });
    return path.join(dataDir, "sqlite.db");
  }

  return "sqlite.db";
}

const dbPath = resolveDbPath();
console.log(`[DB] Connected to SQLite database: ${dbPath}`);
const sqlite = connectSqlite(dbPath);

export const db = drizzle(sqlite, { schema });
export { sqlite };
export function getDbPath() {
  return dbPath;
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
    fs.writeFileSync(path.join(crashDir, "crash_log.txt"), `[${new Date().toISOString()}]\n${detail}\n`, "utf8");
  } catch {
    // Avoid masking the original database startup error.
  }
}
