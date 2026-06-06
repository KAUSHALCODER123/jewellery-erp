import {
  BadgeIndianRupee,
  BarChart3,
  Barcode,
  Boxes,
  CircleDollarSign,
  ClipboardList,
  Gauge,
  Gem,
  Hammer,
  Home,
  Landmark,
  Settings,
  ShieldCheck,
  ReceiptIndianRupee,
  Users,
  WifiOff,
  FileText,
  Flame,
  MessageSquare,
  FileSpreadsheet,
  Printer,
  RadioTower,
  DatabaseBackup,
  Wrench,
  BookOpen,
  Sparkles,
  Truck,
  Lock,
  LogOut,
  Undo2,
  UserCog
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuthSession } from "../../auth/AuthSessionContext.js";
import { useWeighingScale } from "../../hooks/useWeighingScale.js";

type DatabaseStatus = "checking" | "connected" | "offline";

type NavigationItem = {
  label: string;
  to: string;
  icon: ComponentType<{ className?: string }>;
};

const navigationItems: NavigationItem[] = [
  { label: "Dashboard", to: "/dashboard", icon: Home },
  { label: "POS Billing", to: "/pos", icon: BadgeIndianRupee },
  { label: "Receipt", to: "/receipt", icon: ReceiptIndianRupee },
  { label: "Order Booking", to: "/orders", icon: ClipboardList },
  { label: "Returns", to: "/returns", icon: Undo2 },
  { label: "URD Voucher", to: "/urd-voucher", icon: ReceiptIndianRupee },
  { label: "Approval Memo", to: "/approvals", icon: ClipboardList },
  { label: "Purchase", to: "/purchase", icon: Truck },
  { label: "Metal Loan", to: "/metal-loans", icon: CircleDollarSign },
  { label: "Barcode", to: "/barcode", icon: Barcode },
  { label: "Hardware Security", to: "/hardware-security", icon: RadioTower },
  { label: "Inventory", to: "/inventory", icon: Boxes },
  { label: "Karigar", to: "/karigar", icon: Hammer },
  { label: "Repairs", to: "/repairs", icon: Wrench },
  { label: "Girvi", to: "/girvi", icon: Landmark },
  { label: "Gold Scheme", to: "/gold-scheme", icon: Gem },
  { label: "CRM", to: "/crm", icon: Users },
  { label: "Reminders", to: "/reminders", icon: MessageSquare },
  { label: "Messenger", to: "/messenger", icon: MessageSquare },
  { label: "Accounts", to: "/accounts", icon: CircleDollarSign },
  { label: "Settings", to: "/settings", icon: Settings }
];

const routeTitles = new Map([
  ["/", "Login"],
  ["/dashboard", "Dashboard"],
  ["/mis-dashboard", "MIS Analytics Dashboard"],
  ["/pos", "POS Billing"],
  ["/receipt", "Receipt"],
  ["/orders", "Customer Order Booking"],
  ["/returns", "Sales & Purchase Returns"],
  ["/urd-voucher", "URD Voucher"],
  ["/approvals", "Approval / Jangad Memo"],
  ["/metal-loans", "Metal Loan / Unfixed Purchase"],
  ["/reminders", "Reminders & Receivables Ageing"],
  ["/barcode", "Barcode Desk"],
  ["/hardware-security", "Hardware Security"],
  ["/inventory", "Inventory"],
  ["/karigar", "Karigar Manufacturing"],
  ["/repairs", "Repair & Order Desk"],
  ["/girvi", "Girvi Moneylending"],
  ["/gold-scheme", "Gold Saving Scheme"],
  ["/gss-schemes", "Gold Scheme Builder"],
  ["/daybook", "Day Book"],
  ["/crm", "Customer Relationship Management"],
  ["/messenger", "Messenger & CRM Automation"],
  ["/report-builder", "Dynamic Report Builder"],
  ["/print-templates", "Print Template Builder"],
  ["/accounts", "Accounts"],
  ["/gst-reports", "GST Compliance Reports"],
  ["/gst-edocs", "GST e-Invoice & e-Way Bill"],
  ["/refinery", "Refinery Management"],
  ["/backup-recovery", "Backup & Recovery"],
  ["/users", "Staff User Management"],
  ["/settings", "Settings"]
]);

