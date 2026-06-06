# 18 — Backup & Recovery

**Prerequisite:** Logged in as admin.
⚠️⚠️ **Full Restore REPLACES the live database** and is irreversible — **only on a throwaway test DB**.
Prefer **Test Restore (Dry-Run)** to validate without overwriting anything.

Covers creating backups, the backup history, **schedule** config, validation/dry-run/restore, and
**crash recovery** (WAL checkpoint, integrity check).

> ℹ️ Backups are gzipped SQLite snapshots, optionally **AES-256-GCM encrypted** with a passphrase
> (only a SHA-256 hash is stored, never the plaintext). Default location `~/.shree-erp/backups`
> (`.test-backups` in test mode). File pattern `shree-erp-backup-{timestamp}.bak.gz[.enc]`.

---

## A. Create a backup
1. Sidebar → **Backup & Recovery** → tab **Backup Now**.
2. Target: **LOCAL** (USB/CLOUD need a configured path/URL). Optionally set a Passphrase.
3. Click **Run Backup Now**.
4. **Expected:** "Backup created: {file_name}"; it appears in the recent list with size, checksum, status **SUCCESS**.

## B. History + validate + dry-run
1. Tab **History** → paginated list (type, target, file, size, status, timestamps).
2. On the new backup: **Validate Checksum** → expected vs actual SHA-256 match (valid = true).
3. **Test Restore (Dry-Run)** (supply passphrase if encrypted) → decrypts/decompresses to a temp DB and runs `PRAGMA integrity_check`.
4. **Expected:** dry-run reports OK without touching the live DB. **Download** also works for SUCCESS backups.

## C. Schedule
1. Tab **Schedule**.
2. Toggle **Enable Scheduled Backups**; set Interval (hours, ≥1), Target, Local Backup Directory, Max Backups Retained (≥1).
3. Optionally set a Passphrase (shows **** if already set; **Clear Passphrase** to remove). Toggle **Backup on App Exit**.
4. **Save Schedule**.
5. **Expected:** "Schedule configuration saved."; scheduler reschedules; Last Run shown.

## D. Crash recovery
1. Tab **Recovery**.
2. **Expected:** Crash Log content (if any), WAL status (wal/shm sizes), Integrity Check result.
3. Click **Force WAL Checkpoint** → runs `wal_checkpoint(TRUNCATE)`; WAL size should drop.

## E. Full restore (⚠️ test DB only)
1. Tab **Recovery** → Restore form → pick a backup → passphrase if encrypted.
2. Click **Full Restore** → confirm the **"This will replace the live database. Continue?"** dialog.
3. **Expected:** "Database restored successfully. Restart the application to reload connections." (a restart flag is written). Restart and confirm data matches the chosen backup.

---

## F. Edge cases

| # | Input / action | Expected |
|---|----------------|----------|
| F1 | Backup to **USB/CLOUD** with no path/URL configured | Blocked (400) — target not configured |
| F2 | Encrypted backup, **dry-run with wrong passphrase** | Blocked (400) — passphrase mismatch |
| F3 | Encrypted backup, **dry-run with no passphrase** | Blocked (400) — passphrase required |
| F4 | Validate a backup whose file was deleted on disk | 404 — file missing |
| F5 | Download a non-SUCCESS (FAILED/UPLOADING) backup | 404 — only SUCCESS downloadable |
| F6 | Full Restore but **Cancel** the confirm dialog | Nothing happens — live DB untouched |
| F7 | Schedule interval `0` or blank | Rejected — must be ≥1 |
| F8 | Max retained `0` | Rejected — must be ≥1 |
| F9 | Restore an **encrypted** backup with wrong passphrase | Blocked before overwrite — checksum/passphrase/integrity gate |
| F10 | Tamper a backup file then Validate | valid = false (checksum mismatch) |

## G. Cross-checks
| # | Check | Expected |
|---|-------|----------|
| G1 | Create N+1 backups with Max Retained = N | Oldest pruned after a successful backup |
| G2 | last-status after a fresh backup | `stale = false`, hours_since small (drives the close-app reminder) |
| G3 | Passphrase storage | Never returned/stored in plaintext (only `has_passphrase` boolean) |
| G4 | After Full Restore + restart (E) | Data reflects the restored snapshot, not the pre-restore state |

## H. What to report
- PASS/FAIL per row + exact error text.
- **State clearly whether Full Restore (E) was run on a disposable DB** — do not run it on real data.
- Confirm the dry-run validates **without** overwriting (B) and the wrong-passphrase gate blocks restore (F2/F9).
- Confirm retention pruning (G1) and that passphrases are never exposed (G3).
- Screenshot: a SUCCESS backup in History + a passing integrity check.
