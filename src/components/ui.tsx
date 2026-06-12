import type { ComponentType, FocusEvent, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Select a field's contents on focus so the first keystroke replaces a pre-filled
 * or default value (e.g. purity "99.99", qty "1") instead of appending to it.
 * Use as `onFocus={selectOnFocus}` on numeric/text inputs that start with a value.
 */
export function selectOnFocus(event: FocusEvent<HTMLInputElement>) {
  event.currentTarget.select();
}

/**
 * Required-field marker. Drop next to a label so staff can tell at a glance
 * which fields block submission: `<label>Phone <Req /></label>`. Pair it with a
 * single "* Required" legend per form.
 */
export function Req() {
  return <span className="font-bold text-rose-400" title="Required" aria-hidden="true">*</span>;
}

/** Inline loading spinner. */
export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Shimmer placeholder rows for a data table while it loads, so a slow fetch
 * reads as "loading" instead of a frozen blank screen. Drop into <tbody>:
 * `{loading ? <SkeletonRows rows={5} cols={7} /> : data.map(...)}`
 */
export function SkeletonRows({ rows = 5, cols }: { rows?: number; cols: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} className="animate-pulse border-b border-slate-900">
          {Array.from({ length: cols }, (_, c) => (
            <td key={c} className="px-2 py-2.5">
              <div className="h-3 rounded bg-slate-800" style={{ width: `${55 + ((r * 7 + c * 13) % 40)}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
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
      className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-50 transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${toneClass} ${className}`}
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

// ── Date input (DD/MM/YYYY) ────────────────────────────────────────────
// Native <input type="date"> renders in the OS locale (often MM/DD/YYYY on
// en-US installs), which misleads Indian billing staff who read dates as
// DD/MM/YYYY. DateInput is a drop-in replacement that *displays and accepts*
// typed DD/MM/YYYY while still storing/emitting ISO yyyy-mm-dd (so component
// state and the API contract are unchanged). The calendar icon opens the real
// native date picker for mouse users.
//
// Migration: `<input type="date" value={x} onChange={(e) => setX(e.target.value)} className={cls} />`
//        ->  `<DateInput value={x} onChange={setX} className={cls} />`
// The onChange callback receives the ISO string directly (not an event).

function isoToDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

function displayToIso(text: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(year, month - 1, day);
  // Reject impossible dates (e.g. 31/02) that JS would roll forward.
  if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function DateInput({
  value,
  onChange,
  className = "",
  min,
  max,
  required,
  disabled,
  showIcon = true,
  ...rest
}: {
  value: string;
  onChange: (iso: string) => void;
  className?: string;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  showIcon?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "min" | "max" | "type">) {
  const [text, setText] = useState(() => isoToDisplay(value));

  // Re-sync the visible text whenever the ISO value changes from outside
  // (parent reset, calendar pick, etc.).
  useEffect(() => {
    setText(isoToDisplay(value));
  }, [value]);

  function commit(raw: string) {
    const trimmed = raw.trim();
    if (trimmed === "") {
      onChange("");
      return;
    }
    const iso = displayToIso(trimmed);
    if (iso) onChange(iso);
    else setText(isoToDisplay(value)); // revert an unparseable entry
  }

  return (
    <div className={`relative flex items-center ${className}`}>
      <input
        {...rest}
        type="text"
        inputMode="numeric"
        placeholder="DD/MM/YYYY"
        value={text}
        disabled={disabled}
        required={required}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
          rest.onKeyDown?.(e);
        }}
        className="h-full w-full min-w-0 bg-transparent outline-none placeholder:text-slate-600"
      />
      {showIcon && (
        <span className="pointer-events-none relative ml-1 grid h-4 w-4 shrink-0 place-items-center text-slate-500">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
          {/* Invisible native date input overlays the icon: clicking it opens the
              real calendar popup. Its own rendered format is hidden, so locale
              never leaks to the user — only the ISO value flows back. */}
          <input
            type="date"
            value={value}
            min={min}
            max={max}
            disabled={disabled}
            tabIndex={-1}
            aria-label="Open calendar"
            onChange={(e) => onChange(e.target.value)}
            className="pointer-events-auto absolute inset-0 cursor-pointer opacity-0"
          />
        </span>
      )}
    </div>
  );
}
