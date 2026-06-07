import { useEffect, useMemo, useState } from "react";
import { useAuthSession } from "../auth/AuthSessionContext.js";
import {
  Archive,
  CalendarClock,
  CheckCircle2,
  CloudUpload,
  Database,
  Download,
  HardDrive,
  History,
  RefreshCw,
  ShieldAlert,
  Usb
} from "lucide-react";

type BackupRecoveryModuleProps = {
  apiBaseUrl?: string;
};

type BackupTarget = "LOCAL" | "USB" | "CLOUD";
type ActiveTab = "backup" | "history" | "schedule" | "recovery";

type BackupLog = {
  id: number;
  backup_type: string;
  target: string;
  file_name: string;
  file_path: string;
  file_size_bytes: number;
  checksum_sha256: string;
  is_encrypted: boolean;
  status: string;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  file_exists?: boolean;
};

type ScheduleConfig = {
  id: number;
  is_enabled: boolean;
  interval_hours: number;
  target: BackupTarget;
  local_backup_dir: string | null;
  usb_backup_dir: string | null;
  cloud_upload_url: string | null;
  max_retained_backups: number;
  has_passphrase: boolean;
  backup_on_exit: boolean;
  last_run_at: string | null;
};

export default function BackupRecoveryModule({ apiBaseUrl = "" }: BackupRecoveryModuleProps) {
  const { session } = useAuthSession();
  const [activeTab, setActiveTab] = useState<ActiveTab>("backup");
  const [logs, setLogs] = useState<BackupLog[]>([]);
  const [schedule, setSchedule] = useState<ScheduleConfig | null>(null);
  const [defaultLocalDir, setDefaultLocalDir] = useState("");
  const [target, setTarget] = useState<BackupTarget>("LOCAL");
  const [passphrase, setPassphrase] = useState("");
  const [selectedLogId, setSelectedLogId] = useState<number | null>(null);
  const [restorePassphrase, setRestorePassphrase] = useState("");
  const [crashData, setCrashData] = useState<{
    crash_log: { exists: boolean; content: string };
    wal: { wal_exists: boolean; wal_size_bytes: number };
    integrity_check: { ok: boolean; message: string };
  } | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastStatus, setLastStatus] = useState<{ last_backup_at: string | null; hours_since: number | null; stale: boolean; stale_threshold_hours: number } | null>(null);

  const [scheduleDraft, setScheduleDraft] = useState({
    is_enabled: false,
    interval_hours: 24,
    target: "LOCAL" as BackupTarget,
    local_backup_dir: "",
    usb_backup_dir: "",
    cloud_upload_url: "",
    max_retained_backups: 10,
    passphrase: "",
    clear_passphrase: false,
    backup_on_exit: false
  });

  const authHeaders = useMemo(
    () => ({
      Authorization: `Bearer ${session?.token ?? ""}`,
      "Content-Type": "application/json"
    }),
    [session?.token]
  );

  const isAdmin = session?.user.role === "ADMIN";

  useEffect(() => {
    void loadLogs();
    void loadSchedule();
    void loadLastStatus();
  }, []);

  async function loadLastStatus() {
    const res = await fetch(`${apiBaseUrl}/api/backup/last-status`, { headers: authHeaders });
    const data = (await res.json().catch(() => null)) as typeof lastStatus | null;
    if (res.ok && data) setLastStatus(data);
  }

  useEffect(() => {
    if (activeTab === "recovery") {
      void loadCrashRecovery();
    }
  }, [activeTab]);

  async function loadLogs() {
    const res = await fetch(`${apiBaseUrl}/api/backup/logs?limit=50`, { headers: authHeaders });
    const data = (await res.json().catch(() => null)) as { logs?: BackupLog[] } | null;
    if (res.ok && data?.logs) setLogs(data.logs);
  }

  async function loadSchedule() {
    const res = await fetch(`${apiBaseUrl}/api/backup/schedule`, { headers: authHeaders });
    const data = (await res.json().catch(() => null)) as {
      config?: ScheduleConfig;
      default_local_backup_dir?: string;
    } | null;
    if (res.ok && data?.config) {
      setSchedule(data.config);
      setDefaultLocalDir(data.default_local_backup_dir ?? "");
      setScheduleDraft({
        is_enabled: data.config.is_enabled,
        interval_hours: data.config.interval_hours,
        target: data.config.target,
        local_backup_dir: data.config.local_backup_dir ?? "",
        usb_backup_dir: data.config.usb_backup_dir ?? "",
        cloud_upload_url: data.config.cloud_upload_url ?? "",
        max_retained_backups: data.config.max_retained_backups,
        passphrase: "",
        clear_passphrase: false,
        backup_on_exit: data.config.backup_on_exit || false
      });
    }
  }

  async function loadCrashRecovery() {
    const res = await fetch(`${apiBaseUrl}/api/backup/crash-recovery`, { headers: authHeaders });
    const data = await res.json().catch(() => null);
    if (res.ok) setCrashData(data);
  }

  async function runBackup() {
    if (!isAdmin) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`${apiBaseUrl}/api/backup/create`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ target, passphrase: passphrase || undefined })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { errors?: string[] }).errors?.join(", ") ?? "Backup failed.");
        return;
      }
      setMessage(`Backup created: ${(data as { backup: BackupLog }).backup.file_name}`);
      setPassphrase("");
      await loadLogs();
      await loadLastStatus();
    } catch {
      setError("Backup request failed.");
    } finally {
      setLoading(false);
    }
  }

  async function validateBackup(id: number) {
    const res = await fetch(`${apiBaseUrl}/api/backup/validate/${id}`, {
      method: "POST",
      headers: authHeaders
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setMessage((data as { valid: boolean }).valid ? "Checksum valid." : "Checksum mismatch.");
    } else {
      setError((data as { errors?: string[] }).errors?.join(", ") ?? "Validation failed.");
    }
  }

  async function testRestore() {
    if (!selectedLogId) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${apiBaseUrl}/api/backup/test-restore/${selectedLogId}`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ passphrase: restorePassphrase || undefined })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { errors?: string[] }).errors?.join(", ") ?? "Dry-run failed.");
        return;
      }
      const dry = (data as { dry_run: { ok: boolean; message: string } }).dry_run;
      setMessage(dry.ok ? `Dry-run OK: ${dry.message}` : `Dry-run failed: ${dry.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function fullRestore() {
    if (!selectedLogId || !confirm("This will replace the live database. Continue?")) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${apiBaseUrl}/api/backup/restore/${selectedLogId}`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ passphrase: restorePassphrase || undefined })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { errors?: string[] }).errors?.join(", ") ?? "Restore failed.");
        return;
      }
      const restore = (data as { restore: { message: string } }).restore;
      setMessage(restore.message);
    } finally {
      setLoading(false);
    }
  }

  async function saveSchedule() {
    if (!isAdmin) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${apiBaseUrl}/api/backup/schedule`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({
          is_enabled: scheduleDraft.is_enabled,
          interval_hours: scheduleDraft.interval_hours,
          target: scheduleDraft.target,
          local_backup_dir: scheduleDraft.local_backup_dir || null,
          usb_backup_dir: scheduleDraft.usb_backup_dir || null,
          cloud_upload_url: scheduleDraft.cloud_upload_url || null,
          max_retained_backups: scheduleDraft.max_retained_backups,
          passphrase: scheduleDraft.passphrase || undefined,
          clear_passphrase: scheduleDraft.clear_passphrase,
          backup_on_exit: scheduleDraft.backup_on_exit
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { errors?: string[] }).errors?.join(", ") ?? "Failed to save schedule.");
        return;
      }
      setMessage("Schedule configuration saved.");
      setScheduleDraft((d) => ({ ...d, passphrase: "", clear_passphrase: false }));
      await loadSchedule();
    } finally {
      setLoading(false);
    }
  }

  async function walCheckpoint() {
    const res = await fetch(`${apiBaseUrl}/api/backup/crash-recovery/checkpoint`, {
      method: "POST",
      headers: authHeaders
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setMessage("WAL checkpoint completed.");
      await loadCrashRecovery();
    } else {
      setError((data as { errors?: string[] }).errors?.join(", ") ?? "Checkpoint failed.");
    }
  }

  function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  const tabs: { id: ActiveTab; label: string; icon: typeof Archive }[] = [
    { id: "backup", label: "Backup Now", icon: Archive },
    { id: "history", label: "History", icon: History },
    { id: "schedule", label: "Schedule", icon: CalendarClock },
    { id: "recovery", label: "Recovery", icon: ShieldAlert }
  ];

  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_auto_1fr] overflow-hidden bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-3">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-emerald-400" />
          <div>
            <h2 className="text-sm font-semibold uppercase text-slate-50">Backup & Recovery</h2>
            <p className="text-[11px] text-slate-500">Encrypted snapshots · USB / cloud targets · crash tools</p>
          </div>
        </div>
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex h-8 items-center gap-1 px-3 text-xs font-semibold uppercase ${
                activeTab === tab.id ? "bg-emerald-500 text-slate-50" : "bg-slate-950 text-slate-300"
              }`}
            >
              <tab.icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      <div>
        {lastStatus && (
          <div className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold ${lastStatus.stale ? "bg-amber-950/60 text-amber-200" : "bg-slate-900 text-slate-300"}`}>
            <ShieldAlert className="h-3.5 w-3.5" />
            {lastStatus.last_backup_at
              ? lastStatus.stale
                ? `Last backup ${lastStatus.hours_since ?? "?"}h ago — over ${lastStatus.stale_threshold_hours}h. Back up before closing the shop.`
                : `Last backup ${lastStatus.hours_since != null && lastStatus.hours_since >= 1 ? `${lastStatus.hours_since}h ago` : "just now"} · up to date.`
              : "No backup yet — run your first encrypted backup before closing the shop."}
          </div>
        )}
        {(message || error) && (
          <div className={`px-4 py-2 text-xs font-medium ${error ? "bg-red-950/60 text-red-200" : "bg-emerald-950/60 text-emerald-200"}`}>
            {error || message}
          </div>
        )}
      </div>

      <div className="min-h-0 overflow-auto p-4">
        {activeTab === "backup" && (
          <div className="mx-auto max-w-xl grid gap-4">
            <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 grid gap-3">
              <label className="text-xs font-semibold uppercase text-slate-400">Target</label>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: "LOCAL" as const, label: "Local", icon: HardDrive },
                    { id: "USB" as const, label: "USB", icon: Usb },
                    { id: "CLOUD" as const, label: "Cloud", icon: CloudUpload }
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={!isAdmin}
                    onClick={() => setTarget(opt.id)}
                    className={`flex flex-col items-center gap-1 border p-3 text-xs font-semibold uppercase ${
                      target === opt.id
                        ? "border-emerald-500 bg-emerald-950/30 text-slate-50"
                        : "border-slate-800 bg-slate-950 text-slate-400"
                    }`}
                  >
                    <opt.icon className="h-4 w-4" />
                    {opt.label}
                  </button>
                ))}
              </div>
              <label className="text-xs font-semibold uppercase text-slate-400">Encryption passphrase (optional)</label>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                disabled={!isAdmin}
                className="h-9 border border-slate-800 bg-slate-950 px-3 text-sm text-slate-50"
                placeholder="AES-256-GCM — not stored in DB"
              />
              <button
                type="button"
                disabled={!isAdmin || loading}
                onClick={() => void runBackup()}
                className="h-9 bg-emerald-500 text-sm font-semibold uppercase text-slate-50 disabled:opacity-50"
              >
                {loading ? "Creating backup…" : "Run backup now"}
              </button>
              {!isAdmin && (
                <p className="text-[11px] text-amber-300">Admin role required to create backups.</p>
              )}
            </div>
          </div>
        )}

        {activeTab === "history" && (
          <div className="border border-slate-800 bg-slate-950 rounded overflow-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-900 border-b border-slate-800 text-slate-400 font-semibold uppercase">
                  <th className="p-2">Date</th>
                  <th className="p-2">Type</th>
                  <th className="p-2">Target</th>
                  <th className="p-2">Size</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-slate-900 hover:bg-slate-900/50">
                    <td className="p-2 text-slate-300">{new Date(log.started_at).toLocaleString()}</td>
                    <td className="p-2">{log.backup_type}</td>
                    <td className="p-2">{log.target}</td>
                    <td className="p-2">{formatBytes(log.file_size_bytes)}</td>
                    <td className="p-2">
                      <span
                        className={
                          log.status === "SUCCESS"
                            ? "text-emerald-400"
                            : log.status === "FAILED"
                              ? "text-red-400"
                              : "text-amber-400"
                        }
                      >
                        {log.status}
                      </span>
                    </td>
                    <td className="p-2 flex gap-1 flex-wrap">
                      {log.status === "SUCCESS" && log.file_exists !== false && isAdmin && (
                        <>
                          <a
                            href={`${apiBaseUrl}/api/backup/download/${log.id}`}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-700"
                            onClick={(e) => {
                              e.preventDefault();
                              void fetch(`${apiBaseUrl}/api/backup/download/${log.id}`, { headers: authHeaders })
                                .then((r) => r.blob())
                                .then((blob) => {
                                  const url = URL.createObjectURL(blob);
                                  const a = document.createElement("a");
                                  a.href = url;
                                  a.download = log.file_name;
                                  a.click();
                                  URL.revokeObjectURL(url);
                                });
                            }}
                          >
                            <Download className="h-3 w-3" /> DL
                          </a>
                          <button
                            type="button"
                            onClick={() => void validateBackup(log.id)}
                            className="px-2 py-1 bg-slate-800 hover:bg-slate-700"
                          >
                            Validate
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-4 text-center text-slate-500">
                      No backups yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === "schedule" && (
          <div className="mx-auto max-w-2xl grid gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={scheduleDraft.is_enabled}
                  disabled={!isAdmin}
                  onChange={(e) => setScheduleDraft((d) => ({ ...d, is_enabled: e.target.checked }))}
                />
                Enable scheduled backups
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={scheduleDraft.backup_on_exit}
                  disabled={!isAdmin}
                  onChange={(e) => setScheduleDraft((d) => ({ ...d, backup_on_exit: e.target.checked }))}
                />
                Enable backup on exit
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-slate-400 uppercase font-semibold">Interval (hours)</span>
                <input
                  type="number"
                  min={1}
                  value={scheduleDraft.interval_hours}
                  disabled={!isAdmin}
                  onChange={(e) =>
                    setScheduleDraft((d) => ({ ...d, interval_hours: Number(e.target.value) }))
                  }
                  className="mt-1 w-full h-8 border border-slate-800 bg-slate-950 px-2 text-slate-50"
                />
              </div>
              <div>
                <span className="text-slate-400 uppercase font-semibold">Retention count</span>
                <input
                  type="number"
                  min={1}
                  value={scheduleDraft.max_retained_backups}
                  disabled={!isAdmin}
                  onChange={(e) =>
                    setScheduleDraft((d) => ({ ...d, max_retained_backups: Number(e.target.value) }))
                  }
                  className="mt-1 w-full h-8 border border-slate-800 bg-slate-950 px-2 text-slate-50"
                />
              </div>
            </div>
            <div>
              <span className="text-xs text-slate-400 uppercase font-semibold">Schedule target</span>
              <select
                value={scheduleDraft.target}
                disabled={!isAdmin}
                onChange={(e) =>
                  setScheduleDraft((d) => ({ ...d, target: e.target.value as BackupTarget }))
                }
                className="mt-1 w-full h-8 border border-slate-800 bg-slate-950 px-2 text-slate-50 text-sm"
              >
                <option value="LOCAL">LOCAL</option>
                <option value="USB">USB</option>
                <option value="CLOUD">CLOUD</option>
              </select>
            </div>
            <div>
              <span className="text-xs text-slate-400 uppercase font-semibold">Local directory</span>
              <input
                value={scheduleDraft.local_backup_dir}
                disabled={!isAdmin}
                onChange={(e) => setScheduleDraft((d) => ({ ...d, local_backup_dir: e.target.value }))}
                placeholder={defaultLocalDir}
                className="mt-1 w-full h-8 border border-slate-800 bg-slate-950 px-2 text-slate-50 text-sm"
              />
            </div>
            <div>
              <span className="text-xs text-slate-400 uppercase font-semibold">USB directory</span>
              <input
                value={scheduleDraft.usb_backup_dir}
                disabled={!isAdmin}
                onChange={(e) => setScheduleDraft((d) => ({ ...d, usb_backup_dir: e.target.value }))}
                className="mt-1 w-full h-8 border border-slate-800 bg-slate-950 px-2 text-slate-50 text-sm"
              />
            </div>
            <div>
              <span className="text-xs text-slate-400 uppercase font-semibold">Cloud pre-signed PUT URL</span>
              <input
                value={scheduleDraft.cloud_upload_url}
                disabled={!isAdmin}
                onChange={(e) => setScheduleDraft((d) => ({ ...d, cloud_upload_url: e.target.value }))}
                placeholder="https://storage.googleapis.com/bucket/object?X-Goog-Signature=..."
                className="mt-1 w-full h-8 border border-slate-800 bg-slate-950 px-2 text-slate-50 text-sm"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Compatible with S3, GCS, Azure Blob pre-signed uploads. Google Drive / iCloud require a
                gateway URL that accepts PUT.
              </p>
            </div>
            <div>
              <span className="text-xs text-slate-400 uppercase font-semibold">
                Verification passphrase {schedule?.has_passphrase ? "(configured)" : ""}
              </span>
              <input
                type="password"
                value={scheduleDraft.passphrase}
                disabled={!isAdmin}
                onChange={(e) => setScheduleDraft((d) => ({ ...d, passphrase: e.target.value }))}
                className="mt-1 w-full h-8 border border-slate-800 bg-slate-950 px-2 text-slate-50 text-sm"
                placeholder="SHA-256 hash stored only"
              />
              <label className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={scheduleDraft.clear_passphrase}
                  disabled={!isAdmin}
                  onChange={(e) => setScheduleDraft((d) => ({ ...d, clear_passphrase: e.target.checked }))}
                />
                Clear stored passphrase hash
              </label>
            </div>
            {schedule?.last_run_at && (
              <p className="text-xs text-slate-500">Last scheduled run: {new Date(schedule.last_run_at).toLocaleString()}</p>
            )}
            <button
              type="button"
              disabled={!isAdmin || loading}
              onClick={() => void saveSchedule()}
              className="h-9 bg-emerald-500 text-sm font-semibold uppercase text-slate-50 disabled:opacity-50"
            >
              Save configuration
            </button>
          </div>
        )}

        {activeTab === "recovery" && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 grid gap-3">
              <h3 className="text-xs font-semibold uppercase text-slate-400">Restore from backup</h3>
              <select
                value={selectedLogId ?? ""}
                onChange={(e) => setSelectedLogId(e.target.value ? Number(e.target.value) : null)}
                className="h-8 border border-slate-800 bg-slate-950 px-2 text-sm text-slate-50"
              >
                <option value="">Select backup…</option>
                {logs
                  .filter((l) => l.status === "SUCCESS")
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      #{l.id} {l.file_name}
                    </option>
                  ))}
              </select>
              <input
                type="password"
                value={restorePassphrase}
                onChange={(e) => setRestorePassphrase(e.target.value)}
                placeholder="Passphrase if encrypted"
                className="h-8 border border-slate-800 bg-slate-950 px-2 text-sm text-slate-50"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!isAdmin || !selectedLogId || loading}
                  onClick={() => void testRestore()}
                  className="flex-1 h-8 bg-slate-800 text-xs font-semibold uppercase hover:bg-slate-700 disabled:opacity-50"
                >
                  Dry-run test
                </button>
                <button
                  type="button"
                  disabled={!isAdmin || !selectedLogId || loading}
                  onClick={() => void fullRestore()}
                  className="flex-1 h-8 bg-red-900 text-xs font-semibold uppercase text-red-100 hover:bg-red-800 disabled:opacity-50"
                >
                  Full restore
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 grid gap-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase text-slate-400">Crash recovery</h3>
                <button
                  type="button"
                  onClick={() => void loadCrashRecovery()}
                  className="p-1 text-slate-400 hover:text-slate-50"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
              </div>
              {crashData && (
                <>
                  <div className="flex items-center gap-2 text-sm">
                    {crashData.integrity_check.ok ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <ShieldAlert className="h-4 w-4 text-red-400" />
                    )}
                    <span>Integrity: {crashData.integrity_check.message}</span>
                  </div>
                  <p className="text-xs text-slate-400">
                    WAL: {crashData.wal.wal_exists ? `${crashData.wal.wal_size_bytes} bytes` : "none"}
                  </p>
                  <pre className="max-h-32 overflow-auto rounded border border-slate-800 bg-slate-950 p-2 text-[10px] text-slate-400">
                    {crashData.crash_log.exists
                      ? crashData.crash_log.content || "(empty)"
                      : "No crash log found."}
                  </pre>
                  <button
                    type="button"
                    disabled={!isAdmin}
                    onClick={() => void walCheckpoint()}
                    className="h-8 bg-slate-800 text-xs font-semibold uppercase hover:bg-slate-700 disabled:opacity-50"
                  >
                    Force WAL checkpoint (TRUNCATE)
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
