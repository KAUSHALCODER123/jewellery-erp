import { isTauri } from "@tauri-apps/api/core";
import { HashRouter, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { AuthProvider, useAuth } from "./context/AuthContext.js";
import AccountsDayBookModule from "./components/AccountsDayBookModule.js";
import AuthGateway from "./components/AuthGateway.js";
import BarcodeStockDesk from "./components/BarcodeStockDesk.js";
import CRMDashboard from "./components/CRMDashboard.js";
import GirviMoneylendingModule from "./components/GirviMoneylendingModule.js";
import GoldSavingSchemeModule from "./components/GoldSavingSchemeModule.js";
import InventoryRatesDashboard from "./components/InventoryRatesDashboard.js";
import ItemMasterInventory from "./components/ItemMasterInventory.js";
import KarigarManufacturingModule from "./components/KarigarManufacturingModule.js";
import RefineryManagementModule from "./components/RefineryManagementModule.js";
import MainLayout from "./components/layout/MainLayout.js";
import POSBillingScreen from "./components/POSBillingScreen.js";
import { POSCreditProvider } from "./pos/POSCreditContext.js";
import MISDashboard from "./components/MISDashboard.js";
import StandaloneUrdVoucher from "./components/StandaloneUrdVoucher.js";
import GSTReportsModule from "./components/GSTReportsModule.js";
import MessengerModule from "./components/MessengerModule.js";
import ReportBuilderModule from "./components/ReportBuilderModule.js";
import PrintTemplateBuilder from "./components/PrintTemplateBuilder.js";
import HardwareSecurityModule from "./components/HardwareSecurityModule.js";
import BackupRecoveryModule from "./components/BackupRecoveryModule.js";
import RepairDeskModule from "./components/RepairDeskModule.js";
import DayBookSummary from "./components/DayBookSummary.js";
import GssSchemeBuilder from "./components/GssSchemeBuilder.js";

const runningInTauri = isTauri();
const apiBaseUrl = runningInTauri ? "http://127.0.0.1:4000" : "";

export default function App() {
  useEffect(() => {
    if (runningInTauri) {
      let unlisten: (() => void) | null = null;
      import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
        getCurrentWindow().onCloseRequested(async (event) => {
          event.preventDefault();
          try {
            await fetch(`${apiBaseUrl}/api/backup/on-exit`, { method: "POST" });
          } catch (err) {
            console.error("Backup on exit failed:", err);
          } finally {
            await getCurrentWindow().destroy();
          }
        }).then((unlistenFn) => {
          unlisten = unlistenFn;
        });
      });

      return () => {
        if (unlisten) unlisten();
      };
    }
  }, []);

  return (
    <AuthProvider apiBaseUrl={apiBaseUrl}>
      <POSCreditProvider>
        <HashRouter>
          <AppRoutes />
        </HashRouter>
      </POSCreditProvider>
    </AuthProvider>
  );
}

