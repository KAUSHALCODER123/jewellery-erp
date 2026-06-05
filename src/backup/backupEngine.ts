import Database from "better-sqlite3";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync
} from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createGzip, createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { getDbPath, sqlite } from "../db/client.js";

const ALGORITHM = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;
const SALT_LEN = 16;
const TAG_LEN = 16;
const MAGIC = Buffer.from("SHBK");
const BACKUP_FILE_PATTERN = /^shree-erp-backup-.*\.bak\.gz(\.enc)?$/;

export type BackupCreateResult = {
  fileName: string;
  filePath: string;
  fileSizeBytes: number;
  checksumSha256: string;
  isEncrypted: boolean;
};

export type IntegrityCheckResult = {
  ok: boolean;
  message: string;
};

export type RestoreResult = {
  ok: boolean;
  message: string;
  requiresRestart: boolean;
};

export function getDefaultBackupDir() {
  if (process.env.NODE_ENV === "test") {
    return path.join(process.cwd(), ".test-backups");
  }
  return path.join(os.homedir(), ".shree-erp", "backups");
}

export function hashPassphrase(passphrase: string) {
  return createHash("sha256").update(passphrase, "utf8").digest("hex");
}

export function verifyPassphrase(passphrase: string, expectedHash: string) {
  return hashPassphrase(passphrase) === expectedHash;
}

function deriveKey(passphrase: string, salt: Buffer) {
  return scryptSync(passphrase, salt, KEY_LEN);
}

async function runSnapshot(targetSqlitePath: string) {
  await sqlite.backup(targetSqlitePath);
}

async function gzipFile(inputPath: string, outputPath: string) {
  await pipeline(
    fs.createReadStream(inputPath),
    createGzip({ level: 9 }),
    fs.createWriteStream(outputPath)
  );
}

async function gunzipFile(inputPath: string, outputPath: string) {
  await pipeline(
    fs.createReadStream(inputPath),
    createGunzip(),
    fs.createWriteStream(outputPath)
  );
}

function encryptBuffer(data: Buffer, passphrase: string) {
  const salt = randomBytes(SALT_LEN);
  const key = deriveKey(passphrase, salt);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, salt, iv, tag, encrypted]);
}

