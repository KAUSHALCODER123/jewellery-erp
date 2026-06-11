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
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuthSession } from "../../auth/AuthSessionContext.js";
import { scaleSocketUrl, useWeighingScale } from "../../hooks/useWeighingScale.js";

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

// Global accelerators for the highest-frequency screens. F-keys are safe to
// intercept even while an input is focused, and the barcode wedge ignores
// non-character keys, so there is no conflict with scanning or typing.
const hotkeyRoutes = new Map([
  ["F1", "/pos"],
  ["F2", "/receipt"],
  ["F3", "/daybook"],
  ["F4", "/inventory"]
]);

const routeHotkeys = new Map(Array.from(hotkeyRoutes, ([key, route]) => [route, key]));

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
  const navigate = useNavigate();
  const { session, logout } = useAuthSession();
  const scale = useWeighingScale(scaleSocketUrl(apiBaseUrl));
  const databaseStatus = useDatabaseStatus(apiBaseUrl);
  const title = routeTitles.get(location.pathname) ?? "Jewelry ERP";

  const isAdminOrManager = session?.user.role === "ADMIN" || session?.user.role === "MANAGER";

  // App lock: auto-locks after idle, requiring the user's password to resume (protects ledgers when owner steps away).
  const IDLE_LOCK_MS = 15 * 60 * 1000;
  const [locked, setLocked] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hotkeyToast, setHotkeyToast] = useState("");
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Icon-only sidebar reclaims ~175px of content width on the 1366px laptops
  // common at billing counters. Preference persists across sessions.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("ui:sidebarCollapsed") === "1");
  function toggleSidebar() {
    setSidebarCollapsed((collapsed) => {
      localStorage.setItem("ui:sidebarCollapsed", collapsed ? "0" : "1");
      return !collapsed;
    });
  }
  const hotkeyToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function flashHotkeyToast(text: string) {
    setHotkeyToast(text);
    if (hotkeyToastTimer.current) clearTimeout(hotkeyToastTimer.current);
    hotkeyToastTimer.current = setTimeout(() => setHotkeyToast(""), 3500);
  }

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

  // Global keyboard shortcuts — the whole app was mouse-only before.
  useEffect(() => {
    if (locked) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && !event.altKey && !event.metaKey && (event.key === "l" || event.key === "L")) {
        event.preventDefault();
        setLocked(true);
        return;
      }
      // Ctrl+K opens the command palette — one shortcut that reaches every
      // module, instead of binding an F-key per screen.
      if (event.ctrlKey && !event.altKey && !event.metaKey && (event.key === "k" || event.key === "K")) {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const route = hotkeyRoutes.get(event.key);
      if (!route) return;
      // Day Book is an admin/manager screen; tell staff why instead of a
      // silent redirect that makes F3 look like "go to dashboard".
      if (route === "/daybook" && !isAdminOrManager) {
        event.preventDefault();
        flashHotkeyToast("Day Book is restricted to managers and admins.");
        return;
      }
      event.preventDefault();
      navigate(route);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [locked, isAdminOrManager, navigate]);

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
    <div className={`grid h-screen overflow-hidden bg-slate-950 text-slate-100 ${sidebarCollapsed ? "grid-cols-[56px_1fr]" : "grid-cols-[232px_1fr]"}`}>
      {/* Charcoal sidebar: explicit dark surface + light text (arbitrary colours so it
          stays charcoal regardless of the light-theme slate scale). Gold active state. */}
      <aside className="grid min-h-0 grid-rows-[auto_1fr_auto] border-r border-[#33302B] bg-[#222222]">
        <div className={`border-b border-[#33302B] py-3 ${sidebarCollapsed ? "px-2" : "px-4"}`}>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleSidebar}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="grid h-8 w-8 shrink-0 place-items-center bg-emerald-500 text-slate-50 transition hover:bg-emerald-400"
            >
              <ShieldCheck className="h-4 w-4" />
            </button>
            {!sidebarCollapsed && (
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[#F5F1E8]">Jewelry ERP</p>
                <p className="truncate text-[11px] uppercase text-[#9C968A]">Offline Desktop</p>
              </div>
            )}
          </div>
        </div>

        <nav className="min-h-0 overflow-y-auto px-2 py-3">
          <div className="grid gap-1">
            {visibleNavItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                title={routeHotkeys.has(item.to) ? `${item.label} (${routeHotkeys.get(item.to)})` : item.label}
                className={({ isActive }) =>
                  [
                    "flex h-9 items-center gap-2 px-2 text-xs font-semibold uppercase tracking-wide transition",
                    sidebarCollapsed ? "justify-center" : "",
                    isActive
                      ? "bg-emerald-500 text-slate-50"
                      : "text-[#C4BEB0] hover:bg-[#2E2A24] hover:text-[#FFFFFF]"
                  ].join(" ")
                }
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
              </NavLink>
            ))}
          </div>
        </nav>

        <div className={`border-t border-[#33302B] text-xs ${sidebarCollapsed ? "p-2" : "p-3"}`}>
          {!sidebarCollapsed && (
          <>
          <div className="truncate font-medium text-[#E7E2D6]">{session?.user.username ?? "Not signed in"}</div>
          <div className="mt-0.5 uppercase text-[#9C968A]">{session?.user.role ?? "Local Access"}</div>
          {session?.user.firm_name && (
            <div className="mt-1.5 truncate rounded bg-[#2E2A24] px-1.5 py-1 text-[10px] font-semibold text-[#D4AF37]">
              {session.user.firm_name}
            </div>
          )}
          {session?.user.fiscal_year && (
            <div className="mt-1 text-[10px] text-[#857F72] uppercase tracking-wide">
              FY {session.user.fiscal_year}
            </div>
          )}
          </>
          )}
          <button
            type="button"
            onClick={() => { void logout(); }}
            title="Sign out of this session"
            className={`flex w-full items-center justify-center gap-1.5 border border-[#3A372F] px-2 py-1.5 text-[11px] font-semibold uppercase text-[#C4BEB0] hover:border-red-500 hover:text-[#F08C8C] ${sidebarCollapsed ? "" : "mt-2.5"}`}
          >
            <LogOut className="h-3.5 w-3.5" /> {!sidebarCollapsed && "Logout"}
          </button>
        </div>
      </aside>

      <section className="grid min-h-0 grid-rows-[48px_1fr]">
        <header className="flex items-center justify-between gap-4 border-b border-slate-800 bg-slate-900 px-4">
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold uppercase text-slate-50">{title}</h1>
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
              onClick={() => setShowShortcuts(true)}
              title="Keyboard shortcuts"
              className="flex h-7 w-7 items-center justify-center border border-slate-700 text-[13px] font-bold text-slate-300 hover:border-emerald-400 hover:text-emerald-300"
            >
              ?
            </button>
            <button
              type="button"
              onClick={() => setLocked(true)}
              title="Lock the app (Ctrl+L)"
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

      {hotkeyToast && (
        <div className="animate-fade-in fixed bottom-4 right-4 z-[90] rounded border border-amber-700 bg-amber-950/90 px-3 py-2 text-xs font-semibold text-amber-200 shadow-lg">
          {hotkeyToast}
        </div>
      )}

      {paletteOpen && !locked && (
        <CommandPalette
          items={visibleNavItems}
          onNavigate={(to) => {
            setPaletteOpen(false);
            navigate(to);
          }}
          onClose={() => setPaletteOpen(false)}
        />
      )}

      {showShortcuts && !locked && (
        <div className="animate-fade-in fixed inset-0 z-[95] grid place-items-center bg-black/70 p-4" onClick={() => setShowShortcuts(false)}>
          <div className="animate-scale-in w-full max-w-sm rounded-md border border-slate-700 bg-slate-950 p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase text-slate-50">Keyboard Shortcuts</h2>
              <button type="button" onClick={() => setShowShortcuts(false)} className="text-slate-400 hover:text-slate-200">✕</button>
            </div>
            <table className="w-full text-left text-xs">
              <tbody>
                {[
                  ["F1", "POS Billing"],
                  ["F2", "Receipt Entry"],
                  ["F3", "Day Book (managers/admins)"],
                  ["F4", "Inventory"],
                  ["Ctrl+K", "Go to any screen (command palette)"],
                  ["F8 / Ctrl+Enter", "Checkout the current bill (POS)"],
                  ["Enter", "Next field (POS) · select customer · add scanned item"],
                  ["Ctrl+L", "Lock the app"]
                ].map(([key, action]) => (
                  <tr key={key} className="border-b border-slate-800">
                    <td className="py-1.5 pr-3 font-mono font-semibold text-emerald-300">{key}</td>
                    <td className="py-1.5 text-slate-300">{action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {locked && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/95 backdrop-blur">
          <form onSubmit={unlockApp} className="grid w-80 gap-3 border border-slate-700 bg-slate-900 p-6 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-500 text-slate-50">
              <Lock className="h-6 w-6" />
            </div>
            <h2 className="text-sm font-semibold uppercase text-slate-50">App Locked</h2>
            <p className="text-[11px] text-slate-400">Enter {session?.user.username ?? "your"} password to resume.</p>
            <input
              type="password"
              autoFocus
              value={unlockPassword}
              onChange={(event) => setUnlockPassword(event.target.value)}
              placeholder="Password"
              className="h-9 border border-slate-700 bg-slate-950 px-3 text-sm text-slate-50 outline-none focus:border-emerald-400"
            />
            {unlockError && <p className="text-[11px] font-semibold text-red-300">{unlockError}</p>}
            <button type="submit" className="h-9 bg-emerald-500 text-xs font-bold uppercase text-slate-50 hover:bg-emerald-600">Unlock</button>
          </form>
        </div>
      )}
    </div>
  );
}

// Ctrl+K palette: fuzzy-ish substring match over the role-filtered nav list,
// arrow keys + Enter to jump. Keyboard-first navigation for all modules.
function CommandPalette({
  items,
  onNavigate,
  onClose
}: {
  items: NavigationItem[];
  onNavigate: (to: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      const label = item.label.toLowerCase();
      // Match label substring, or all query words in order (e.g. "gst rep").
      if (label.includes(q)) return true;
      return q.split(/\s+/).every((word) => label.includes(word));
    });
  }, [items, query]);

  const clampedHighlight = Math.min(highlighted, Math.max(matches.length - 1, 0));

  return (
    <div className="animate-fade-in fixed inset-0 z-[95] grid place-items-start justify-center bg-black/70 p-4 pt-24" onClick={onClose}>
      <div className="animate-scale-in w-full max-w-md rounded-md border border-slate-700 bg-slate-950 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlighted(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              setHighlighted((i) => Math.min(i + 1, matches.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setHighlighted((i) => Math.max(i - 1, 0));
            } else if (event.key === "Enter" && matches[clampedHighlight]) {
              event.preventDefault();
              onNavigate(matches[clampedHighlight].to);
            }
          }}
          placeholder="Go to… (type a screen name)"
          className="h-11 w-full border-b border-slate-800 bg-transparent px-4 text-sm text-slate-50 outline-none placeholder:text-slate-500"
        />
        <ul className="max-h-80 overflow-y-auto p-1">
          {matches.map((item, index) => (
            <li key={item.to}>
              <button
                type="button"
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => onNavigate(item.to)}
                className={`flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide ${
                  index === clampedHighlight ? "bg-emerald-500 text-slate-50" : "text-slate-300"
                }`}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
                {routeHotkeys.has(item.to) && (
                  <span className={`ml-auto font-mono text-[10px] ${index === clampedHighlight ? "text-emerald-100" : "text-slate-500"}`}>
                    {routeHotkeys.get(item.to)}
                  </span>
                )}
              </button>
            </li>
          ))}
          {matches.length === 0 && <li className="px-3 py-3 text-center text-xs text-slate-500">No screen matches &ldquo;{query}&rdquo;.</li>}
        </ul>
        <div className="border-t border-slate-800 px-3 py-1.5 text-[10px] uppercase tracking-wide text-slate-600">
          ↑↓ navigate · Enter open · Esc close
        </div>
      </div>
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
