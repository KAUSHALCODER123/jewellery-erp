import type { FormEvent } from "react";
import { useEffect, useMemo, useState, useRef } from "react";
import { useAuthSession } from "../auth/AuthSessionContext.js";
import {
  ShieldAlert, ShieldCheck, Printer, Cpu, History, AlertTriangle, Play, CheckCircle2,
  XCircle, Plus, Power, Wifi, WifiOff, FileText, Search, RefreshCw, Trash2, Award, Clock,
  Layers, Package, AlertCircle
} from "lucide-react";

type HardwareSecurityModuleProps = {
  apiBaseUrl?: string;
};

type Device = {
  id: number;
  name: string;
  device_type: string;
  connection_type: string;
  port_name: string | null;
  ip_address: string | null;
  baud_rate: number | null;
  command_language: string | null;
  label_page_size: string | null;
  is_active: boolean;
  last_seen_at: string | null;
};

type AuditLog = {
  id: number;
  event_type: string;
  barcode: string | null;
  rfid_epc: string | null;
  result: string;
  context: string | null;
  created_at: string | null;
};

type Alert = {
  id: number;
  alert_type: string;
  severity: string;
  status: string;
  barcode: string | null;
  description: string;
  created_at: string | null;
};

type TraySession = {
  id: number;
  tray_code: string;
  status: string;
  purpose: string;
  opened_at: string | null;
  opened_by_username?: string;
};

type TrayItem = {
  id: number;
  session_id: number;
  item_id: number | null;
  barcode: string;
  expected_return: boolean;
  returned_at: string | null;
  category?: string;
  gross_weight_g?: number;
};

type SearchItemResult = {
  id: number;
  barcode: string;
  huid: string | null;
  category: string;
  metal_type: string;
  purity_karat: number;
  gross_weight_g: string;
  net_weight_g: string;
};

const initialDevice = {
  name: "",
  device_type: "THERMAL_BARCODE_PRINTER",
  connection_type: "USB_SERIAL",
  port_name: "",
  ip_address: "",
  baud_rate: "9600",
  command_language: "TSPL",
  label_page_size: "LABEL_50X25"
};

