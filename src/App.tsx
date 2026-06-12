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
import PurchaseInvoiceModule from "./components/PurchaseInvoiceModule.js";
import { POSCreditProvider } from "./pos/POSCreditContext.js";
import MISDashboard from "./components/MISDashboard.js";
import StandaloneUrdVoucher from "./components/StandaloneUrdVoucher.js";
import GSTReportsModule from "./components/GSTReportsModule.js";
import MessengerModule from "./components/MessengerModule.js";
import ReportBuilderModule from "./components/ReportBuilderModule.js";
import PrintTemplateBuilder from "./components/PrintTemplateBuilder.js";
import FirmsManager from "./components/FirmsManager.js";
import ApprovalMemoModule from "./components/ApprovalMemoModule.js";
import MetalLoanModule from "./components/MetalLoanModule.js";
import RemindersAgeingModule from "./components/RemindersAgeingModule.js";
import GstEDocsModule from "./components/GstEDocsModule.js";
import HardwareSecurityModule from "./components/HardwareSecurityModule.js";
import BackupRecoveryModule from "./components/BackupRecoveryModule.js";
import RepairDeskModule from "./components/RepairDeskModule.js";
import DayBookSummary from "./components/DayBookSummary.js";
import GssSchemeBuilder from "./components/GssSchemeBuilder.js";
import UdhariReceiptWindow from "./components/UdhariReceiptWindow.js";
import CustomerOrderBookingModule from "./components/CustomerOrderBookingModule.js";
import ReturnsModule from "./components/ReturnsModule.js";
import UserManagementModule from "./components/UserManagementModule.js";

const runningInTauri = isTauri();
const apiBaseUrl = runningInTauri ? "http://127.0.0.1:4000" : "";

export default function App() {
  const [exitBackupRunning, setExitBackupRunning] = useState(false);

  useEffect(() => {
    if (runningInTauri) {
      let unlisten: (() => void) | null = null;
      let unmounted = false;
      let closing = false;
      import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
        getCurrentWindow().onCloseRequested(async (event) => {
          event.preventDefault();
          if (closing) return;
          closing = true;
          setExitBackupRunning(true);
          try {
            // Cap the exit-backup call so a dead/slow backend can never block the
            // window from closing. 15s covers a large-database snapshot+gzip;
            // the overlay below tells the user why the window is still open.
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000);
            try {
              await fetch(`${apiBaseUrl}/api/backup/on-exit`, { method: "POST", signal: controller.signal });
            } finally {
              clearTimeout(timeout);
            }
          } catch (err) {
            console.error("Backup on exit failed (closing anyway):", err);
          } finally {
            await getCurrentWindow().destroy();
          }
        }).then((unlistenFn) => {
          // The effect can be cleaned up before this promise resolves; unlisten
          // immediately in that case instead of leaking the handler.
          if (unmounted) {
            unlistenFn();
          } else {
            unlisten = unlistenFn;
          }
        });
      });

      return () => {
        unmounted = true;
        if (unlisten) unlisten();
      };
    }
  }, []);

  return (
    <AuthProvider apiBaseUrl={apiBaseUrl}>
      <POSCreditProvider>
        <HashRouter>
          <BackendGate>
            <AppRoutes />
          </BackendGate>
        </HashRouter>
      </POSCreditProvider>
      {exitBackupRunning ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90">
          <p className="text-sm font-semibold text-slate-50">Backing up before exit&hellip;</p>
        </div>
      ) : null}
    </AuthProvider>
  );
}

