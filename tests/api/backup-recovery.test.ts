import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { backupLogs, backupScheduleConfig } from "../../src/db/schema.js";
import { getDefaultBackupDir, validateChecksum } from "../../src/backup/backupEngine.js";

describe("Backup & Recovery API", () => {
  let adminToken: string;
  const testBackupDir = path.join(process.cwd(), ".test-backups");

  beforeAll(async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });

    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;
  });

  beforeEach(() => {
    db.delete(backupLogs).run();
    db.delete(backupScheduleConfig).run();
    fs.mkdirSync(testBackupDir, { recursive: true });
    for (const file of fs.readdirSync(testBackupDir)) {
      fs.unlinkSync(path.join(testBackupDir, file));
    }
  });

  test("POST /api/backup/create creates a local backup with valid checksum", async () => {
    db.insert(backupScheduleConfig)
      .values({
        is_enabled: false,
        interval_hours: 24,
        target: "LOCAL",
        local_backup_dir: testBackupDir,
        max_retained_backups: 10
      })
      .run();

    const res = await request(app)
      .post("/api/backup/create")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ target: "LOCAL" });

    expect(res.status).toBe(201);
    expect(res.body.backup.status).toBe("SUCCESS");
    expect(res.body.backup.file_name).toMatch(/^shree-erp-backup-/);
    expect(fs.existsSync(res.body.backup.file_path)).toBe(true);
    expect(
      validateChecksum(res.body.backup.file_path, res.body.backup.checksum_sha256)
    ).toBe(true);
  });

  test("GET /api/backup/last-status reflects the latest backup", async () => {
    // No backup yet → stale.
    const before = await request(app).get("/api/backup/last-status").set("Authorization", `Bearer ${adminToken}`);
    expect(before.status).toBe(200);
    expect(before.body.last_backup_at).toBeNull();
    expect(before.body.stale).toBe(true);

    db.insert(backupScheduleConfig).values({ is_enabled: false, interval_hours: 24, target: "LOCAL", local_backup_dir: testBackupDir, max_retained_backups: 10 }).run();
    await request(app).post("/api/backup/create").set("Authorization", `Bearer ${adminToken}`).send({ target: "LOCAL" });

    const after = await request(app).get("/api/backup/last-status").set("Authorization", `Bearer ${adminToken}`);
    expect(after.body.last_backup_at).not.toBeNull();
    expect(after.body.stale).toBe(false);
  });

  test("POST /api/backup/test-restore/:id passes integrity check", async () => {
    db.insert(backupScheduleConfig)
      .values({
        local_backup_dir: testBackupDir,
        max_retained_backups: 10
      })
      .run();

    const createRes = await request(app)
      .post("/api/backup/create")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ target: "LOCAL" });

    const backupId = createRes.body.backup.id;

    const testRes = await request(app)
      .post(`/api/backup/test-restore/${backupId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});

    expect(testRes.status).toBe(200);
    expect(testRes.body.dry_run.ok).toBe(true);
  });

  test("GET/PUT /api/backup/schedule supports config CRUD", async () => {
    const getRes = await request(app)
      .get("/api/backup/schedule")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.config).toBeDefined();
    expect(getRes.body.default_local_backup_dir).toBe(getDefaultBackupDir());

    const putRes = await request(app)
      .put("/api/backup/schedule")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        is_enabled: true,
        interval_hours: 12,
        target: "LOCAL",
        local_backup_dir: testBackupDir,
        max_retained_backups: 5,
        passphrase: "test-secret"
      });

    expect(putRes.status).toBe(200);
    expect(putRes.body.config.is_enabled).toBe(true);
    expect(putRes.body.config.interval_hours).toBe(12);
    expect(putRes.body.config.has_passphrase).toBe(true);
    expect(putRes.body.config.max_retained_backups).toBe(5);
  });

  test("PUT /api/backup/schedule rejects non-positive interval / retention", async () => {
    const badInterval = await request(app)
      .put("/api/backup/schedule")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ interval_hours: 0 });
    expect(badInterval.status).toBe(400);
    expect(badInterval.body.errors.join(" ")).toMatch(/interval_hours/);

    const badRetention = await request(app)
      .put("/api/backup/schedule")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ max_retained_backups: 0 });
    expect(badRetention.status).toBe(400);
    expect(badRetention.body.errors.join(" ")).toMatch(/max_retained_backups/);
  });

  test("GET /api/backup/logs lists backup history", async () => {
    db.insert(backupScheduleConfig).values({ local_backup_dir: testBackupDir }).run();

    await request(app)
      .post("/api/backup/create")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ target: "LOCAL" });

    const listRes = await request(app)
      .get("/api/backup/logs")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.logs.length).toBeGreaterThanOrEqual(1);
    expect(listRes.body.pagination.total).toBeGreaterThanOrEqual(1);

    const detailId = listRes.body.logs[0].id;
    const detailRes = await request(app)
      .get(`/api/backup/logs/${detailId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(detailRes.status).toBe(200);
    expect(detailRes.body.backup.id).toBe(detailId);
  });

  test("POST /api/backup/validate/:id validates checksum", async () => {
    db.insert(backupScheduleConfig).values({ local_backup_dir: testBackupDir }).run();

    const createRes = await request(app)
      .post("/api/backup/create")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ target: "LOCAL" });

    const validateRes = await request(app)
      .post(`/api/backup/validate/${createRes.body.backup.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});

    expect(validateRes.status).toBe(200);
    expect(validateRes.body.valid).toBe(true);
  });

  test("GET /api/backup/crash-recovery returns diagnostics", async () => {
    const res = await request(app)
      .get("/api/backup/crash-recovery")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.crash_log).toBeDefined();
    expect(res.body.wal).toBeDefined();
    expect(res.body.integrity_check).toBeDefined();
    expect(typeof res.body.integrity_check.ok).toBe("boolean");
  });

  test("POST /api/backup/on-exit runs backup when enabled", async () => {
    // 1. By default, backup_on_exit is false. POST /on-exit should return early.
    db.insert(backupScheduleConfig)
      .values({
        local_backup_dir: testBackupDir,
        backup_on_exit: false
      })
      .run();

    const disabledRes = await request(app)
      .post("/api/backup/on-exit")
      .send({});
    
    expect(disabledRes.status).toBe(200);
    expect(disabledRes.body.message).toBe("Backup on exit is disabled.");
    expect(fs.readdirSync(testBackupDir).length).toBe(0);

    // 2. Enable backup_on_exit
    db.delete(backupScheduleConfig).run();
    db.insert(backupScheduleConfig)
      .values({
        local_backup_dir: testBackupDir,
        backup_on_exit: true
      })
      .run();

    const enabledRes = await request(app)
      .post("/api/backup/on-exit")
      .send({});

    expect(enabledRes.status).toBe(200);
    expect(enabledRes.body.message).toBe("Backup on exit created successfully.");
    expect(enabledRes.body.backup).toBeDefined();
    expect(fs.readdirSync(testBackupDir).length).toBe(1);
  });
});
