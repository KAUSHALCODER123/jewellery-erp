import { desc, eq, sql } from "drizzle-orm";
import { Router } from "express";
import fs from "node:fs";
import { requireAdmin, requireAuth, type AuthenticatedRequest } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { backupLogs, backupScheduleConfig, type BackupTarget } from "../db/schema.js";
import { reschedule } from "./backupScheduler.js";
import {
  computeChecksum,
  createBackup,
  forceWalCheckpoint,
  getDefaultBackupDir,
  getWalStatus,
  hashPassphrase,
  performRestore,
  pruneOldBackups,
  readCrashLog,
  resolveTargetDir,
  runIntegrityCheck,
  testRestore,
  uploadToCloud,
  validateChecksum,
  verifyPassphrase
} from "./backupEngine.js";

export const backupRouter = Router();

const BACKUP_TARGETS = new Set<BackupTarget>(["LOCAL", "USB", "CLOUD"]);

function ensureScheduleConfig() {
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
  return config!;
}

function formatScheduleConfig(config: typeof backupScheduleConfig.$inferSelect) {
  return {
    id: config.id,
    is_enabled: config.is_enabled,
    interval_hours: config.interval_hours,
    target: config.target,
    local_backup_dir: config.local_backup_dir,
    usb_backup_dir: config.usb_backup_dir,
    cloud_upload_url: config.cloud_upload_url,
    max_retained_backups: config.max_retained_backups,
    has_passphrase: Boolean(config.passphrase_hash),
    backup_on_exit: config.backup_on_exit,
    last_run_at: config.last_run_at,
    updated_at: config.updated_at
  };
}

function formatBackupLog(log: typeof backupLogs.$inferSelect) {
  return {
    id: log.id,
    backup_type: log.backup_type,
    target: log.target,
    file_name: log.file_name,
    file_path: log.file_path,
    file_size_bytes: log.file_size_bytes,
    checksum_sha256: log.checksum_sha256,
    is_encrypted: log.is_encrypted,
    status: log.status,
    error_message: log.error_message,
    started_at: log.started_at,
    completed_at: log.completed_at,
    created_by: log.created_by
  };
}