// The login screen already polls until the sidecar backend is up, but a
// returning user with a stored session skips it and would land on dashboards
// whose fetches all fail while the backend is still booting. Hold rendering
// until /health answers (Tauri only — on the web the server served this page).
function BackendGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!runningInTauri);

  useEffect(() => {
    if (ready) return;
    let cancelled = false;

    (async () => {
      for (let attempt = 1; attempt <= 120 && !cancelled; attempt += 1) {
        try {
          const response = await fetch(`${apiBaseUrl}/health`);
          if (response.ok) break;
        } catch {
          // Backend not up yet — retry below.
        }
        await new Promise((resolve) => window.setTimeout(resolve, 500));
      }
      // After 60s of failures, render anyway: the login screen's own error
      // path explains the connection problem better than an endless spinner.
      if (!cancelled) setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [ready]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <p className="text-sm font-semibold text-slate-50">Starting local backend&hellip;</p>
      </div>
    );
  }

  return <>{children}</>;
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
        <Route path="receipt" element={<UdhariReceiptWindow apiBaseUrl={apiBaseUrl} />} />
        <Route path="orders" element={<CustomerOrderBookingModule apiBaseUrl={apiBaseUrl} />} />
        <Route path="returns" element={<ReturnsModule apiBaseUrl={apiBaseUrl} />} />
        <Route path="urd-voucher" element={<StandaloneUrdVoucher apiBaseUrl={apiBaseUrl} />} />
        <Route path="approvals" element={<ApprovalMemoModule apiBaseUrl={apiBaseUrl} />} />
        <Route path="purchase" element={<PurchaseInvoiceModule apiBaseUrl={apiBaseUrl} />} />
        <Route path="metal-loans" element={<MetalLoanModule apiBaseUrl={apiBaseUrl} />} />
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
        <Route path="reminders" element={<RemindersAgeingModule apiBaseUrl={apiBaseUrl} />} />
        <Route path="messenger" element={<MessengerModule apiBaseUrl={apiBaseUrl} />} />
        <Route path="report-builder" element={<ReportBuilderModule apiBaseUrl={apiBaseUrl} />} />
        <Route path="print-templates" element={<PrintTemplateBuilder apiBaseUrl={apiBaseUrl} />} />
        <Route path="accounts" element={<AccountsDayBookModule apiBaseUrl={apiBaseUrl} />} />
        <Route path="gst-reports" element={<GSTReportsModule apiBaseUrl={apiBaseUrl} />} />
        <Route path="gst-edocs" element={<GstEDocsModule apiBaseUrl={apiBaseUrl} />} />
        <Route path="refinery" element={<RefineryManagementModule apiBaseUrl={apiBaseUrl} />} />
        <Route path="backup-recovery" element={<BackupRecoveryModule apiBaseUrl={apiBaseUrl} />} />
        <Route path="users" element={<UserManagementModule apiBaseUrl={apiBaseUrl} />} />
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

type PrintLanguage = "english" | "marathi" | "hindi" | "gujarati";

const LANGUAGE_OPTIONS: { value: PrintLanguage; label: string; nativeName: string; sample: string; script: string }[] = [
  { value: "english", label: "English", nativeName: "English", sample: "TAX INVOICE", script: "Latin" },
  { value: "marathi", label: "Marathi", nativeName: "मराठी", sample: "कर चलान", script: "Devanagari" },
  { value: "hindi", label: "Hindi", nativeName: "हिंदी", sample: "कर बीजक", script: "Devanagari" },
  { value: "gujarati", label: "Gujarati", nativeName: "ગુજરાતી", sample: "કર ચલણ", script: "Gujarati" }
];

function SettingsRoute() {
  const { session, authFetch } = useAuth();
  const [syncUrl, setSyncUrl] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [secretConfigured, setSecretConfigured] = useState(false);
  const [tallySyncEnabled, setTallySyncEnabled] = useState(false);
  const [tallyGatewayUrl, setTallyGatewayUrl] = useState("http://localhost:9000");
  const [tallyCompanyName, setTallyCompanyName] = useState("Test Shop");
  const [loyaltyEarnMode, setLoyaltyEarnMode] = useState<"PER_HUNDRED_RUPEES" | "PER_GRAM_GOLD">("PER_HUNDRED_RUPEES");
  const [loyaltyPointsPerHundred, setLoyaltyPointsPerHundred] = useState("1");
  const [loyaltyPointsPerGramGold, setLoyaltyPointsPerGramGold] = useState("1");
  const [printLanguage, setPrintLanguage] = useState<PrintLanguage>("english");
  const [langSaving, setLangSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tallySaving, setTallySaving] = useState(false);
  const [loyaltySaving, setLoyaltySaving] = useState(false);
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

        const loyaltyResponse = await authFetch("/api/settings/loyalty");
        const loyaltyData = await loyaltyResponse.json();
        if (loyaltyResponse.ok && loyaltyData.loyalty) {
          setLoyaltyEarnMode(loyaltyData.loyalty.loyalty_earn_mode === "PER_GRAM_GOLD" ? "PER_GRAM_GOLD" : "PER_HUNDRED_RUPEES");
          setLoyaltyPointsPerHundred(String(loyaltyData.loyalty.loyalty_points_per_hundred ?? 1));
          setLoyaltyPointsPerGramGold(String(loyaltyData.loyalty.loyalty_points_per_gram_gold ?? 1));
        }

        const langResponse = await authFetch("/api/settings/print-language");
        const langData = await langResponse.json();
        if (langResponse.ok && langData.print_language) {
          setPrintLanguage(langData.print_language as PrintLanguage);
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

  const handleCatalogExport = async () => {
    setMessage("");
    setError("");
    if (!secretKey.trim()) {
      setError("Enter the webhook secret / API key above to preview the catalog export (it is sent as the x-api-key).");
      return;
    }
    try {
      const response = await fetch(`${apiBaseUrl}/api/ecommerce/catalog/export`, {
        headers: { "x-api-key": secretKey.trim() }
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error((data && data.errors?.join(" ")) || "Catalog export failed (check the API key).");
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "catalog-export.json";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      const count = Array.isArray(data?.catalog) ? data.catalog.length : 0;
      setMessage(`Catalog export downloaded (${count} published item${count === 1 ? "" : "s"}).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Catalog export failed.");
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

  const handleLoyaltySave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoyaltySaving(true);
    setMessage("");
    setError("");

    try {
      const response = await authFetch("/api/settings/loyalty", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          loyalty_earn_mode: loyaltyEarnMode,
          loyalty_points_per_hundred: Number(loyaltyPointsPerHundred) || 0,
          loyalty_points_per_gram_gold: Number(loyaltyPointsPerGramGold) || 0
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.errors?.join(" ") || "Failed to save loyalty settings.");
      }

      setMessage("Loyalty settings saved successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error saving loyalty settings.");
    } finally {
      setLoyaltySaving(false);
    }
  };

  const handleLangSave = async (lang: PrintLanguage) => {
    setLangSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await authFetch("/api/settings/print-language", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ print_language: lang })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.errors?.join(" ") || "Failed to save language.");
      setPrintLanguage(lang);
      setMessage(`Print language set to ${LANGUAGE_OPTIONS.find(o => o.value === lang)?.label ?? lang}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error saving language.");
    } finally {
      setLangSaving(false);
    }
  };

  const [settingsTab, setSettingsTab] = useState<"general" | "firm" | "integrations" | "print" | "loyalty">("general");

  const SETTINGS_TABS: { id: typeof settingsTab; label: string }[] = [
    { id: "general", label: "General" },
    { id: "firm", label: "Firm Details" },
    { id: "integrations", label: "Integrations" },
    { id: "print", label: "Print & Display" },
    { id: "loyalty", label: "Loyalty" },
  ];

  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_1fr] bg-slate-950 text-slate-100">
      {/* Tab bar */}
      <header className="flex items-center gap-1 border-b border-slate-800 bg-slate-900 px-4">
        {SETTINGS_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSettingsTab(tab.id)}
            className={`h-10 px-4 text-xs font-semibold uppercase transition border-b-2 ${
              settingsTab === tab.id
                ? "border-emerald-500 text-emerald-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </header>

      {/* Global feedback banner (shared across tabs) */}
      <div className="min-h-0 overflow-auto">
        {(message || error) && (
          <div className={`px-4 py-2 text-xs font-medium ${error ? "bg-red-950/60 text-red-200" : "bg-emerald-950/60 text-emerald-200"}`}>
            {error || message}
          </div>
        )}

        <div className="grid content-start gap-4 p-4 max-w-4xl">

          {/* ── General ── */}
          {settingsTab === "general" && (
            <>
              <div className="border border-slate-800 bg-slate-900 p-4 rounded-lg">
                <h2 className="text-sm font-semibold uppercase text-slate-50">Local Settings</h2>
                <p className="mt-1 text-xs text-slate-400">Backend settings are available through the rates controls and admin modules.</p>
              </div>
              <div className="grid grid-cols-3 gap-3 text-xs">
                <StatusBox label="Routing" value="HashRouter" />
                <StatusBox label="Database" value="SQLite sidecar" />
                <StatusBox label="Mode" value="Offline first" />
              </div>
            </>
          )}

          {/* ── Firm Details ── */}
          {settingsTab === "firm" && <FirmsManager />}

          {/* ── Integrations ── */}
          {settingsTab === "integrations" && (
            <>
              <div className="border border-slate-800 bg-slate-900 p-4 rounded-lg flex flex-col gap-3">
                <div>
                  <h2 className="text-sm font-semibold uppercase text-slate-50">E-commerce Sync & Webhook Configuration</h2>
                  <p className="mt-1 text-xs text-slate-400">Connect this offline local ERP database to external storefront endpoints like Shopify, WooCommerce, or custom API endpoints.</p>
                </div>
                {loading ? (
                  <p className="text-xs text-slate-500">Loading configurations...</p>
                ) : (
                  <form onSubmit={handleSave} className="grid gap-3 text-xs max-w-2xl">
                    <label className="grid gap-1 uppercase font-semibold text-slate-400 text-[10px]">
                      Storefront Webhook Sync URL (HTTP POST Endpoint)
                      <input
                        type="url"
                        placeholder="https://yourstore.com/api/webhooks/erp-sync"
                        value={syncUrl}
                        onChange={(e) => setSyncUrl(e.target.value)}
                        className="h-8 border border-slate-700 bg-slate-950 px-2.5 font-normal text-xs text-slate-50 outline-none rounded focus:border-emerald-500 transition"
                      />
                    </label>
                    <label className="grid gap-1 uppercase font-semibold text-slate-400 text-[10px]">
                      Webhook Secret Key / Webhook API Token
                      <input
                        type="password"
                        placeholder={secretConfigured ? "•••••• configured — leave blank to keep" : "Enter webhook secret or API key"}
                        value={secretKey}
                        onChange={(e) => setSecretKey(e.target.value)}
                        className="h-8 border border-slate-700 bg-slate-950 px-2.5 font-normal text-xs text-slate-50 outline-none rounded focus:border-emerald-500 transition"
                      />
                      {secretConfigured && <span className="text-[9px] normal-case text-emerald-400/80">A secret is currently configured (hidden for security).</span>}
                      {secretConfigured && <span className="text-[9px] normal-case text-slate-500">Re-enter the secret above to preview the catalog (it is never stored in the browser).</span>}
                    </label>
                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => void handleCatalogExport()}
                        title="Fetch and download the live online catalog JSON using the API key entered above"
                        className="h-8 border border-slate-600 hover:border-emerald-400 text-slate-200 hover:text-emerald-300 font-bold px-4 rounded uppercase text-[11px] transition"
                      >
                        Preview Catalog Export
                      </button>
                      <button
                        type="submit"
                        disabled={saving}
                        className="h-8 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-slate-50 font-bold px-4 rounded uppercase text-[11px] disabled:bg-slate-700 disabled:text-slate-400 transition"
                      >
                        {saving ? "Saving..." : "Save Configuration"}
                      </button>
                    </div>
                  </form>
                )}
              </div>

              <div className="border border-slate-800 bg-slate-900 p-4 rounded-lg flex flex-col gap-3">
                <div>
                  <h2 className="text-sm font-semibold uppercase text-slate-50">Tally Prime XML Gateway Synchronization</h2>
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
                        className="h-8 border border-slate-700 bg-slate-950 px-2.5 font-normal text-xs text-slate-50 outline-none rounded focus:border-emerald-500 transition"
                      />
                    </label>
                    <label className="grid gap-1 uppercase font-semibold text-slate-400 text-[10px]">
                      Tally Company Name (Must exactly match Tally company name)
                      <input
                        type="text"
                        placeholder="e.g., Shree Jewellers"
                        value={tallyCompanyName}
                        onChange={(e) => setTallyCompanyName(e.target.value)}
                        className="h-8 border border-slate-700 bg-slate-950 px-2.5 font-normal text-xs text-slate-50 outline-none rounded focus:border-emerald-500 transition"
                      />
                    </label>
                    <div className="flex justify-end pt-1">
                      <button
                        type="submit"
                        disabled={tallySaving}
                        className="h-8 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-slate-50 font-bold px-4 rounded uppercase text-[11px] disabled:bg-slate-700 disabled:text-slate-400 transition"
                      >
                        {tallySaving ? "Saving..." : "Save Tally Configuration"}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </>
          )}

          {/* ── Print & Display ── */}
          {settingsTab === "print" && (
            <div className="border border-slate-800 bg-slate-900 p-4 rounded-lg flex flex-col gap-3">
              <div>
                <h2 className="text-sm font-semibold uppercase text-slate-50">Print Language / मुद्रण भाषा / છાપ ભાષા</h2>
                <p className="mt-1 text-xs text-slate-400">
                  Choose the language for field headers on printed invoices and receipts (Pavati). The software UI stays in English — only the printout changes.
                </p>
              </div>
              {loading ? (
                <p className="text-xs text-slate-500">Loading language settings...</p>
              ) : (
                <div className="grid gap-3">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {LANGUAGE_OPTIONS.map((opt) => {
                      const isSelected = printLanguage === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          disabled={langSaving}
                          onClick={() => void handleLangSave(opt.value)}
                          className={[
                            "flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center transition-all",
                            isSelected
                              ? "border-emerald-500 bg-emerald-950/30 ring-1 ring-emerald-500/40"
                              : "border-slate-700 bg-slate-950 hover:border-slate-500 hover:bg-slate-800"
                          ].join(" ")}
                        >
                          <span className={["text-xl font-bold leading-none tracking-tight", isSelected ? "text-emerald-300" : "text-slate-100"].join(" ")}>
                            {opt.nativeName}
                          </span>
                          <span className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">{opt.label}</span>
                          <span className={["mt-0.5 rounded px-1.5 py-0.5 font-mono text-[10px]", isSelected ? "bg-emerald-900/50 text-emerald-200" : "bg-slate-800 text-slate-400"].join(" ")}>
                            {opt.sample}
                          </span>
                          {isSelected && (
                            <span className="mt-0.5 text-[9px] font-bold uppercase text-emerald-400">Active</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-amber-400/80">
                    Marathi / Hindi require <strong>NotoSansDevanagari-Regular.ttf</strong> and Gujarati requires <strong>NotoSansGujarati-Regular.ttf</strong> placed in the <code className="bg-slate-800 px-1 rounded">fonts/</code> folder next to the ERP executable. Without them, Indic characters will not render in PDFs. Download free from <span className="underline">fonts.google.com/noto</span>.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Loyalty ── */}
          {settingsTab === "loyalty" && (
            <div className="border border-slate-800 bg-slate-900 p-4 rounded-lg flex flex-col gap-3">
              <div>
                <h2 className="text-sm font-semibold uppercase text-slate-50">Loyalty Earning Rules</h2>
                <p className="mt-1 text-xs text-slate-400">Choose whether enrolled customers earn by invoice value or gold net weight.</p>
              </div>
              {loading ? (
                <p className="text-xs text-slate-500">Loading loyalty rules...</p>
              ) : (
                <form onSubmit={handleLoyaltySave} className="grid gap-3 text-xs max-w-2xl">
                  <label className="grid gap-1 uppercase font-semibold text-slate-400 text-[10px]">
                    Earning Mode
                    <select
                      value={loyaltyEarnMode}
                      onChange={(e) => setLoyaltyEarnMode(e.target.value === "PER_GRAM_GOLD" ? "PER_GRAM_GOLD" : "PER_HUNDRED_RUPEES")}
                      className="h-8 border border-slate-700 bg-slate-950 px-2.5 font-normal text-xs text-slate-50 outline-none rounded focus:border-emerald-500 transition"
                    >
                      <option value="PER_HUNDRED_RUPEES">Per Rs 100 of net payable</option>
                      <option value="PER_GRAM_GOLD">Per gram of gold</option>
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="grid gap-1 uppercase font-semibold text-slate-400 text-[10px]">
                      Points per Rs 100
                      <input
                        value={loyaltyPointsPerHundred}
                        onChange={(e) => setLoyaltyPointsPerHundred(e.target.value.replace(/[^\d-]/g, ""))}
                        className="h-8 border border-slate-700 bg-slate-950 px-2.5 font-normal text-xs text-slate-50 outline-none rounded focus:border-emerald-500 transition"
                        inputMode="numeric"
                      />
                    </label>
                    <label className="grid gap-1 uppercase font-semibold text-slate-400 text-[10px]">
                      Points per gram gold
                      <input
                        value={loyaltyPointsPerGramGold}
                        onChange={(e) => setLoyaltyPointsPerGramGold(e.target.value.replace(/[^\d-]/g, ""))}
                        className="h-8 border border-slate-700 bg-slate-950 px-2.5 font-normal text-xs text-slate-50 outline-none rounded focus:border-emerald-500 transition"
                        inputMode="numeric"
                      />
                    </label>
                  </div>
                  <div className="flex justify-end pt-1">
                    <button
                      type="submit"
                      disabled={loyaltySaving}
                      className="h-8 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-slate-50 font-bold px-4 rounded uppercase text-[11px] disabled:bg-slate-700 disabled:text-slate-400 transition"
                    >
                      {loyaltySaving ? "Saving..." : "Save Loyalty Rules"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

        </div>
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
