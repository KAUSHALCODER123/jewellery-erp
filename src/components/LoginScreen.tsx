import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { Building2, Calendar, Lock, LogIn, User } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.js";

type FirmOption = {
  id: number;
  key: string;
  display_name: string;
  gstin: string | null;
};

function getIndianFiscalYears(): { label: string; value: string; start: string; end: string }[] {
  const today = new Date();
  const currentCalYear = today.getFullYear();
  const fyStartYear = today.getMonth() >= 3 ? currentCalYear : currentCalYear - 1;

  return Array.from({ length: 5 }, (_, i) => {
    const start = fyStartYear - i;
    const end = start + 1;
    return {
      label: `${start}-${String(end).slice(2)}`,
      value: `${start}-${String(end).slice(2)}`,
      start: `${start}-04-01`,
      end: `${end}-03-31`
    };
  });
}

export default function LoginScreen() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [firmKey, setFirmKey] = useState("");
  const [fiscalYear, setFiscalYear] = useState("");
  const [firms, setFirms] = useState<FirmOption[]>([]);
  const [firmsLoading, setFirmsLoading] = useState(true);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Synchronous latch: `isSubmitting` updates async on re-render, so a fast double-click can fire two
  // logins before the button visibly disables. The ref blocks the second submit in the same tick.
  const submittingRef = useRef(false);

  const fyOptions = getIndianFiscalYears();

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/auth/firms");
        const result = (await res.json().catch(() => null)) as { firms?: FirmOption[] } | null;
        const list = result?.firms ?? [];
        setFirms(list);
        if (list.length > 0) setFirmKey(list[0].key);
      } catch {
        setFirms([]);
      } finally {
        setFirmsLoading(false);
      }
    })();

    // Default fiscal year = current FY
    if (fyOptions.length > 0) setFiscalYear(fyOptions[0].value);
  }, []);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError("");
    setIsSubmitting(true);

    try {
      await login({
        username: username.trim().toLowerCase(),
        password,
        firm_key: firmKey || null,
        fiscal_year: fiscalYear || null
      });
      navigate("/dashboard", { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Login failed.");
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const selectedFirm = firms.find((f) => f.key === firmKey);
  const showFirmSelector = !firmsLoading && firms.length > 0;

  return (
    <section className="grid min-h-screen place-items-center bg-slate-950 px-4 py-8 text-slate-100">
      <form onSubmit={onSubmit} className="grid w-full max-w-sm gap-4 border border-slate-800 bg-slate-900 p-5 shadow-2xl shadow-black/40">
        <div className="grid gap-1">
          <p className="text-xs font-semibold uppercase text-emerald-300">Jewelry ERP</p>
          <h1 className="text-xl font-semibold text-white">Staff Login</h1>
        </div>

        {error && (
          <div className="border border-red-800 bg-red-950/70 px-3 py-2 text-sm text-red-100">
            {error}
          </div>
        )}

        {/* Firm selector */}
        {showFirmSelector && (
          <label className="grid gap-1 text-xs font-semibold uppercase text-slate-400">
            Firm / Entity
            <div className="grid grid-cols-[36px_1fr] border border-slate-700 bg-slate-950 focus-within:border-emerald-400">
              <span className="grid place-items-center border-r border-slate-800 text-slate-500">
                <Building2 size={16} />
              </span>
              <select
                value={firmKey}
                onChange={(e) => setFirmKey(e.target.value)}
                className="h-10 bg-transparent px-3 text-sm text-white outline-none"
              >
                {firms.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.display_name}{f.gstin ? ` — ${f.gstin}` : ""}
                  </option>
                ))}
              </select>
            </div>
          </label>
        )}

        {/* Fiscal year selector */}
        <label className="grid gap-1 text-xs font-semibold uppercase text-slate-400">
          Financial Year
          <div className="grid grid-cols-[36px_1fr] border border-slate-700 bg-slate-950 focus-within:border-emerald-400">
            <span className="grid place-items-center border-r border-slate-800 text-slate-500">
              <Calendar size={16} />
            </span>
            <select
              value={fiscalYear}
              onChange={(e) => setFiscalYear(e.target.value)}
              className="h-10 bg-transparent px-3 text-sm text-white outline-none"
            >
              {fyOptions.map((fy) => (
                <option key={fy.value} value={fy.value}>
                  FY {fy.label}  ({fy.start} to {fy.end})
                </option>
              ))}
            </select>
          </div>
        </label>

        <label className="grid gap-1 text-xs font-semibold uppercase text-slate-400">
          Username
          <div className="grid grid-cols-[36px_1fr] border border-slate-700 bg-slate-950 focus-within:border-emerald-400">
            <span className="grid place-items-center border-r border-slate-800 text-slate-500">
              <User size={16} />
            </span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="h-10 bg-transparent px-3 text-sm text-white outline-none"
              autoComplete="username"
            />
          </div>
        </label>

        <label className="grid gap-1 text-xs font-semibold uppercase text-slate-400">
          Password
          <div className="grid grid-cols-[36px_1fr] border border-slate-700 bg-slate-950 focus-within:border-emerald-400">
            <span className="grid place-items-center border-r border-slate-800 text-slate-500">
              <Lock size={16} />
            </span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-10 bg-transparent px-3 text-sm text-white outline-none"
              autoComplete="current-password"
            />
          </div>
        </label>

        {/* Selected context summary */}
        {(selectedFirm || fiscalYear) && (
          <div className="border border-emerald-900/60 bg-emerald-950/20 px-3 py-2 text-[11px] text-emerald-300">
            Logging into: <strong>{selectedFirm?.display_name ?? "Default Firm"}</strong>
            {fiscalYear ? ` · FY ${fiscalYear}` : ""}
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-grid h-10 grid-cols-[16px_1fr] items-center gap-2 bg-emerald-500 px-4 text-sm font-semibold uppercase text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
        >
          <LogIn size={16} />
          <span>{isSubmitting ? "Signing In…" : "Sign In"}</span>
        </button>
      </form>
    </section>
  );
}