backupRouter.post("/create", requireAuth, requireAdmin, async (request, response) => {
  const authUser = (request as AuthenticatedRequest).user;
  const body = request.body as { target?: BackupTarget; passphrase?: string };
  const target = body.target ?? "LOCAL";

  if (!BACKUP_TARGETS.has(target)) {
    return response.status(400).json({ errors: ["Invalid backup target."] });
  }

  const config = ensureScheduleConfig();
  const startedAt = new Date().toISOString();

  let targetDir: string;
  try {
    targetDir = resolveTargetDir(target, config);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return response.status(400).json({ errors: [message] });
  }

  const passphrase = body.passphrase?.trim() || undefined;
  if (config.passphrase_hash && passphrase && !verifyPassphrase(passphrase, config.passphrase_hash)) {
    return response.status(400).json({ errors: ["Passphrase does not match configured backup passphrase."] });
  }

  const pending = db
    .insert(backupLogs)
    .values({
      backup_type: "MANUAL",
      target,
      file_name: "pending",
      file_path: targetDir,
      file_size_bytes: 0,
      checksum_sha256: "",
      is_encrypted: Boolean(passphrase),
      status: "UPLOADING",
      started_at: startedAt,
      created_by: authUser.id
    })
    .returning()
    .get();

  try {
    const backup = await createBackup(targetDir, passphrase);
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
      .where(eq(backupLogs.id, pending.id))
      .run();

    if (target === "CLOUD") {
      const uploadUrl = config.cloud_upload_url?.trim();
      if (!uploadUrl) {
        throw new Error("Cloud upload URL is not configured.");
      }
      await uploadToCloud(backup.filePath, uploadUrl);
      db.update(backupLogs)
        .set({
          status: "SUCCESS",
          completed_at: new Date().toISOString()
        })
        .where(eq(backupLogs.id, pending.id))
        .run();
    }

    pruneOldBackups(targetDir, config.max_retained_backups);

    const log = db.query.backupLogs.findFirst({ where: eq(backupLogs.id, pending.id) }).sync();
    return response.status(201).json({ backup: formatBackupLog(log!) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.update(backupLogs)
      .set({
        status: "FAILED",
        error_message: message,
        completed_at: new Date().toISOString()
      })
      .where(eq(backupLogs.id, pending.id))
      .run();

    const log = db.query.backupLogs.findFirst({ where: eq(backupLogs.id, pending.id) }).sync();
    return response.status(500).json({ errors: [message], backup: log ? formatBackupLog(log) : null });
  }
});

backupRouter.get("/logs", requireAuth, (request, response) => {
  const page = Math.max(1, Number(request.query.page ?? 1));
  const limit = Math.min(100, Math.max(1, Number(request.query.limit ?? 20)));
  const offset = (page - 1) * limit;

  const logs = db
    .select()
    .from(backupLogs)
    .orderBy(desc(backupLogs.started_at))
    .limit(limit)
    .offset(offset)
    .all();

  const total = db.select({ count: sql<number>`count(*)` }).from(backupLogs).get()?.count ?? 0;

  return response.json({
    logs: logs.map(formatBackupLog),
    pagination: { page, limit, total }
  });
});

backupRouter.get("/logs/:id", requireAuth, (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isFinite(id)) {
    return response.status(400).json({ errors: ["Invalid backup log id."] });
  }

  const log = db.query.backupLogs.findFirst({ where: eq(backupLogs.id, id) }).sync();
  if (!log) {
    return response.status(404).json({ errors: ["Backup log not found."] });
  }

  return response.json({ backup: formatBackupLog(log) });
});

backupRouter.get("/download/:id", requireAuth, requireAdmin, (request, response) => {
  const id = Number(request.params.id);
  const log = db.query.backupLogs.findFirst({ where: eq(backupLogs.id, id) }).sync();

  if (!log || log.status !== "SUCCESS") {
    return response.status(404).json({ errors: ["Backup file not found."] });
  }

  if (!fs.existsSync(log.file_path)) {
    return response.status(404).json({ errors: ["Backup file no longer exists on disk."] });
  }

  return response.download(log.file_path, log.file_name);
});

backupRouter.post("/validate/:id", requireAuth, requireAdmin, (request, response) => {
  const id = Number(request.params.id);
  const log = db.query.backupLogs.findFirst({ where: eq(backupLogs.id, id) }).sync();

  if (!log) {
    return response.status(404).json({ errors: ["Backup log not found."] });
  }

  if (!fs.existsSync(log.file_path)) {
    return response.status(404).json({ errors: ["Backup file not found on disk."] });
  }

  const valid = validateChecksum(log.file_path, log.checksum_sha256);
  const actual = computeChecksum(log.file_path);

  return response.json({
    valid,
    expected: log.checksum_sha256,
    actual
  });
});

backupRouter.post("/test-restore/:id", requireAuth, requireAdmin, async (request, response) => {
  const id = Number(request.params.id);
  const body = request.body as { passphrase?: string };
  const log = db.query.backupLogs.findFirst({ where: eq(backupLogs.id, id) }).sync();

  if (!log) {
    return response.status(404).json({ errors: ["Backup log not found."] });
  }

  if (!fs.existsSync(log.file_path)) {
    return response.status(404).json({ errors: ["Backup file not found on disk."] });
  }

  const config = ensureScheduleConfig();
  const passphrase = body.passphrase?.trim();
  if (log.is_encrypted) {
    if (!passphrase) {
      return response.status(400).json({ errors: ["Passphrase is required for encrypted backups."] });
    }
    if (config.passphrase_hash && !verifyPassphrase(passphrase, config.passphrase_hash)) {
      return response.status(400).json({ errors: ["Passphrase verification failed."] });
    }
  }

  try {
    const result = await testRestore(log.file_path, passphrase);
    return response.json({ dry_run: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return response.status(400).json({ errors: [message] });
  }
});

backupRouter.post("/restore/:id", requireAuth, requireAdmin, async (request, response) => {
  const id = Number(request.params.id);
  const body = request.body as { passphrase?: string };
  const log = db.query.backupLogs.findFirst({ where: eq(backupLogs.id, id) }).sync();

  if (!log) {
    return response.status(404).json({ errors: ["Backup log not found."] });
  }

  if (!fs.existsSync(log.file_path)) {
    return response.status(404).json({ errors: ["Backup file not found on disk."] });
  }

  if (!validateChecksum(log.file_path, log.checksum_sha256)) {
    return response.status(400).json({ errors: ["Checksum validation failed. Aborting restore."] });
  }

  const config = ensureScheduleConfig();
  const passphrase = body.passphrase?.trim();
  if (log.is_encrypted) {
    if (!passphrase) {
      return response.status(400).json({ errors: ["Passphrase is required for encrypted backups."] });
    }
    if (config.passphrase_hash && !verifyPassphrase(passphrase, config.passphrase_hash)) {
      return response.status(400).json({ errors: ["Passphrase verification failed."] });
    }
  }

  const result = await performRestore(log.file_path, passphrase);
  if (!result.ok) {
    return response.status(400).json({ errors: [result.message] });
  }

  return response.json({ restore: result });
});

// Last successful backup + staleness, for the "back up before closing" reminder.
backupRouter.get("/last-status", requireAuth, (_request, response) => {
  const last = db
    .select()
    .from(backupLogs)
    .where(eq(backupLogs.status, "SUCCESS"))
    .orderBy(desc(backupLogs.completed_at))
    .limit(1)
    .get();

  const STALE_HOURS = 24;
  if (!last || !last.completed_at) {
    return response.json({ last_backup_at: null, last_backup_id: null, hours_since: null, stale: true, stale_threshold_hours: STALE_HOURS });
  }

  const completed = new Date(`${last.completed_at.replace(" ", "T")}Z`).getTime();
  const hoursSince = (Date.now() - completed) / 3_600_000;

  return response.json({
    last_backup_at: last.completed_at,
    last_backup_id: last.id,
    last_backup_target: last.target,
    hours_since: Math.round(hoursSince * 10) / 10,
    stale: hoursSince >= STALE_HOURS,
    stale_threshold_hours: STALE_HOURS
  });
});

backupRouter.get("/schedule", requireAuth, (_request, response) => {
  const config = ensureScheduleConfig();
  return response.json({
    config: formatScheduleConfig(config),
    default_local_backup_dir: getDefaultBackupDir()
  });
});

backupRouter.put("/schedule", requireAuth, requireAdmin, (request, response) => {
  const body = request.body as {
    is_enabled?: boolean;
    interval_hours?: number;
    target?: BackupTarget;
    local_backup_dir?: string | null;
    usb_backup_dir?: string | null;
    cloud_upload_url?: string | null;
    max_retained_backups?: number;
    passphrase?: string;
    clear_passphrase?: boolean;
    backup_on_exit?: boolean;
  };

  const config = ensureScheduleConfig();
  const updates: Partial<typeof backupScheduleConfig.$inferInsert> = {};

  if (typeof body.is_enabled === "boolean") updates.is_enabled = body.is_enabled;
  if (typeof body.interval_hours === "number" && body.interval_hours >= 1) {
    updates.interval_hours = Math.floor(body.interval_hours);
  }
  if (body.target && BACKUP_TARGETS.has(body.target)) updates.target = body.target;
  if (body.local_backup_dir !== undefined) updates.local_backup_dir = body.local_backup_dir;
  if (body.usb_backup_dir !== undefined) updates.usb_backup_dir = body.usb_backup_dir;
  if (body.cloud_upload_url !== undefined) updates.cloud_upload_url = body.cloud_upload_url;
  if (typeof body.max_retained_backups === "number" && body.max_retained_backups >= 1) {
    updates.max_retained_backups = Math.floor(body.max_retained_backups);
  }
  if (body.clear_passphrase) {
    updates.passphrase_hash = null;
  } else if (body.passphrase?.trim()) {
    updates.passphrase_hash = hashPassphrase(body.passphrase.trim());
  }
  if (typeof body.backup_on_exit === "boolean") {
    updates.backup_on_exit = body.backup_on_exit;
  }

  db.update(backupScheduleConfig)
    .set({ ...updates, updated_at: sql`CURRENT_TIMESTAMP` })
    .where(eq(backupScheduleConfig.id, config.id))
    .run();
  reschedule();

  const refreshed = ensureScheduleConfig();
  return response.json({ config: formatScheduleConfig(refreshed) });
});

backupRouter.post("/on-exit", async (_request, response) => {
  const config = ensureScheduleConfig();
  if (!config || !config.backup_on_exit) {
    return response.json({ message: "Backup on exit is disabled." });
  }

  const startedAt = new Date().toISOString();
  const target = config.target;
  let targetDir: string;
  try {
    targetDir = resolveTargetDir(target, config);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return response.status(400).json({ errors: [message] });
  }

  const pending = db
    .insert(backupLogs)
    .values({
      backup_type: "MANUAL",
      target,
      file_name: "pending",
      file_path: targetDir,
      file_size_bytes: 0,
      checksum_sha256: "",
      is_encrypted: false,
      status: "UPLOADING",
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
      .where(eq(backupLogs.id, pending.id))
      .run();

    if (target === "CLOUD") {
      const uploadUrl = config.cloud_upload_url?.trim();
      if (!uploadUrl) {
        throw new Error("Cloud upload URL is not configured.");
      }
      await uploadToCloud(backup.filePath, uploadUrl);
      db.update(backupLogs)
        .set({
          status: "SUCCESS",
          completed_at: new Date().toISOString()
        })
        .where(eq(backupLogs.id, pending.id))
        .run();
    }

    pruneOldBackups(targetDir, config.max_retained_backups);
    return response.json({ message: "Backup on exit created successfully.", backup });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.update(backupLogs)
      .set({
        status: "FAILED",
        error_message: message,
        completed_at: new Date().toISOString()
      })
      .where(eq(backupLogs.id, pending.id))
      .run();
    return response.status(500).json({ errors: [message] });
  }
});

backupRouter.get("/crash-recovery", requireAuth, requireAdmin, (_request, response) => {
  const crashLog = readCrashLog();
  const wal = getWalStatus();
  const integrity = runIntegrityCheck();

  return response.json({
    crash_log: crashLog,
    wal,
    integrity_check: integrity
  });
});

backupRouter.post("/crash-recovery/checkpoint", requireAuth, requireAdmin, (_request, response) => {
  try {
    const checkpoint = forceWalCheckpoint();
    const wal = getWalStatus();
    return response.json({ checkpoint, wal });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return response.status(500).json({ errors: [message] });
  }
});
