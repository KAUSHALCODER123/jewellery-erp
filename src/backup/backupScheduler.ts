import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { backupLogs, backupScheduleConfig } from "../db/schema.js";
import {
  createBackup,
  getDefaultBackupDir,
  pruneOldBackups,
  resolveTargetDir,
  uploadToCloud
} from "./backupEngine.js";

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let schedulerRunning = false;

function getScheduleConfig() {
  let config = db.query.backupScheduleConfig.findFirst().sync();
  if (!config) {
    db.insert(backupScheduleConfig)
      .values({
        is_enabled: false,
        interval_hours: 24,
        target: "LOCAL",
        max_retained_backups: 10
      })
      .run();
    config = db.query.backupScheduleConfig.findFirst().sync();
  }
  return config;
}

async function runScheduledBackup() {
  if (schedulerRunning) return;
  schedulerRunning = true;

  const config = getScheduleConfig();
  if (!config?.is_enabled) {
    schedulerRunning = false;
    return;
  }

  const startedAt = new Date().toISOString();
  const target = config.target;
  let targetDir = getDefaultBackupDir();

  try {
    targetDir = resolveTargetDir(target, config);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.insert(backupLogs)
      .values({
        backup_type: "SCHEDULED",
        target,
        file_name: "",
        file_path: "",
        file_size_bytes: 0,
        checksum_sha256: "",
        is_encrypted: false,
        status: "FAILED",
        error_message: message,
        started_at: startedAt,
        completed_at: new Date().toISOString()
      })
      .run();
    schedulerRunning = false;
    return;
  }

  const logInsert = db
    .insert(backupLogs)
    .values({
      backup_type: "SCHEDULED",
      target,
      file_name: "pending",
      file_path: targetDir,
      file_size_bytes: 0,
      checksum_sha256: "",
      is_encrypted: false,
      status: target === "CLOUD" ? "UPLOADING" : "UPLOADING",
      started_at: startedAt
    })
    .returning()
    .get();

  try {
    const backup = await createBackup(targetDir);
    db.update(backupLogs)
      .set({
        file_name: backup.fileName,
        file_path: backup.filePath,
        file_size_bytes: backup.fileSizeBytes,
        checksum_sha256: backup.checksumSha256,
        is_encrypted: backup.isEncrypted,
        status: target === "CLOUD" ? "UPLOADING" : "SUCCESS",
        completed_at: target === "CLOUD" ? null : new Date().toISOString()
      })
      .where(eq(backupLogs.id, logInsert.id))
      .run();

    if (target === "CLOUD") {
      const uploadUrl = config.cloud_upload_url?.trim();
      if (!uploadUrl) throw new Error("Cloud upload URL is not configured.");
      await uploadToCloud(backup.filePath, uploadUrl);
      db.update(backupLogs)
        .set({
          status: "SUCCESS",
          completed_at: new Date().toISOString()
        })
        .where(eq(backupLogs.id, logInsert.id))
        .run();
    }

    pruneOldBackups(targetDir, config.max_retained_backups);

    db.update(backupScheduleConfig)
      .set({
        last_run_at: new Date().toISOString(),
        updated_at: sql`CURRENT_TIMESTAMP`
      })
      .where(eq(backupScheduleConfig.id, config.id))
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.update(backupLogs)
      .set({
        status: "FAILED",
        error_message: message,
        completed_at: new Date().toISOString()
      })
      .where(eq(backupLogs.id, logInsert.id))
      .run();
  } finally {
    schedulerRunning = false;
  }
}

function clearSchedulerTimer() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}

export function startScheduler() {
  if (process.env.NODE_ENV === "test" && process.env.PLAYWRIGHT !== "true") {
    return;
  }
  failOrphanedBackupLogs();
  reschedule();
}

// A backup interrupted by the process being killed (e.g. the desktop shell
// stops the sidecar while an exit backup is still running) leaves its log row
// stuck in UPLOADING. Nothing can still be uploading at boot, so mark them failed.
function failOrphanedBackupLogs() {
  db.update(backupLogs)
    .set({
      status: "FAILED",
      error_message: "Interrupted — the application stopped before this backup finished.",
      completed_at: new Date().toISOString()
    })
    .where(eq(backupLogs.status, "UPLOADING"))
    .run();
}

export function stopScheduler() {
  clearSchedulerTimer();
}

export function reschedule() {
  clearSchedulerTimer();
  const config = getScheduleConfig();
  if (!config?.is_enabled) return;

  const intervalMs = Math.max(1, config.interval_hours) * 60 * 60 * 1000;
  schedulerTimer = setInterval(() => {
    void runScheduledBackup();
  }, intervalMs);

  void runScheduledBackup();
}