export default function MainLayout({ apiBaseUrl = "" }: { apiBaseUrl?: string }) {
  const location = useLocation();
  const { session, logout } = useAuthSession();
  const scale = useWeighingScale();
  const databaseStatus = useDatabaseStatus(apiBaseUrl);
  const title = routeTitles.get(location.pathname) ?? "Jewelry ERP";

  const isAdminOrManager = session?.user.role === "ADMIN" || session?.user.role === "MANAGER";

  // App lock: auto-locks after idle, requiring the user's password to resume (protects ledgers when owner steps away).
  const IDLE_LOCK_MS = 5 * 60 * 1000;
  const [locked, setLocked] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (locked) return;
    const reset = () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => setLocked(true), IDLE_LOCK_MS);
    };
    const events: (keyof WindowEventMap)[] = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];
    events.forEach((event) => window.addEventListener(event, reset, { passive: true }));
    reset();
    return () => {
      events.forEach((event) => window.removeEventListener(event, reset));
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [locked]);

  async function unlockApp(event: React.FormEvent) {
    event.preventDefault();
    setUnlockError("");
    try {
      const res = await fetch(`${apiBaseUrl}/api/auth/verify-password`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.token ?? ""}`, "Content-Type": "application/json" },
        body: JSON.stringify({ password: unlockPassword })
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean } | null;
      if (res.ok && data?.ok) {
        setLocked(false);
        setUnlockPassword("");
      } else {
        setUnlockError("Incorrect password.");
      }
    } catch {
      setUnlockError("Verification failed.");
    }
  }

  const visibleNavItems = useMemo(() => {
    const items = [...navigationItems];
    if (isAdminOrManager) {
      items.unshift({ label: "MIS Dashboard", to: "/mis-dashboard", icon: BarChart3 });
      items.splice(1, 0, { label: "Day Book", to: "/daybook", icon: BookOpen });
      items.splice(2, 0, { label: "GST Reports", to: "/gst-reports", icon: FileText });
      items.splice(3, 0, { label: "GST e-Docs", to: "/gst-edocs", icon: FileText });
      items.push({ label: "Scheme Builder", to: "/gss-schemes", icon: Sparkles });
      items.push({ label: "Refinery", to: "/refinery", icon: Flame });
      items.push({ label: "Report Builder", to: "/report-builder", icon: FileSpreadsheet });
      items.push({ label: "Print Templates", to: "/print-templates", icon: Printer });
    }
    if (session?.user.role === "ADMIN") {
      items.push({ label: "Backup & Recovery", to: "/backup-recovery", icon: DatabaseBackup });
      items.push({ label: "Users", to: "/users", icon: UserCog });
    }
    return items;
  }, [isAdminOrManager, session?.user.role]);

  return (
    <div className="grid h-screen grid-cols-[232px_1fr] overflow-hidden bg-slate-950 text-slate-100">
      <aside className="grid min-h-0 grid-rows-[auto_1fr_auto] border-r border-slate-800 bg-slate-950">
        <div className="border-b border-slate-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center bg-emerald-500 text-slate-950">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">Jewelry ERP</p>
              <p className="truncate text-[11px] uppercase text-slate-500">Offline Desktop</p>
            </div>
          </div>
        </div>

        <nav className="min-h-0 overflow-y-auto px-2 py-3">
          <div className="grid gap-1">
            {visibleNavItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  [
                    "flex h-9 items-center gap-2 px-2 text-xs font-semibold uppercase tracking-wide transition",
                    isActive
                      ? "bg-emerald-500 text-slate-950"
                      : "text-slate-400 hover:bg-slate-900 hover:text-white"
                  ].join(" ")
                }
              >
                <item.icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </NavLink>
            ))}
          </div>
        </nav>

        <div className="border-t border-slate-800 p-3 text-xs">
          <div className="truncate font-medium text-slate-200">{session?.user.username ?? "Not signed in"}</div>
          <div className="mt-0.5 uppercase text-slate-500">{session?.user.role ?? "Local Access"}</div>
          {session?.user.firm_name && (
            <div className="mt-1.5 truncate rounded bg-slate-800/60 px-1.5 py-1 text-[10px] font-semibold text-emerald-300/80">
              {session.user.firm_name}
            </div>
          )}
          {session?.user.fiscal_year && (
            <div className="mt-1 text-[10px] text-slate-600 uppercase tracking-wide">
              FY {session.user.fiscal_year}
            </div>
          )}
          <button
            type="button"
            onClick={() => { void logout(); }}
            title="Sign out of this session"
            className="mt-2.5 flex w-full items-center justify-center gap-1.5 border border-slate-700 px-2 py-1.5 text-[11px] font-semibold uppercase text-slate-300 hover:border-red-500 hover:text-red-300"
          >
            <LogOut className="h-3.5 w-3.5" /> Logout
          </button>
        </div>
      </aside>

      <section className="grid min-h-0 grid-rows-[48px_1fr]">
        <header className="flex items-center justify-between gap-4 border-b border-slate-800 bg-slate-900 px-4">
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold uppercase text-white">{title}</h1>
            <p className="truncate text-[11px] text-slate-500">
              {session?.user.firm_name
                ? `${session.user.firm_name}${session.user.fiscal_year ? ` · FY ${session.user.fiscal_year}` : ""}`
                : "Single-PC local ERP workspace"}
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <StatusPill
              label="Database"
              value={databaseStatus === "connected" ? "Connected" : databaseStatus === "checking" ? "Checking" : "Offline"}
              tone={databaseStatus === "connected" ? "good" : databaseStatus === "checking" ? "warn" : "bad"}
              icon={databaseStatus === "offline" ? WifiOff : Gauge}
            />
            <StatusPill
              label="Scale"
              value={scale.isConnected ? "Connected" : "Offline"}
              tone={scale.isConnected ? "good" : "bad"}
              icon={scale.isConnected ? Gauge : WifiOff}
            />
            <button
              type="button"
              onClick={() => setLocked(true)}
              title="Lock the app"
              className="flex h-7 items-center gap-1 border border-slate-700 px-2 text-[11px] font-semibold uppercase text-slate-300 hover:border-emerald-400 hover:text-emerald-300"
            >
              <Lock className="h-3.5 w-3.5" /> Lock
            </button>
          </div>
        </header>

        <main className="min-h-0 overflow-auto bg-slate-950">
          {/* While locked, unmount the active screen entirely so customer/ledger data is not left
              in the DOM (or refetched) behind the overlay — the lock must hide data, not just the mouse. */}
          {locked ? (
            <div className="grid min-h-full place-items-center text-slate-800">
              <Lock className="h-10 w-10" />
            </div>
          ) : (
            /* Keyed by route so each screen gets a fresh fade-in on navigation. */
            <div key={location.pathname} className="animate-fade-in min-h-full">
              <Outlet />
            </div>
          )}
        </main>
      </section>

      {locked && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/95 backdrop-blur">
          <form onSubmit={unlockApp} className="grid w-80 gap-3 border border-slate-700 bg-slate-900 p-6 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-500 text-slate-950">
              <Lock className="h-6 w-6" />
            </div>
            <h2 className="text-sm font-semibold uppercase text-white">App Locked</h2>
            <p className="text-[11px] text-slate-400">Enter {session?.user.username ?? "your"} password to resume.</p>
            <input
              type="password"
              autoFocus
              value={unlockPassword}
              onChange={(event) => setUnlockPassword(event.target.value)}
              placeholder="Password"
              className="h-9 border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none focus:border-emerald-400"
            />
            {unlockError && <p className="text-[11px] font-semibold text-red-300">{unlockError}</p>}
            <button type="submit" className="h-9 bg-emerald-500 text-xs font-bold uppercase text-slate-950 hover:bg-emerald-600">Unlock</button>
          </form>
        </div>
      )}
    </div>
  );
}

function StatusPill({
  label,
  value,
  tone,
  icon: Icon
}: {
  label: string;
  value: string;
  tone: "good" | "warn" | "bad";
  icon: ComponentType<{ className?: string }>;
}) {
  const toneClassName =
    tone === "good"
      ? "border-emerald-800 bg-emerald-950/50 text-emerald-200"
      : tone === "warn"
        ? "border-amber-800 bg-amber-950/50 text-amber-200"
        : "border-red-900 bg-red-950/50 text-red-200";

  return (
    <div className={`flex h-8 items-center gap-2 border px-2 ${toneClassName}`}>
      <Icon className="h-3.5 w-3.5" />
      <span className="text-slate-400">{label}:</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function useDatabaseStatus(apiBaseUrl: string) {
  const [status, setStatus] = useState<DatabaseStatus>("checking");

  useEffect(() => {
    let isMounted = true;

    async function checkHealth() {
      try {
        const response = await fetch(`${apiBaseUrl}/health`);
        if (isMounted) {
          setStatus(response.ok ? "connected" : "offline");
        }
      } catch {
        if (isMounted) {
          setStatus("offline");
        }
      }
    }

    void checkHealth();
    const intervalId = window.setInterval(checkHealth, 15000);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [apiBaseUrl]);

  return status;
}
