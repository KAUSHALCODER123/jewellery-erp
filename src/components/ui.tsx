import type { ComponentType, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

/** Inline loading spinner. */
export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

/** Number that animates from its previous value to the next on change. */
export function CountUp({ value, format, className }: { value: number; format?: (n: number) => string; className?: string }) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const from = fromRef.current;
    const to = value;
    if (from === to) {
      setDisplay(to);
      return;
    }
    const duration = 450;
    let startTs: number | null = null;

    // requestAnimationFrame does not fire in a backgrounded tab, under a headless/automation-driven
    // browser, or with reduced-motion preferences. Without a fallback the card would freeze at `from`
    // (e.g. 0) while the real data is already loaded — so snap to the target rather than animate there.
    const canAnimate =
      typeof window !== "undefined" &&
      typeof window.requestAnimationFrame === "function" &&
      !(typeof document !== "undefined" && document.hidden) &&
      !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (!canAnimate) {
      setDisplay(to);
      fromRef.current = to;
      return;
    }

    const tick = (ts: number) => {
      if (startTs === null) startTs = ts;
      const progress = Math.min((ts - startTs) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(from + (to - from) * eased);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    // Safety net: regardless of how the animation fares, guarantee the final value is committed.
    const settle = setTimeout(() => {
      setDisplay(to);
      fromRef.current = to;
    }, duration + 100);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      clearTimeout(settle);
      fromRef.current = to;
    };
  }, [value]);

  return <span className={className}>{format ? format(display) : Math.round(display).toString()}</span>;
}

type Accent = "emerald" | "amber" | "sky" | "rose" | "violet" | "slate";

const ACCENTS: Record<Accent, { ring: string; text: string; glow: string }> = {
  emerald: { ring: "border-emerald-700/50", text: "text-emerald-300", glow: "from-emerald-500/10" },
  amber: { ring: "border-amber-700/50", text: "text-amber-300", glow: "from-amber-500/10" },
  sky: { ring: "border-sky-700/50", text: "text-sky-300", glow: "from-sky-500/10" },
  rose: { ring: "border-rose-700/50", text: "text-rose-300", glow: "from-rose-500/10" },
  violet: { ring: "border-violet-700/50", text: "text-violet-300", glow: "from-violet-500/10" },
  slate: { ring: "border-slate-700/60", text: "text-slate-200", glow: "from-slate-500/10" }
};

/** KPI card with hover lift + entrance animation. */
export function MetricCard({
  label,
  children,
  icon: Icon,
  accent = "slate",
  hint,
  delayMs = 0
}: {
  label: string;
  children: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  accent?: Accent;
  hint?: string;
  delayMs?: number;
}) {
  const a = ACCENTS[accent];
  return (
    <div
      className={`animate-slide-up group relative overflow-hidden rounded-lg border ${a.ring} bg-slate-900/80 p-3 transition duration-200 hover:-translate-y-0.5 hover:border-slate-600 hover:shadow-lg hover:shadow-black/30`}
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${a.glow} to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100`} />
      <div className="relative flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
          <div className={`mt-1 font-mono text-lg font-semibold ${a.text}`}>{children}</div>
          {hint && <p className="mt-0.5 truncate text-[10px] text-slate-500">{hint}</p>}
        </div>
        {Icon && (
          <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-md border ${a.ring} bg-slate-950/50 ${a.text} transition-transform duration-200 group-hover:scale-110`}>
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>
    </div>
  );
}

export type BadgeTone = "neutral" | "good" | "warn" | "bad" | "info";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "border-slate-700 bg-slate-800/60 text-slate-300",
  good: "border-emerald-700 bg-emerald-950/40 text-emerald-300",
  warn: "border-amber-700 bg-amber-950/40 text-amber-300",
  bad: "border-rose-800 bg-rose-950/40 text-rose-300",
  info: "border-sky-700 bg-sky-950/40 text-sky-300"
};

export function StatusBadge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${BADGE_TONES[tone]}`}>
      {children}
    </span>
  );
}

/** Primary action button with built-in loading state + press feedback. */
export function ActionButton({
  loading,
  children,
  className = "",
  tone = "emerald",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; tone?: "emerald" | "sky" | "rose" }) {
  const toneClass =
    tone === "sky" ? "bg-sky-600 hover:bg-sky-500" : tone === "rose" ? "bg-rose-600 hover:bg-rose-500" : "bg-emerald-600 hover:bg-emerald-500";
  return (
    <button
      {...rest}
      disabled={loading || rest.disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${toneClass} ${className}`}
    >
      {loading && <Spinner className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

// ── Toasts ─────────────────────────────────────────────────────────────
export type Toast = { id: number; tone: BadgeTone; message: string };

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((message: string, tone: BadgeTone = "good") => {
    const id = idRef.current++;
    setToasts((current) => [...current, { id, tone, message }]);
    window.setTimeout(() => dismiss(id), 3200);
  }, [dismiss]);

  return { toasts, push, dismiss };
}

const TOAST_TONES: Record<BadgeTone, string> = {
  neutral: "border-slate-700 bg-slate-900 text-slate-200",
  good: "border-emerald-700 bg-emerald-950/90 text-emerald-200",
  warn: "border-amber-700 bg-amber-950/90 text-amber-200",
  bad: "border-rose-800 bg-rose-950/90 text-rose-200",
  info: "border-sky-700 bg-sky-950/90 text-sky-200"
};

export function Toaster({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[60] flex w-72 flex-col gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => onDismiss(t.id)}
          className={`animate-toast-in pointer-events-auto flex items-center gap-2 rounded-md border px-3 py-2 text-left text-xs font-medium shadow-lg shadow-black/40 ${TOAST_TONES[t.tone]}`}
        >
          <span className="flex-1">{t.message}</span>
          <span className="text-slate-500">✕</span>
        </button>
      ))}
    </div>
  );
}

export function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