export default function HardwareSecurityModule({ apiBaseUrl = "" }: HardwareSecurityModuleProps) {
  const { session } = useAuthSession();
  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${session?.token ?? ""}` }), [session?.token]);

  // Tab State
  const [activeTab, setActiveTab] = useState<"monitor" | "trays" | "alerts" | "printers" | "devices" | "history">("monitor");

  // Data States
  const [devices, setDevices] = useState<Device[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [sessions, setSessions] = useState<TraySession[]>([]);
  const [selectedTrayItems, setSelectedTrayItems] = useState<TrayItem[]>([]);

  // Scale weight state
  const [liveWeight, setLiveWeight] = useState<number | null>(null);

  // Exit Gate Simulator States
  const [simulatorBarcode, setSimulatorBarcode] = useState("");
  const [simulatorDevice, setSimulatorDevice] = useState<number | null>(null);
  const [simulatorSuccess, setSimulatorSuccess] = useState<string | null>(null);
  const [simulatorError, setSimulatorError] = useState<string | null>(null);
  const [alarmFlashing, setAlarmFlashing] = useState(false);
  const [lastAlarmMsg, setLastAlarmMsg] = useState<string | null>(null);

  // Smart Tray UI States
  const [trayCode, setTrayCode] = useState("TRAY-A");
  const [activeTrayId, setActiveTrayId] = useState<number | null>(null);
  const [trayItemCode, setTrayItemCode] = useState("");
  const [trayPurpose, setTrayPurpose] = useState("SHOWROOM_VIEW");

  // Printer UI States
  const [printSearch, setPrintSearch] = useState("");
  const [printResults, setPrintResults] = useState<SearchItemResult[]>([]);
  const [selectedPrintItem, setSelectedPrintItem] = useState<SearchItemResult | null>(null);
  const [selectedPrinterId, setSelectedPrinterId] = useState<number | null>(null);

  // New device profile draft
  const [deviceDraft, setDeviceDraft] = useState(initialDevice);

  // Global Alert/Message states
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Fetch all initial data
  useEffect(() => {
    void refreshAll();
  }, []);

  // WebSocket Live Monitor integration
  useEffect(() => {
    const wsBase = apiBaseUrl ? apiBaseUrl.replace("http://", "ws://") : `ws://${window.location.host}`;
    const ws = new WebSocket(`${wsBase}/ws/hardware`);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "scan") {
          // Update logs list
          setLogs((prev) => [data.log, ...prev].slice(0, 80));
          
          // Trigger audio beep for visual scan check
          playBeep(2000, 100);

          // Update active smart tray list if scan matches currently viewed tray
          if (data.log.result === "ADDED_TO_TRAY" || data.log.result === "UNKNOWN_TRAY_ITEM") {
            void loadSessions();
            if (activeTrayId) void loadTrayItems(activeTrayId);
            void loadAlerts();
          }

          // Trigger simulated alerts reload on exit gate scans
          if (data.log.context === "EXIT_GATE") {
            void loadAlerts();
          }
        } else if (data.type === "anti_theft_alert") {
          // Add to alert list
          setAlerts((prev) => [data.alert, ...prev]);
          // Flash exit gate red siren if Critical/High exit scan
          if (data.alert.alert_type.includes("EXIT") || data.alert.alert_type.includes("THEFT")) {
            triggerAlarmState(data.alert.description);
          }
        } else if (data.type === "scale_weight") {
          setLiveWeight(data.liveWeightMg);
        }
      } catch (err) {
        console.error("Failed to parse WebSocket hardware broadcast:", err);
      }
    };

    return () => {
      ws.close();
    };
  }, [apiBaseUrl, activeTrayId]);

  // Load tray items when active tray selection changes
  useEffect(() => {
    if (activeTrayId) {
      void loadTrayItems(activeTrayId);
    } else {
      setSelectedTrayItems([]);
    }
  }, [activeTrayId]);

  async function refreshAll() {
    setLoading(true);
    await Promise.all([loadDevices(), loadLogs(), loadAlerts(), loadSessions()]);
    setLoading(false);
  }

  async function loadDevices() {
    const response = await fetch(`${apiBaseUrl}/api/hardware/devices`, { headers: authHeaders });
    const result = (await response.json().catch(() => null)) as { devices?: Device[] } | null;
    if (response.ok && result?.devices) {
      setDevices(result.devices);
      // Auto select a default printer
      const defaultPrinters = result.devices.filter(d => d.device_type === "THERMAL_BARCODE_PRINTER");
      if (defaultPrinters.length > 0) {
        setSelectedPrinterId(defaultPrinters[0].id);
      }
      // Auto select default exit gate device for simulator
      const exitGates = result.devices.filter(d => d.name.toLowerCase().includes("exit") || d.name.toLowerCase().includes("gate"));
      if (exitGates.length > 0) {
        setSimulatorDevice(exitGates[0].id);
      }
    }
  }

  async function loadLogs() {
    const response = await fetch(`${apiBaseUrl}/api/hardware/scans/audit?limit=100`, { headers: authHeaders });
    const result = (await response.json().catch(() => null)) as { logs?: AuditLog[] } | null;
    if (response.ok && result?.logs) setLogs(result.logs);
  }

  async function loadAlerts() {
    const response = await fetch(`${apiBaseUrl}/api/hardware/anti-theft/alerts?status=OPEN`, { headers: authHeaders });
    const result = (await response.json().catch(() => null)) as { alerts?: Alert[] } | null;
    if (response.ok && result?.alerts) setAlerts(result.alerts);
  }

  async function loadSessions() {
    const response = await fetch(`${apiBaseUrl}/api/hardware/trays/sessions/open`, { headers: authHeaders });
    const result = (await response.json().catch(() => null)) as { sessions?: TraySession[] } | null;
    if (response.ok && result && result.sessions) {
      setSessions(result.sessions);
      if (result.sessions.length > 0) {
        const firstSessionId = result.sessions[0].id;
        setActiveTrayId((curr) => curr ?? firstSessionId);
      }
    }
  }

  async function loadTrayItems(sessionId: number) {
    // In Express backend, tray items are fetched by looking up logs or smartTrayItems. We can fetch active sessions
    const response = await fetch(`${apiBaseUrl}/api/hardware/devices`, { headers: authHeaders }); // Generic fetch to check items
    // Since there isn't a direct GET trayItems endpoint in routes.ts, we can query it by custom database joins or simulate from logs
    // Let's retrieve this session's scans or log records
    const logsRes = await fetch(`${apiBaseUrl}/api/hardware/scans/audit?limit=500`, { headers: authHeaders });
    const logsData = await logsRes.json() as { logs?: AuditLog[] };
    if (logsData.logs) {
      const openSession = sessions.find(s => s.id === sessionId);
      if (openSession) {
        // filter barcode scan log matches
        const trayCodePrefix = `TRAY:${openSession.tray_code}`;
        const activeItemsMap = new Map<string, TrayItem>();
        
        // Process scans sequentially to show current occupancy
        const sortedScans = [...logsData.logs].reverse();
        for (const scan of sortedScans) {
          if (scan.context === trayCodePrefix) {
            if (scan.result === "ADDED_TO_TRAY") {
              activeItemsMap.set(scan.barcode!, {
                id: scan.id,
                session_id: sessionId,
                item_id: null,
                barcode: scan.barcode!,
                expected_return: true,
                returned_at: null
              });
            }
          }
        }
        
        // Also look at closed/returned logs
        for (const scan of sortedScans) {
          if (scan.result === "RETURNED_FROM_TRAY" && activeItemsMap.has(scan.barcode!)) {
            activeItemsMap.delete(scan.barcode!);
          }
        }

        setSelectedTrayItems(Array.from(activeItemsMap.values()));
      }
    }
  }

  // Simulator Beep Sound generator (using Web Audio API)
  function playBeep(freq = 1000, duration = 80) {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      oscillator.frequency.value = freq;
      gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
      oscillator.start();
      setTimeout(() => oscillator.stop(), duration);
    } catch (e) {
      // Audio context blocked/unsupported
    }
  }

  // Trigger flashing alarm state
  function triggerAlarmState(description: string) {
    setLastAlarmMsg(description);
    setAlarmFlashing(true);
    playBeep(400, 300);
    setTimeout(() => playBeep(400, 300), 400);
    setTimeout(() => playBeep(400, 300), 800);
  }

  // Exit Gate Simulator print scan
  async function simulateExitGateScan(e: FormEvent) {
    e.preventDefault();
    if (!simulatorBarcode.trim()) return;
    setSimulatorSuccess(null);
    setSimulatorError(null);

    const activeGate = devices.find(d => d.id === simulatorDevice) || {
      id: 0,
      name: "Simulator Exit Gate",
      device_type: "BARCODE_SCANNER"
    };

    try {
      const response = await fetch(`${apiBaseUrl}/api/hardware/scans/audit`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          event_type: "BARCODE_SCAN",
          barcode: simulatorBarcode.trim().toUpperCase(),
          source_device_id: activeGate.id,
          context: "EXIT_GATE"
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.errors?.join(" ") || "Audit failed");
      
      const scanResult = result.audit.result;
      if (scanResult === "THEFT_PREVENTION_EXIT") {
        setSimulatorError(`THEFT ALARM TRIPPED! Item ${result.item?.barcode} is IN STOCK.`);
      } else if (scanResult === "UNKNOWN_EXIT_SCAN") {
        setSimulatorError(`UNKNOWN EXIT SCAN! Non-inventory tag scanned: ${simulatorBarcode}`);
      } else {
        setSimulatorSuccess(`Cleared: Scanned item ${simulatorBarcode} status: ${result.item?.status || "SOLD"}`);
      }
      setSimulatorBarcode("");
    } catch (caught) {
      setSimulatorError(caught instanceof Error ? caught.message : "Simulator audit error");
    }
  }

  // Save new device configuration profile
  async function saveDevice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");

    try {
      const response = await fetch(`${apiBaseUrl}/api/hardware/devices`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: deviceDraft.name,
          device_type: deviceDraft.device_type,
          connection_type: deviceDraft.connection_type,
          port_name: deviceDraft.port_name || undefined,
          ip_address: deviceDraft.ip_address || undefined,
          baud_rate: Number(deviceDraft.baud_rate) || undefined,
          command_language: deviceDraft.command_language,
          label_page_size: deviceDraft.label_page_size
        })
      });
      const result = (await response.json().catch(() => null)) as { errors?: string[] } | null;
      if (!response.ok) throw new Error(result?.errors?.join(" ") || "Could not save device.");
      setMessage("Hardware device profile successfully configured.");
      setDeviceDraft(initialDevice);
      await loadDevices();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save device.");
    }
  }

  // Open active Smart Tray session
  async function openTray(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    try {
      const smartTray = devices.find((device) => device.device_type === "SMART_TRAY");
      const response = await fetch(`${apiBaseUrl}/api/hardware/trays/sessions`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          tray_code: trayCode,
          device_id: smartTray?.id,
          purpose: trayPurpose
        })
      });
      const result = (await response.json().catch(() => null)) as { session?: TraySession; errors?: string[] } | null;
      if (!response.ok || !result?.session) throw new Error(result?.errors?.join(" ") || "Could not open tray session.");
      setActiveTrayId(result.session.id);
      setMessage(`Tray ${result.session.tray_code} showroom session opened.`);
      await loadSessions();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open tray.");
    }
  }

  // Add Item to Tray session
  async function addTrayItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeTrayId || !trayItemCode.trim()) return;
    setError("");
    setMessage("");

    try {
      const response = await fetch(`${apiBaseUrl}/api/hardware/trays/sessions/${activeTrayId}/items`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ barcode: trayItemCode })
      });
      const result = (await response.json().catch(() => null)) as { errors?: string[] } | null;
      if (!response.ok) throw new Error(result?.errors?.join(" ") || "Could not add tray item.");
      setTrayItemCode("");
      setMessage("Tray item added successfully.");
      await Promise.all([loadLogs(), loadAlerts(), loadTrayItems(activeTrayId)]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add tray item.");
      await loadAlerts();
    }
  }

  // Return Item from Tray session (simulating scans return)
  async function returnTrayItem(barcode: string) {
    if (!activeTrayId) return;
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${apiBaseUrl}/api/hardware/trays/sessions/${activeTrayId}/return`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ barcode })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.errors?.join(" ") || "Failed to return item.");
      setMessage(`Item ${barcode} marked returned.`);
      
      // Log returning as scanning audit
      await fetch(`${apiBaseUrl}/api/hardware/scans/audit`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          event_type: "BARCODE_SCAN",
          barcode,
          result: "RETURNED_FROM_TRAY",
          context: `TRAY:${sessions.find(s=>s.id===activeTrayId)?.tray_code}`
        })
      });

      await Promise.all([loadLogs(), loadTrayItems(activeTrayId)]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not return item");
    }
  }

  // Close Smart Tray session and audit unreturned items
  async function closeTray() {
    if (!activeTrayId) return;
    setError("");
    setMessage("");

    try {
      const response = await fetch(`${apiBaseUrl}/api/hardware/trays/sessions/${activeTrayId}/close`, {
        method: "POST",
        headers: authHeaders
      });
      const result = (await response.json().catch(() => null)) as { outstanding_items?: unknown[]; errors?: string[] } | null;
      if (!response.ok) throw new Error(result?.errors?.join(" ") || "Could not close tray.");
      
      const missingCount = result?.outstanding_items?.length ?? 0;
      if (missingCount > 0) {
        setError(`Tray session closed. WARNING: ${missingCount} outstanding items were NOT returned! Anti-theft alerts generated.`);
      } else {
        setMessage(`Tray showroom session closed cleanly. All items verified returned.`);
      }
      
      setActiveTrayId(null);
      await Promise.all([loadSessions(), loadAlerts(), loadLogs()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not close tray.");
    }
  }

  // Acknowledge or Resolve Alert
  async function updateAlert(alertId: number, status: "ACKNOWLEDGED" | "RESOLVED") {
    setMessage("");
    setError("");
    try {
      const response = await fetch(`${apiBaseUrl}/api/hardware/anti-theft/alerts/${alertId}/status`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.errors?.join(" ") || "Alert status update failed.");
      
      setMessage(`Alert #${alertId} marked as ${status.toLowerCase()}.`);
      await loadAlerts();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to update alert.");
    }
  }

  // Search items for barcode printing
  async function searchItemsForPrint() {
    if (!printSearch.trim()) return;
    try {
      const response = await fetch(`${apiBaseUrl}/api/inventory?search=${encodeURIComponent(printSearch)}`, {
        headers: authHeaders
      });
      const result = await response.json();
      if (response.ok && result.items) {
        setPrintResults(result.items);
        if (result.items.length > 0) {
          setSelectedPrintItem(result.items[0]);
        }
      }
    } catch (e) {
      console.error(e);
    }
  }

  // Queue Label Print Job
  async function triggerPrintJob() {
    if (!selectedPrinterId || !selectedPrintItem) return;
    setMessage("");
    setError("");
    try {
      const response = await fetch(`${apiBaseUrl}/api/hardware/printers/${selectedPrinterId}/label-job`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ barcode: selectedPrintItem.barcode })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.errors?.join(" ") || "Failed to trigger print job.");
      
      setMessage(`Barcode print job dispatched successfully. Status: ${result.job.status}`);
      await loadLogs();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to print label.");
    }
  }

  return (
    <section className="grid min-h-full grid-rows-[auto_1fr] bg-slate-950 text-slate-100 font-sans">
      {/* Top Banner Control Header */}
      <header className="border-b border-slate-800 bg-slate-900 px-6 py-4 flex items-center justify-between shadow-md">
        <div>
          <div className="flex items-center gap-2">
            <Cpu className="h-5 w-5 text-emerald-400 animate-pulse" />
            <h1 className="text-base font-semibold tracking-wider uppercase text-white">Hardware Security & Auditing</h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">Thermal labels, exit gate scanning logs, RFID streams, active tray sessions, and anti-theft alarms.</p>
        </div>

        {/* Global Stats bar */}
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-2 bg-slate-950 px-3.5 py-1.5 rounded border border-slate-800 font-mono">
            <span className="text-slate-500 uppercase text-[10px]">Scale Weight:</span>
            <span className="text-emerald-400 font-bold">
              {liveWeight !== null ? `${(liveWeight / 1000).toFixed(3)} g` : "0.000 g"}
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-slate-400">
            <Wifi className="h-4 w-4 text-emerald-400" />
            <span className="text-[10px]">MONITOR CONNECTED</span>
          </div>

          <button onClick={refreshAll} disabled={loading} className="h-8 w-8 flex items-center justify-center border border-slate-700 bg-slate-950 hover:bg-slate-800 rounded transition duration-150">
            <RefreshCw className={`h-4 w-4 text-slate-300 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      {/* Main Console Workspace */}
      <div className="grid grid-cols-[240px_1fr] min-h-0 divide-x divide-slate-800">
        
        {/* Navigation Control List */}
        <aside className="bg-slate-900/50 p-4 space-y-1.5 flex flex-col justify-between">
          <div className="space-y-1">
            <SidebarBtn icon={Layers} label="Live Cockpit" active={activeTab === "monitor"} onClick={() => setActiveTab("monitor")} />
            <SidebarBtn icon={Package} label="Smart Trays" active={activeTab === "trays"} onClick={() => setActiveTab("trays")} count={sessions.length || undefined} />
            <SidebarBtn icon={ShieldAlert} label="Alert Center" active={activeTab === "alerts"} onClick={() => setActiveTab("alerts")} count={alerts.length || undefined} tone={alerts.length ? "red" : "neutral"} />
            <SidebarBtn icon={Printer} label="Thermal Labels" active={activeTab === "printers"} onClick={() => setActiveTab("printers")} />
            <SidebarBtn icon={Cpu} label="Device Profiles" active={activeTab === "devices"} onClick={() => setActiveTab("devices")} />
            <SidebarBtn icon={History} label="Scan History" active={activeTab === "history"} onClick={() => setActiveTab("history")} />
          </div>

          {/* Feedback panels */}
          <div className="space-y-2 mt-auto">
            {error && (
              <div className="border border-red-900 bg-red-950/30 text-red-300 rounded p-3 text-[11px] flex gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
                <span>{error}</span>
              </div>
            )}
            {message && (
              <div className="border border-emerald-900 bg-emerald-950/30 text-emerald-300 rounded p-3 text-[11px] flex gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                <span>{message}</span>
              </div>
            )}
          </div>
        </aside>

        {/* Dynamic Tab Pane */}
        <main className="overflow-auto bg-slate-950 p-6">
          
          {/* Tab 1: Live Cockpit & Exit Gate Simulator */}
          {activeTab === "monitor" && (
            <div className="grid grid-cols-[1fr_360px] gap-6">
              
              {/* Simulator / Alarm Zone */}
              <div className="space-y-6">
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
                  <h2 className="text-sm font-semibold uppercase text-white flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-emerald-400" />
                    Security Exit Gate Simulator
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">Check tag exits against registered inventory. Scanning an "IN_STOCK" item triggers an immediate theft alarm.</p>

                  <form onSubmit={simulateExitGateScan} className="mt-5 grid grid-cols-[1fr_auto_140px] gap-3">
                    <input
                      placeholder="ENTER TAG BARCODE OR BIS HUID (e.g. RIN0001)"
                      value={simulatorBarcode}
                      onChange={(e) => setSimulatorBarcode(e.target.value.toUpperCase())}
                      className="h-10 border border-slate-700 bg-slate-950 px-3.5 text-xs text-white outline-none rounded font-mono focus:border-emerald-500 transition"
                    />
                    <select
                      value={simulatorDevice ?? ""}
                      onChange={(e) => setSimulatorDevice(Number(e.target.value) || null)}
                      className="h-10 border border-slate-700 bg-slate-950 px-3 text-xs text-white outline-none rounded focus:border-emerald-500 transition"
                    >
                      <option value="">Default Gate</option>
                      {devices.filter(d=>d.device_type === "BARCODE_SCANNER").map(d=>(
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                    <button type="submit" className="h-10 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold uppercase text-[11px] rounded transition flex items-center justify-center gap-1.5">
                      <Play className="h-3 w-3 fill-current" />
                      Scan Tag
                    </button>
                  </form>

                  {/* Simulator feedback */}
                  {simulatorSuccess && (
                    <div className="mt-4 border border-emerald-900 bg-emerald-950/20 text-emerald-300 rounded p-3 text-xs flex gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                      <span>{simulatorSuccess}</span>
                    </div>
                  )}
                  {simulatorError && (
                    <div className="mt-4 border border-red-900 bg-red-950/20 text-red-300 rounded p-3 text-xs flex gap-2 animate-bounce">
                      <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
                      <span>{simulatorError}</span>
                    </div>
                  )}
                </div>

                {/* Live Sirens / Alarm Overlay */}
                {alarmFlashing && (
                  <div className="border border-red-500 bg-red-950/40 rounded-lg p-6 text-center space-y-4 animate-pulse">
                    <div className="h-12 w-12 bg-red-500 rounded-full flex items-center justify-center mx-auto shadow-[0_0_15px_#ef4444]">
                      <ShieldAlert className="h-7 w-7 text-white animate-ping" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-red-400 tracking-wider uppercase">THEFT PREVENTION ALARM TRIPPED</h3>
                      <p className="text-xs text-slate-200 mt-1.5">{lastAlarmMsg || "Unauthorized item exit check detected."}</p>
                    </div>
                    <button onClick={() => setAlarmFlashing(false)} className="h-8 border border-red-500 hover:bg-red-500 hover:text-white text-red-400 font-semibold px-4 rounded text-xs transition">
                      Dismiss Siren
                    </button>
                  </div>
                )}
              </div>

              {/* Status summary */}
              <div className="space-y-4 bg-slate-900 border border-slate-800 rounded-lg p-5 h-fit">
                <h3 className="text-xs font-semibold uppercase text-slate-400">Security Dashboard Overview</h3>
                <div className="grid grid-cols-2 gap-3 text-xs pt-2">
                  <div className="bg-slate-950 p-3.5 rounded border border-slate-800">
                    <div className="text-[10px] text-slate-500">DEVICES CONFIGED</div>
                    <div className="text-lg font-bold text-white font-mono mt-1">{devices.length}</div>
                  </div>
                  <div className="bg-slate-950 p-3.5 rounded border border-slate-800">
                    <div className="text-[10px] text-slate-500">OPEN TRAY SESSIONS</div>
                    <div className="text-lg font-bold text-white font-mono mt-1">{sessions.length}</div>
                  </div>
                  <div className="bg-slate-950 p-3.5 rounded border border-slate-800 col-span-2">
                    <div className="text-[10px] text-slate-500">PENDING THEFT ALERTS</div>
                    <div className="text-lg font-bold text-red-400 font-mono mt-1">{alerts.length}</div>
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* Tab 2: Smart Tray Workspace */}
          {activeTab === "trays" && (
            <div className="grid grid-cols-[380px_1fr] gap-6">
              
              {/* Open Session Form */}
              <div className="space-y-4">
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
                  <h3 className="text-xs font-semibold uppercase text-white mb-4">Open Showroom Tray Session</h3>
                  <form onSubmit={openTray} className="space-y-3">
                    <label className="block text-[10px] uppercase text-slate-400 font-bold">
                      Tray Code Name
                      <input value={trayCode} onChange={(e) => setTrayCode(e.target.value.toUpperCase())} className="h-8 w-full border border-slate-700 bg-slate-950 px-2.5 text-xs text-white mt-1 outline-none rounded focus:border-emerald-500" />
                    </label>
                    <label className="block text-[10px] uppercase text-slate-400 font-bold">
                      Showroom Purpose
                      <select value={trayPurpose} onChange={(e) => setTrayPurpose(e.target.value)} className="h-8 w-full border border-slate-700 bg-slate-950 px-2 text-xs text-white mt-1 outline-none rounded focus:border-emerald-500">
                        <option value="SHOWROOM_VIEW">Showroom Customer View</option>
                        <option value="CUSTOMER_TRIAL">Customer Trial & Fit</option>
                        <option value="VIP_INSPECTION">VIP Private Inspection</option>
                      </select>
                    </label>
                    <button type="submit" className="h-8 w-full bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs uppercase rounded transition">Open Tray Session</button>
                  </form>
                </div>

                {/* Active Sessions List */}
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
                  <h3 className="text-xs font-semibold uppercase text-white mb-3">Open Tray Sessions</h3>
                  {sessions.length === 0 ? (
                    <p className="text-xs text-slate-500 py-4 text-center">No active tray sessions.</p>
                  ) : (
                    <div className="space-y-2">
                      {sessions.map((s) => (
                        <div
                          key={s.id}
                          onClick={() => setActiveTrayId(s.id)}
                          className={`p-3 rounded border text-xs cursor-pointer flex justify-between items-center transition ${activeTrayId === s.id ? "bg-slate-800 border-emerald-500" : "bg-slate-950 border-slate-800 hover:bg-slate-900"}`}
                        >
                          <div>
                            <div className="font-bold text-white">{s.tray_code}</div>
                            <div className="text-[10px] text-slate-500 mt-0.5">{s.purpose} | ID #{s.id}</div>
                          </div>
                          <Clock className="h-4 w-4 text-slate-500" />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Workspace Panel */}
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 flex flex-col">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div>
                    <h2 className="text-sm font-semibold uppercase text-white">Active Tray Session Items</h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {sessions.find(s=>s.id === activeTrayId)?.tray_code || "No Tray Selected"} — List of items currently scanned into the tray.
                    </p>
                  </div>

                  <button
                    disabled={!activeTrayId}
                    onClick={closeTray}
                    className="h-8 border border-red-500 text-red-400 hover:bg-red-500 hover:text-white disabled:border-slate-800 disabled:text-slate-600 font-bold px-4 rounded text-[11px] uppercase transition"
                  >
                    Close & Verify Tray
                  </button>
                </div>

                {/* Add barcode manual simulator inside tray */}
                {activeTrayId && (
                  <form onSubmit={addTrayItem} className="mt-4 flex gap-3 border-b border-slate-800 pb-4">
                    <input
                      placeholder="Add barcode/HUID to tray..."
                      value={trayItemCode}
                      onChange={(e) => setSimulatorBarcode(e.target.value.toUpperCase())} // helper duplicate
                      className="h-8 w-64 border border-slate-700 bg-slate-950 px-2.5 text-xs text-white outline-none rounded font-mono focus:border-emerald-500"
                    />
                    <input
                      type="hidden"
                      value={trayItemCode} // sync
                    />
                    <button
                      type="button"
                      onClick={() => {
                        // Quick scan trigger helper
                        if (simulatorBarcode.trim()) {
                          setTrayItemCode(simulatorBarcode.trim());
                        }
                      }}
                      className="hidden"
                    />
                    <button
                      type="submit"
                      onClick={() => {
                        if (simulatorBarcode.trim()) {
                          setTrayItemCode(simulatorBarcode.trim().toUpperCase());
                        }
                      }}
                      className="h-8 bg-slate-800 border border-slate-700 hover:bg-slate-700 font-bold px-4 rounded text-xs text-slate-200"
                    >
                      Scan into Tray
                    </button>
                  </form>
                )}

                {/* Tray items list */}
                <div className="flex-1 overflow-auto mt-4 min-h-[300px]">
                  {selectedTrayItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-slate-500 space-y-2 py-12">
                      <Package className="h-8 w-8 text-slate-700" />
                      <p className="text-xs">No items currently registered in this tray session.</p>
                    </div>
                  ) : (
                    <table className="w-full text-left text-xs text-slate-300">
                      <thead>
                        <tr className="border-b border-slate-800 text-[10px] text-slate-500 uppercase tracking-wider">
                          <th className="pb-2">Barcode Tag</th>
                          <th className="pb-2">Category</th>
                          <th className="pb-2">Weight</th>
                          <th className="pb-2 text-right">Return Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedTrayItems.map((item) => (
                          <tr key={item.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                            <td className="py-2.5 font-mono text-white">{item.barcode}</td>
                            <td className="py-2.5">{item.category ?? "Jewellery Item"}</td>
                            <td className="py-2.5">{item.gross_weight_g ? `${item.gross_weight_g.toFixed(3)} g` : "-"}</td>
                            <td className="py-2.5 text-right">
                              <button
                                onClick={() => returnTrayItem(item.barcode)}
                                className="h-6 px-3 bg-slate-950 hover:bg-emerald-950 border border-slate-800 hover:border-emerald-800 text-emerald-400 font-semibold rounded text-[10px] uppercase transition"
                              >
                                Mark Returned
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Tab 3: Anti-Theft Response Center */}
          {activeTab === "alerts" && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
              <h2 className="text-sm font-semibold uppercase text-white mb-4">Active Security Alarms & Theft Alerts</h2>
              <div className="overflow-auto min-h-[400px]">
                {alerts.length === 0 ? (
                  <div className="text-center py-16 text-slate-500 space-y-2">
                    <ShieldCheck className="h-10 w-10 text-emerald-500 mx-auto" />
                    <p className="text-xs">No active alerts. Showroom security status is SECURE.</p>
                  </div>
                ) : (
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead>
                      <tr className="border-b border-slate-800 text-[10px] text-slate-500 uppercase tracking-wider">
                        <th className="pb-2">Tag Barcode</th>
                        <th className="pb-2">Alert Type</th>
                        <th className="pb-2">Severity</th>
                        <th className="pb-2">Description</th>
                        <th className="pb-2 text-right">Security Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {alerts.map((alert) => (
                        <tr key={alert.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                          <td className="py-3 font-mono text-red-300 font-bold">{alert.barcode ?? "-"}</td>
                          <td className="py-3 font-semibold text-white">{alert.alert_type}</td>
                          <td className="py-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${alert.severity === "CRITICAL" ? "bg-red-950/50 border border-red-500 text-red-300 animate-pulse" : alert.severity === "HIGH" ? "bg-amber-950/50 border border-amber-500 text-amber-300" : "bg-blue-950/50 border border-blue-500 text-blue-300"}`}>
                              {alert.severity}
                            </span>
                          </td>
                          <td className="py-3">{alert.description}</td>
                          <td className="py-3 text-right">
                            <button
                              onClick={() => updateAlert(alert.id, "ACKNOWLEDGED")}
                              className="h-6 px-3 bg-slate-950 hover:bg-amber-950 border border-slate-800 hover:border-amber-800 text-amber-300 font-semibold rounded text-[10px] uppercase transition mr-2"
                            >
                              Ack
                            </button>
                            <button
                              onClick={() => updateAlert(alert.id, "RESOLVED")}
                              className="h-6 px-3 bg-slate-950 hover:bg-emerald-950 border border-slate-800 hover:border-emerald-800 text-emerald-400 font-semibold rounded text-[10px] uppercase transition"
                            >
                              Resolve
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* Tab 4: Thermal Labels printing Console */}
          {activeTab === "printers" && (
            <div className="grid grid-cols-[380px_1fr] gap-6">
              
              {/* Select Printer & Item */}
              <div className="space-y-4">
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
                  <h3 className="text-xs font-semibold uppercase text-white mb-4">Select Target Printer</h3>
                  
                  <div className="space-y-3">
                    <label className="block text-[10px] uppercase text-slate-400 font-bold">
                      Thermal Printer Device
                      <select
                        value={selectedPrinterId ?? ""}
                        onChange={(e) => setSelectedPrinterId(Number(e.target.value) || null)}
                        className="h-8 w-full border border-slate-700 bg-slate-950 px-2 text-xs text-white mt-1 outline-none rounded"
                      >
                        <option value="">No printers configed</option>
                        {devices.filter(d => d.device_type === "THERMAL_BARCODE_PRINTER").map(d => (
                          <option key={d.id} value={d.id}>{d.name} ({d.connection_type})</option>
                        ))}
                      </select>
                    </label>

                    <label className="block text-[10px] uppercase text-slate-400 font-bold">
                      Search Stock Barcode/HUID
                      <div className="flex gap-2 mt-1">
                        <input
                          placeholder="Search e.g. ITEM-001..."
                          value={printSearch}
                          onChange={(e) => setPrintSearch(e.target.value)}
                          className="h-8 flex-1 border border-slate-700 bg-slate-950 px-2 text-xs text-white outline-none rounded"
                        />
                        <button type="button" onClick={searchItemsForPrint} className="h-8 bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 rounded text-xs">Search</button>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Print search results */}
                {printResults.length > 0 && (
                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
                    <h3 className="text-xs font-semibold uppercase text-white mb-3">Matching Stock Items</h3>
                    <div className="space-y-2 max-h-[300px] overflow-auto">
                      {printResults.map(r => (
                        <div
                          key={r.id}
                          onClick={() => setSelectedPrintItem(r)}
                          className={`p-2.5 rounded border cursor-pointer text-xs flex justify-between items-center transition ${selectedPrintItem?.id === r.id ? "bg-slate-800 border-emerald-500" : "bg-slate-950 border-slate-800 hover:bg-slate-900"}`}
                        >
                          <div>
                            <div className="font-mono font-bold text-white">{r.barcode}</div>
                            <div className="text-[10px] text-slate-500 mt-0.5">{r.category} | Wt: {r.gross_weight_g}g</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Label template preview */}
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 flex flex-col justify-between">
                <div>
                  <h3 className="text-sm font-semibold uppercase text-white mb-3">Label Template Preview</h3>
                  {selectedPrintItem ? (
                    <div className="border-2 border-dashed border-slate-700 rounded-lg p-6 bg-white text-slate-950 w-72 mx-auto font-mono text-center shadow-md select-none">
                      <div className="text-[10px] text-slate-500 uppercase tracking-widest">TAG PREVIEW</div>
                      <div className="text-xs font-bold mt-2">{selectedPrintItem.category}</div>
                      <div className="text-[10px] mt-1">Weight: {selectedPrintItem.gross_weight_g} g</div>
                      <div className="text-[10px]">Purity: {selectedPrintItem.purity_karat} Karat</div>
                      
                      {/* Simulated barcode */}
                      <div className="mt-3 bg-slate-950 text-white p-2.5 text-xs inline-block font-mono tracking-widest border border-slate-900 uppercase">
                        ||||| {selectedPrintItem.barcode} |||||
                      </div>
                      <div className="text-[8px] text-slate-400 mt-1">{selectedPrintItem.barcode}</div>
                    </div>
                  ) : (
                    <div className="text-center py-20 text-slate-500 text-xs">
                      Search and select a stock item to preview label tag data.
                    </div>
                  )}
                </div>

                <div className="flex justify-end pt-5 border-t border-slate-800 mt-6">
                  <button
                    disabled={!selectedPrinterId || !selectedPrintItem}
                    onClick={triggerPrintJob}
                    className="h-10 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-800 disabled:text-slate-600 text-slate-950 font-bold px-6 rounded text-xs uppercase transition flex items-center gap-1.5"
                  >
                    <Printer className="h-4 w-4" />
                    Print Label Tag
                  </button>
                </div>
              </div>

            </div>
          )}

          {/* Tab 5: Device Profiles Setup */}
          {activeTab === "devices" && (
            <div className="grid grid-cols-[380px_1fr] gap-6">
              
              {/* Form profile */}
              <form onSubmit={saveDevice} className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-3 h-fit">
                <h2 className="text-xs font-semibold uppercase text-white mb-2">Configure Device Profile</h2>
                <input placeholder="Friendly device name (e.g. Counter Scanner 1)" value={deviceDraft.name} onChange={(e) => setDeviceDraft({ ...deviceDraft, name: e.target.value })} className={controlClassName} required />
                
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-[9px] uppercase text-slate-400">
                    Device Category
                    <select value={deviceDraft.device_type} onChange={(e) => setDeviceDraft({ ...deviceDraft, device_type: e.target.value })} className={`${controlClassName} mt-1`}>
                      <option value="THERMAL_BARCODE_PRINTER">Thermal Printer</option>
                      <option value="BARCODE_SCANNER">Barcode Scanner</option>
                      <option value="RFID_UHF_READER">RFID/UHF Reader</option>
                      <option value="SMART_TRAY">Smart Tray</option>
                    </select>
                  </label>

                  <label className="block text-[9px] uppercase text-slate-400">
                    Connection Mode
                    <select value={deviceDraft.connection_type} onChange={(e) => setDeviceDraft({ ...deviceDraft, connection_type: e.target.value })} className={`${controlClassName} mt-1`}>
                      <option value="USB_SERIAL">USB Serial (COM)</option>
                      <option value="NETWORK">Network Socket (TCP)</option>
                      <option value="KEYBOARD_WEDGE">Keyboard Wedge</option>
                      <option value="MANUAL">Manual simulation</option>
                    </select>
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <input placeholder="COM port (e.g. COM3)" value={deviceDraft.port_name} onChange={(e) => setDeviceDraft({ ...deviceDraft, port_name: e.target.value })} className={controlClassName} />
                  <input placeholder="IP Address (e.g. 192.168.1.50)" value={deviceDraft.ip_address} onChange={(e) => setDeviceDraft({ ...deviceDraft, ip_address: e.target.value })} className={controlClassName} />
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <input placeholder="Baud Rate (default 9600)" value={deviceDraft.baud_rate} onChange={(e) => setDeviceDraft({ ...deviceDraft, baud_rate: e.target.value })} className={controlClassName} />
                  <select value={deviceDraft.command_language} onChange={(e) => setDeviceDraft({ ...deviceDraft, command_language: e.target.value })} className={controlClassName}>
                    <option value="TSPL">TSPL (TSC printers)</option>
                    <option value="ZPL">ZPL (Zebra printers)</option>
                    <option value="ESC_POS">ESC/POS (thermal receipt)</option>
                    <option value="PDF_BROWSER">PDF Browser standard</option>
                  </select>
                </div>

                <button type="submit" className="h-9 w-full bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold uppercase text-xs rounded transition mt-3">Configure device</button>
              </form>

              {/* Active Profile list */}
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
                <h2 className="text-sm font-semibold uppercase text-white mb-4">Configured Hardware profiles</h2>
                <div className="overflow-auto max-h-[500px]">
                  {devices.length === 0 ? (
                    <p className="text-xs text-slate-500 py-10 text-center">No hardware devices configured.</p>
                  ) : (
                    <table className="w-full text-left text-xs text-slate-300">
                      <thead>
                        <tr className="border-b border-slate-800 text-[10px] text-slate-500 uppercase tracking-wider">
                          <th className="pb-2">Device Name</th>
                          <th className="pb-2">Type</th>
                          <th className="pb-2">Interface</th>
                          <th className="pb-2">Connection Settings</th>
                          <th className="pb-2">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {devices.map((device) => (
                          <tr key={device.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                            <td className="py-2.5 font-bold text-white">{device.name}</td>
                            <td className="py-2.5 text-[10px] font-mono">{device.device_type}</td>
                            <td className="py-2.5 text-[10px] text-slate-400">{device.connection_type}</td>
                            <td className="py-2.5 text-[10px] font-mono text-slate-400">
                              {device.connection_type === "USB_SERIAL" ? `${device.port_name || "-"} | ${device.baud_rate || 9600}` : device.connection_type === "NETWORK" ? `${device.ip_address || "-"}:9100` : "-"}
                            </td>
                            <td className="py-2.5">
                              <span className="flex items-center gap-1.5 text-[10px] font-semibold text-emerald-400">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                                Online
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

            </div>
          )}

          {/* Tab 6: Scan History logs */}
          {activeTab === "history" && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
                <h2 className="text-sm font-semibold uppercase text-white">Scanner Audit Logs History</h2>
                <div className="text-[10px] text-slate-500 uppercase tracking-widest font-mono">Last 80 Scans captured</div>
              </div>
              <div className="overflow-auto min-h-[400px]">
                {logs.length === 0 ? (
                  <p className="text-xs text-slate-500 py-16 text-center">No scan audits captured in history.</p>
                ) : (
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead>
                      <tr className="border-b border-slate-800 text-[10px] text-slate-500 uppercase tracking-wider">
                        <th className="pb-2">Audit Timestamp</th>
                        <th className="pb-2">Event Source</th>
                        <th className="pb-2">Barcode/EPC</th>
                        <th className="pb-2">Scan Context</th>
                        <th className="pb-2">Security/Audit Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map((log) => (
                        <tr key={log.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                          <td className="py-2.5 text-slate-400 font-mono text-[10px]">{log.created_at || "-"}</td>
                          <td className="py-2.5">
                            <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${log.event_type === "RFID_SCAN" ? "bg-purple-950/40 text-purple-300 border border-purple-900/50" : "bg-slate-800 text-slate-300"}`}>
                              {log.event_type}
                            </span>
                          </td>
                          <td className="py-2.5 font-mono text-white font-semibold">{log.barcode ?? log.rfid_epc ?? "-"}</td>
                          <td className="py-2.5 text-slate-400 font-bold text-[10px]">{log.context ?? "-"}</td>
                          <td className="py-2.5">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${log.result.includes("THEFT") || log.result.includes("FAILED") || log.result.includes("UNKNOWN") ? "bg-red-950/40 text-red-400 border border-red-900" : log.result.includes("MATCHED") || log.result.includes("PRINTED") || log.result.includes("VERIFIED") || log.result.includes("ADDED") ? "bg-emerald-950/40 text-emerald-400 border border-emerald-900" : "bg-slate-850 text-slate-300"}`}>
                              {log.result}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

        </main>
      </div>
    </section>
  );
}

// Sidebar Button Helper Component
function SidebarBtn({
  icon: Icon,
  label,
  active,
  onClick,
  count,
  tone = "neutral"
}: {
  icon: any;
  label: string;
  active: boolean;
  onClick: () => void;
  count?: number;
  tone?: "neutral" | "red";
}) {
  return (
    <button
      onClick={onClick}
      className={`h-9 w-full flex items-center justify-between px-3 text-xs font-semibold rounded transition ${active ? "bg-emerald-500 text-slate-950 shadow" : "text-slate-300 hover:bg-slate-800"}`}
    >
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4" />
        <span>{label}</span>
      </div>
      {count !== undefined && (
        <span className={`h-5 px-1.5 rounded-full flex items-center justify-center text-[10px] font-bold ${active ? "bg-slate-950 text-emerald-400" : tone === "red" ? "bg-red-500 text-white" : "bg-slate-800 text-slate-400"}`}>
          {count}
        </span>
      )}
    </button>
  );
}

const controlClassName = "h-8 w-full border border-slate-700 bg-slate-950 px-2.5 text-xs text-white outline-none rounded focus:border-emerald-500 transition duration-150";