function decryptBuffer(data: Buffer, passphrase: string) {
  if (data.length < MAGIC.length + SALT_LEN + IV_LEN + TAG_LEN + 1) {
    throw new Error("Invalid encrypted backup file.");
  }
  const magic = data.subarray(0, MAGIC.length);
  if (!magic.equals(MAGIC)) {
    throw new Error("Backup file is not a valid encrypted Shree ERP backup.");
  }
  let offset = MAGIC.length;
  const salt = data.subarray(offset, offset + SALT_LEN);
  offset += SALT_LEN;
  const iv = data.subarray(offset, offset + IV_LEN);
  offset += IV_LEN;
  const tag = data.subarray(offset, offset + TAG_LEN);
  offset += TAG_LEN;
  const ciphertext = data.subarray(offset);
  const key = deriveKey(passphrase, salt);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export async function createBackup(targetDir: string, passphrase?: string): Promise<BackupCreateResult> {
  fs.mkdirSync(targetDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const snapshotPath = path.join(targetDir, `.snapshot-${timestamp}.sqlite`);
  const gzipPath = path.join(targetDir, `.tmp-${timestamp}.bak.gz`);
  const isEncrypted = Boolean(passphrase?.trim());
  const fileName = isEncrypted
    ? `shree-erp-backup-${timestamp}.bak.gz.enc`
    : `shree-erp-backup-${timestamp}.bak.gz`;
  const filePath = path.join(targetDir, fileName);

  try {
    await runSnapshot(snapshotPath);
    await gzipFile(snapshotPath, gzipPath);

    if (isEncrypted && passphrase) {
      const gzipData = fs.readFileSync(gzipPath);
      const encrypted = encryptBuffer(gzipData, passphrase);
      fs.writeFileSync(filePath, encrypted);
    } else {
      fs.renameSync(gzipPath, filePath);
    }

    const fileSizeBytes = fs.statSync(filePath).size;
    const checksumSha256 = computeChecksum(filePath);

    return { fileName, filePath, fileSizeBytes, checksumSha256, isEncrypted };
  } finally {
    if (fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath);
    if (fs.existsSync(gzipPath)) fs.unlinkSync(gzipPath);
  }
}

export function computeChecksum(filePath: string) {
  const data = fs.readFileSync(filePath);
  return createHash("sha256").update(data).digest("hex");
}

export function validateChecksum(filePath: string, expectedHash: string) {
  const actual = computeChecksum(filePath);
  return actual === expectedHash;
}

export async function decryptAndDecompress(
  encryptedPath: string,
  passphrase: string | undefined,
  outputPath: string
) {
  const ext = path.extname(encryptedPath);
  const isEncrypted = encryptedPath.endsWith(".enc") || ext === ".enc";

  if (isEncrypted) {
    if (!passphrase?.trim()) {
      throw new Error("Passphrase is required for encrypted backups.");
    }
    const raw = fs.readFileSync(encryptedPath);
    const decrypted = decryptBuffer(raw, passphrase);
    const gzipTemp = `${outputPath}.gz.tmp`;
    fs.writeFileSync(gzipTemp, decrypted);
    try {
      await gunzipFile(gzipTemp, outputPath);
    } finally {
      if (fs.existsSync(gzipTemp)) fs.unlinkSync(gzipTemp);
    }
    return;
  }

  await gunzipFile(encryptedPath, outputPath);
}

export async function testRestore(backupPath: string, passphrase?: string): Promise<IntegrityCheckResult> {
  const tempDir = path.join(os.tmpdir(), "shree-erp-restore-test");
  fs.mkdirSync(tempDir, { recursive: true });
  const tempDb = path.join(tempDir, `test-${Date.now()}.sqlite`);

  try {
    await decryptAndDecompress(backupPath, passphrase, tempDb);
    const testDb = new Database(tempDb, { readonly: true });
    try {
      const row = testDb.pragma("integrity_check", { simple: true }) as string;
      const ok = row === "ok";
      return { ok, message: ok ? "integrity_check passed" : String(row) };
    } finally {
      testDb.close();
    }
  } finally {
    if (fs.existsSync(tempDb)) fs.unlinkSync(tempDb);
  }
}

export async function performRestore(backupPath: string, passphrase?: string): Promise<RestoreResult> {
  const liveDbPath = getDbPath();
  const tempDir = path.join(os.homedir(), ".shree-erp", "restore-temp");
  fs.mkdirSync(tempDir, { recursive: true });
  const tempDb = path.join(tempDir, `restore-${Date.now()}.sqlite`);

  try {
    await decryptAndDecompress(backupPath, passphrase, tempDb);
    const integrity = await testRestore(backupPath, passphrase);
    if (!integrity.ok) {
      return { ok: false, message: integrity.message, requiresRestart: false };
    }

    const pendingFlag = path.join(path.dirname(liveDbPath), "restore_pending.flag");
    fs.copyFileSync(tempDb, `${liveDbPath}.restoring`);
    fs.renameSync(`${liveDbPath}.restoring`, liveDbPath);
    fs.writeFileSync(
      pendingFlag,
      JSON.stringify({ restoredAt: new Date().toISOString(), from: backupPath }),
      "utf8"
    );

    return {
      ok: true,
      message: "Database restored successfully. Restart the application to reload connections.",
      requiresRestart: true
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message, requiresRestart: false };
  } finally {
    if (fs.existsSync(tempDb)) fs.unlinkSync(tempDb);
  }
}

export function pruneOldBackups(targetDir: string, maxCount: number) {
  if (!fs.existsSync(targetDir) || maxCount < 1) return [];

  const files = fs
    .readdirSync(targetDir)
    .filter((name) => BACKUP_FILE_PATTERN.test(name))
    .map((name) => {
      const fullPath = path.join(targetDir, name);
      return { name, fullPath, mtime: fs.statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);

  const removed: string[] = [];
  for (const file of files.slice(maxCount)) {
    fs.unlinkSync(file.fullPath);
    removed.push(file.fullPath);
  }
  return removed;
}

export async function uploadToCloud(filePath: string, uploadUrl: string) {
  const body = fs.readFileSync(filePath);
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(body.length)
    },
    body
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Cloud upload failed (${response.status}): ${detail || response.statusText}`);
  }
}

export function readCrashLog() {
  const crashLogPath = path.join(os.homedir(), ".shree-erp", "crash_log.txt");
  if (!fs.existsSync(crashLogPath)) {
    return { exists: false, content: "" };
  }
  return { exists: true, content: fs.readFileSync(crashLogPath, "utf8") };
}

export function getWalStatus() {
  const walPath = `${getDbPath()}-wal`;
  const shmPath = `${getDbPath()}-shm`;
  return {
    wal_exists: fs.existsSync(walPath),
    wal_size_bytes: fs.existsSync(walPath) ? fs.statSync(walPath).size : 0,
    shm_exists: fs.existsSync(shmPath),
    shm_size_bytes: fs.existsSync(shmPath) ? fs.statSync(shmPath).size : 0
  };
}

export function runIntegrityCheck(): IntegrityCheckResult {
  const row = sqlite.pragma("integrity_check", { simple: true }) as string;
  const ok = row === "ok";
  return { ok, message: ok ? "ok" : String(row) };
}

export function forceWalCheckpoint() {
  const result = sqlite.pragma("wal_checkpoint(TRUNCATE)") as Array<{
    busy: number;
    log: number;
    checkpointed: number;
  }>;
  return {
    busy: result[0]?.busy ?? 0,
    log: result[0]?.log ?? 0,
    checkpointed: result[0]?.checkpointed ?? 0
  };
}

export function resolveTargetDir(
  target: "LOCAL" | "USB" | "CLOUD",
  config: {
    local_backup_dir?: string | null;
    usb_backup_dir?: string | null;
  }
) {
  if (target === "USB") {
    const usbDir = config.usb_backup_dir?.trim();
    if (!usbDir) throw new Error("USB backup directory is not configured.");
    return usbDir;
  }
  return config.local_backup_dir?.trim() || getDefaultBackupDir();
}