function AppRoutes() {
  const { session } = useAuth();
  const role = session?.user?.role;
  const isExecutive = role === "ADMIN" || role === "MANAGER";

  return (
    <Routes>
      <Route path="/login" element={<AuthGateway apiBaseUrl={apiBaseUrl} dashboardPath="#/dashboard" />} />
      <Route path="/setup" element={<AuthGateway apiBaseUrl={apiBaseUrl} dashboardPath="#/dashboard" />} />
      <Route path="/" element={<ProtectedRoute><MainLayout apiBaseUrl={apiBaseUrl} /></ProtectedRoute>}>
        <Route index element={<Navigate to={isExecutive ? "/mis-dashboard" : "/dashboard"} replace />} />
        <Route path="mis-dashboard" element={<MISDashboard apiBaseUrl={apiBaseUrl} />} />
        <Route path="dashboard" element={<InventoryRatesDashboard apiBaseUrl={apiBaseUrl} />} />
        <Route path="pos" element={<POSBillingScreen apiBaseUrl={apiBaseUrl} />} />
        <Route path="urd-voucher" element={<StandaloneUrdVoucher apiBaseUrl={apiBaseUrl} />} />
        <Route path="barcode" element={<BarcodeStockDesk apiBaseUrl={apiBaseUrl} />} />
        <Route path="hardware-security" element={<HardwareSecurityModule apiBaseUrl={apiBaseUrl} />} />
        <Route path="inventory" element={<InventoryWorkspace />} />
        <Route path="karigar" element={<KarigarManufacturingModule apiBaseUrl={apiBaseUrl} />} />
        <Route path="repairs" element={<RepairDeskModule apiBaseUrl={apiBaseUrl} />} />
        <Route path="girvi" element={<GirviMoneylendingModule apiBaseUrl={apiBaseUrl} />} />
        <Route path="gold-scheme" element={<GoldSchemeRoute />} />
        <Route path="gss-schemes" element={<GssSchemeBuilder apiBaseUrl={apiBaseUrl} />} />
        <Route path="daybook" element={<DayBookSummary apiBaseUrl={apiBaseUrl} />} />
        <Route path="crm" element={<CRMDashboard apiBaseUrl={apiBaseUrl} />} />
        <Route path="messenger" element={<MessengerModule apiBaseUrl={apiBaseUrl} />} />
        <Route path="report-builder" element={<ReportBuilderModule apiBaseUrl={apiBaseUrl} />} />
        <Route path="print-templates" element={<PrintTemplateBuilder apiBaseUrl={apiBaseUrl} />} />
        <Route path="accounts" element={<AccountsDayBookModule apiBaseUrl={apiBaseUrl} />} />
        <Route path="gst-reports" element={<GSTReportsModule apiBaseUrl={apiBaseUrl} />} />
        <Route path="refinery" element={<RefineryManagementModule apiBaseUrl={apiBaseUrl} />} />
        <Route path="backup-recovery" element={<BackupRecoveryModule apiBaseUrl={apiBaseUrl} />} />
        <Route path="settings" element={<SettingsRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();

  return isAuthenticated ? children : <Navigate to="/login" replace />;
}

function InventoryWorkspace() {
  return (
    <section className="grid min-h-full grid-rows-[auto_1fr] bg-slate-950">
      <ItemMasterInventory apiBaseUrl={apiBaseUrl} />
      <InventoryRatesDashboard apiBaseUrl={apiBaseUrl} />
    </section>
  );
}

function GoldSchemeRoute() {
  const navigate = useNavigate();

  return (
    <GoldSavingSchemeModule
      apiBaseUrl={apiBaseUrl}
      onRouteToPos={() => navigate("/pos")}
    />
  );
}

function SettingsRoute() {
  const { session, authFetch } = useAuth();
  const [syncUrl, setSyncUrl] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [secretConfigured, setSecretConfigured] = useState(false);
  const [tallySyncEnabled, setTallySyncEnabled] = useState(false);
  const [tallyGatewayUrl, setTallyGatewayUrl] = useState("http://localhost:9000");
  const [tallyCompanyName, setTallyCompanyName] = useState("Test Shop");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tallySaving, setTallySaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadSettings() {
      setLoading(true);
      setError("");
      try {
        const response = await authFetch("/api/settings/ecommerce");
        const data = await response.json();
        if (response.ok) {
          setSyncUrl(data.ecommerce_sync_url || "");
          // The API never returns the raw secret (only whether one is set).
          setSecretConfigured(Boolean(data.webhook_secret_set));
          setSecretKey("");
        } else {
          setError(data.errors?.join(" ") || "Failed to load settings.");
        }

        const tallyResponse = await authFetch("/api/settings/tally");
        const tallyData = await tallyResponse.json();
        if (tallyResponse.ok) {
          setTallySyncEnabled(tallyData.tally_sync_enabled || false);
          setTallyGatewayUrl(tallyData.tally_gateway_url || "http://localhost:9000");
          setTallyCompanyName(tallyData.tally_company_name || "Test Shop");
        }
      } catch (err) {
        setError("Error loading settings.");
      } finally {
        setLoading(false);
      }
    }

    if (session?.token) {
      void loadSettings();
    }
  }, [session?.token, authFetch]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");

    try {
      const response = await authFetch("/api/settings/ecommerce", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ecommerce_sync_url: syncUrl.trim(),
          // Only send a secret when the user typed a new one; blank preserves the existing one.
          ...(secretKey.trim() ? { webhook_secret: secretKey.trim() } : {})
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.errors?.join(" ") || "Failed to save settings.");
      }

      if (secretKey.trim()) setSecretConfigured(true);
      setSecretKey("");
      setMessage("E-commerce synchronization settings saved successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error saving settings.");
    } finally {
      setSaving(false);
    }
  };

  const handleTallySave = async (e: React.FormEvent) => {
    e.preventDefault();
    setTallySaving(true);
    setMessage("");
    setError("");

    try {
      const response = await authFetch("/api/settings/tally", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          tally_sync_enabled: tallySyncEnabled,
          tally_gateway_url: tallyGatewayUrl.trim(),
          tally_company_name: tallyCompanyName.trim()
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.errors?.join(" ") || "Failed to save Tally settings.");
      }

      setMessage("Tally integration settings saved successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error saving Tally settings.");
    } finally {
      setTallySaving(false);
    }
  };

  return (
    <section className="grid min-h-full content-start gap-3 bg-slate-950 p-4 text-slate-100 max-w-4xl">
      <div className="border border-slate-800 bg-slate-900 p-4 rounded-lg">
        <h2 className="text-sm font-semibold uppercase text-white">Local Settings</h2>
        <p className="mt-1 text-xs text-slate-400">Backend settings are available through the rates controls and admin modules.</p>
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs">
        <StatusBox label="Routing" value="HashRouter" />
        <StatusBox label="Database" value="SQLite sidecar" />
        <StatusBox label="Mode" value="Offline first" />
      </div>

      <div className="border border-slate-800 bg-slate-900 p-4 rounded-lg flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase text-white">E-commerce Sync & Webhook Configuration</h2>
          <p className="mt-1 text-xs text-slate-400">Connect this offline local ERP database to external storefront endpoints like Shopify, WooCommerce, or custom API endpoints.</p>
        </div>

        {loading ? (
          <p className="text-xs text-slate-500">Loading configurations...</p>
        ) : (
          <form onSubmit={handleSave} className="grid gap-3 text-xs max-w-2xl">
            {error && <p className="text-xs text-red-300 bg-red-950/20 px-2.5 py-1 rounded">{error}</p>}
            {message && <p className="text-xs text-emerald-300 bg-emerald-950/20 px-2.5 py-1 rounded">{message}</p>}

            <label className="grid gap-1 uppercase font-semibold text-slate-400 text-[10px]">
              Storefront Webhook Sync URL (HTTP POST Endpoint)
              <input
                type="url"
                placeholder="https://yourstore.com/api/webhooks/erp-sync"
                value={syncUrl}
                onChange={(e) => setSyncUrl(e.target.value)}
                className="h-8 border border-slate-700 bg-slate-950 px-2.5 font-normal text-xs text-white outline-none rounded focus:border-emerald-500 transition"
              />
            </label>

            <label className="grid gap-1 uppercase font-semibold text-slate-400 text-[10px]">
              Webhook Secret Key / Webhook API Token
              <input
                type="password"
                placeholder={secretConfigured ? "•••••• configured — leave blank to keep" : "Enter webhook secret or API key"}
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                className="h-8 border border-slate-700 bg-slate-950 px-2.5 font-normal text-xs text-white outline-none rounded focus:border-emerald-500 transition"
              />
              {secretConfigured && <span className="text-[9px] normal-case text-emerald-400/80">A secret is currently configured (hidden for security).</span>}
            </label>

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={saving}
                className="h-8 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-slate-950 font-bold px-4 rounded uppercase text-[11px] disabled:bg-slate-700 disabled:text-slate-400 transition"
              >
                {saving ? "Saving..." : "Save Configuration"}
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="border border-slate-800 bg-slate-900 p-4 rounded-lg flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase text-white">Tally Prime XML Gateway Synchronization</h2>
          <p className="mt-1 text-xs text-slate-400">Stream transaction vouchers (sales, purchases, receipts, returns) automatically to your local running Tally Prime accounting instance.</p>
        </div>

        {loading ? (
          <p className="text-xs text-slate-500">Loading configurations...</p>
        ) : (
          <form onSubmit={handleTallySave} className="grid gap-3 text-xs max-w-2xl">
            <label className="flex items-center gap-2 font-semibold text-slate-300 text-[11px] uppercase cursor-pointer">
              <input
                type="checkbox"
                checked={tallySyncEnabled}
                onChange={(e) => setTallySyncEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-slate-700 bg-slate-950 accent-emerald-500 cursor-pointer"
              />
              Enable Tally Gateway Synchronization
            </label>

            <label className="grid gap-1 uppercase font-semibold text-slate-400 text-[10px]">
              Tally XML Gateway URL (ODBC HTTP Gateway)
              <input
                type="url"
                placeholder="http://localhost:9000"
                value={tallyGatewayUrl}
                onChange={(e) => setTallyGatewayUrl(e.target.value)}
                className="h-8 border border-slate-700 bg-slate-950 px-2.5 font-normal text-xs text-white outline-none rounded focus:border-emerald-500 transition"
              />
            </label>

            <label className="grid gap-1 uppercase font-semibold text-slate-400 text-[10px]">
              Tally Company Name (Must exactly match Tally company name)
              <input
                type="text"
                placeholder="e.g., Shree Jewellers"
                value={tallyCompanyName}
                onChange={(e) => setTallyCompanyName(e.target.value)}
                className="h-8 border border-slate-700 bg-slate-950 px-2.5 font-normal text-xs text-white outline-none rounded focus:border-emerald-500 transition"
              />
            </label>

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={tallySaving}
                className="h-8 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-slate-950 font-bold px-4 rounded uppercase text-[11px] disabled:bg-slate-700 disabled:text-slate-400 transition"
              >
                {tallySaving ? "Saving..." : "Save Tally Configuration"}
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

function StatusBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-slate-800 bg-slate-900 p-3">
      <div className="text-[10px] font-semibold uppercase text-slate-500">{label}</div>
      <div className="mt-1 font-mono text-sm text-slate-100">{value}</div>
    </div>
  );
}
