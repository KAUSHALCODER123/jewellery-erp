import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Coins, Plus, Scale, TrendingUp } from "lucide-react";
import { useAuthSession } from "../auth/AuthSessionContext.js";

type MetalLoanModuleProps = { apiBaseUrl?: string };

type ActiveTab = "register" | "issue";

type Supplier = { id: number; name: string; phone: string | null };

type Fixing = {
  id: number;
  fixing_date: string;
  fine_weight_fixed_g: string;
  rate_rupees_per_gram: string;
  amount_rupees: string;
  notes: string | null;
};

type Loan = {
  id: number;
  loan_number: string;
  supplier_id: number;
  supplier_name: string | null;
  metal_type: string;
  issue_date: string;
  gross_weight_g: string;
  fine_weight_g: string;
  fine_outstanding_g: string;
  fine_fixed_g: string;
  fine_outstanding_mg: number;
  purity_percent: string;
  fixed_amount_rupees: string;
  status: "UNFIXED" | "PARTIALLY_FIXED" | "FIXED";
  notes: string | null;
  fixings: Fixing[];
};

type Summary = {
  open_loans: number;
  total_loans: number;
  fine_outstanding_g: string;
  fixed_amount_rupees: string;
};

const controlClassName =
  "h-8 w-full border border-slate-700 bg-slate-950 px-2 text-xs text-white outline-none focus:border-emerald-400 transition-colors rounded-sm";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function gramsToMg(value: string): number {
  const match = value.trim().match(/^(\d+)(?:\.(\d{1,3}))?$/);
  if (!match) return 0;
  const frac = (match[2] ?? "").padEnd(3, "0");
  return Number(match[1]) * 1000 + Number(frac);
}

function rupeesToPaise(value: string): number {
  const match = value.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return 0;
  const frac = (match[2] ?? "").padEnd(2, "0");
  return Number(match[1]) * 100 + Number(frac);
}

export default function MetalLoanModule({ apiBaseUrl = "" }: MetalLoanModuleProps) {
  const { session } = useAuthSession();
  const [activeTab, setActiveTab] = useState<ActiveTab>("register");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [summary, setSummary] = useState<Summary | null>(null);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [statusFilter, setStatusFilter] = useState<"" | "UNFIXED" | "PARTIALLY_FIXED" | "FIXED">("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // Issue form
  const [supplierId, setSupplierId] = useState("");
  const [newSupplierName, setNewSupplierName] = useState("");
  const [issueDate, setIssueDate] = useState(todayIso());
  const [metalType, setMetalType] = useState("Gold");
  const [grossGrams, setGrossGrams] = useState("");
  const [purityPercent, setPurityPercent] = useState("99.99");
  const [notes, setNotes] = useState("");

  // Fix-rate form (per loan)
  const [fixLoanId, setFixLoanId] = useState<number | null>(null);
  const [fixGrams, setFixGrams] = useState("");
  const [fixRate, setFixRate] = useState("");
  const [fixAll, setFixAll] = useState(true);

  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${session?.token ?? ""}` }), [session?.token]);

  const loadAll = useCallback(async () => {
    try {
      const qs = statusFilter ? `?status=${statusFilter}` : "";
      const [loansRes, sumRes, supRes] = await Promise.all([
        fetch(`${apiBaseUrl}/api/metal-loans${qs}`, { headers: authHeaders }),
        fetch(`${apiBaseUrl}/api/metal-loans/summary`, { headers: authHeaders }),
        fetch(`${apiBaseUrl}/api/suppliers`, { headers: authHeaders })
      ]);
      const loansData = await loansRes.json();
      const sumData = await sumRes.json();
      const supData = await supRes.json();
      setLoans(loansRes.ok && Array.isArray(loansData.loans) ? loansData.loans : []);
      setSummary(sumRes.ok ? sumData : null);
      setSuppliers(supRes.ok && Array.isArray(supData.suppliers) ? supData.suppliers : []);
    } catch {
      setLoans([]);
    }
  }, [apiBaseUrl, authHeaders, statusFilter]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const ensureSupplier = async (): Promise<number | null> => {
    if (supplierId) return Number(supplierId);
    if (!newSupplierName.trim()) return null;
    const res = await fetch(`${apiBaseUrl}/api/suppliers`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ name: newSupplierName.trim() })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.errors?.join(" ") || "Failed to add supplier.");
    return data.supplier.id as number;
  };

  const submitLoan = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (gramsToMg(grossGrams) <= 0) {
      setError("Enter a valid gross weight in grams.");
      return;
    }
    setBusy(true);
    try {
      const resolvedSupplier = await ensureSupplier();
      if (!resolvedSupplier) {
        setError("Select a supplier or enter a new supplier name.");
        setBusy(false);
        return;
      }
      const res = await fetch(`${apiBaseUrl}/api/metal-loans`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          supplier_id: resolvedSupplier,
          metal_type: metalType,
          issue_date: issueDate,
          gross_weight_mg: gramsToMg(grossGrams),
          purity_basis_points: Math.round(Number(purityPercent) * 100),
          notes: notes.trim() || null
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.errors?.join(" ") || "Failed to create loan.");
      setMessage(`Metal loan ${data.loan.loan_number} created — owing ${data.loan.fine_weight_g} g fine.`);
      setGrossGrams("");
      setNotes("");
      setNewSupplierName("");
      setActiveTab("register");
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create loan.");
    } finally {
      setBusy(false);
    }
  };

  const openFix = (loan: Loan) => {
    setFixLoanId(loan.id);
    setFixAll(true);
    setFixGrams(loan.fine_outstanding_g);
    setFixRate("");
    setError("");
    setMessage("");
  };

  const submitFix = async (loan: Loan) => {
    if (rupeesToPaise(fixRate) <= 0) {
      setError("Enter the rate per gram (Rs).");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${apiBaseUrl}/api/metal-loans/${loan.id}/fix`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          rate_paise_per_gram: rupeesToPaise(fixRate),
          fix_all: fixAll,
          fine_weight_fixed_mg: fixAll ? undefined : gramsToMg(fixGrams),
          fixing_date: todayIso()
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.errors?.join(" ") || "Failed to fix rate.");
      setMessage(`Fixed rate on ${loan.loan_number}. Outstanding now ${data.loan.fine_outstanding_g} g.`);
      setFixLoanId(null);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fix rate.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="grid h-screen grid-rows-[auto_auto_auto_1fr] overflow-hidden bg-slate-950 text-slate-100 font-sans">
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-3 py-2">
        <div>
          <h1 className="flex items-center gap-2 text-sm font-semibold uppercase text-white tracking-wide">
            <Coins size={16} className="text-amber-400" /> Metal Loan / Unfixed Purchase
          </h1>
          <p className="text-xs text-slate-400">Gold borrowed in fine grams; fix the rate later to settle in rupees</p>
        </div>
        <nav className="flex border border-slate-700 text-xs">
          <button type="button" onClick={() => setActiveTab("register")} className={tabClass(activeTab === "register")}>Loan Register</button>
          <button type="button" onClick={() => setActiveTab("issue")} className={tabClass(activeTab === "issue")}>New Metal Loan</button>
        </nav>
      </header>

      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-3 border-b border-slate-800 bg-slate-900/40 p-3">
        <SummaryBox icon={<Scale size={16} className="text-amber-400" />} label="Fine Gold Owed" value={summary ? `${summary.fine_outstanding_g} g` : "—"} tone="amber" />
        <SummaryBox icon={<TrendingUp size={16} className="text-emerald-400" />} label="Open Loans" value={summary ? `${summary.open_loans} / ${summary.total_loans}` : "—"} tone="slate" />
        <SummaryBox icon={<Coins size={16} className="text-emerald-400" />} label="Fixed Value (payable)" value={summary ? `Rs ${summary.fixed_amount_rupees}` : "—"} tone="emerald" />
      </div>

      {(message || error) && (
        <div className={`border-b border-slate-800 px-3 py-1.5 text-xs font-semibold ${error ? "bg-red-950/50 text-red-200" : "bg-emerald-950/40 text-emerald-200"}`}>
          {error || message}
        </div>
      )}

      <main className="min-h-0 overflow-hidden">
        {activeTab === "issue" ? (
          <form onSubmit={submitLoan} className="mx-auto grid w-full max-w-2xl content-start gap-3 overflow-auto p-5">
            <h2 className="text-xs font-bold uppercase text-white tracking-wide">Record Gold Taken on Loan</h2>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-[10px] font-bold uppercase text-slate-400">
                Existing Supplier
                <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={controlClassName}>
                  <option value="">— select —</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-[10px] font-bold uppercase text-slate-400">
                …or New Supplier Name
                <input value={newSupplierName} onChange={(e) => setNewSupplierName(e.target.value)} className={controlClassName} placeholder="Adds a supplier" disabled={!!supplierId} />
              </label>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <label className="grid gap-1 text-[10px] font-bold uppercase text-slate-400">
                Issue Date
                <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className={controlClassName} />
              </label>
              <label className="grid gap-1 text-[10px] font-bold uppercase text-slate-400">
                Metal
                <input value={metalType} onChange={(e) => setMetalType(e.target.value)} className={controlClassName} />
              </label>
              <label className="grid gap-1 text-[10px] font-bold uppercase text-slate-400">
                Purity %
                <input value={purityPercent} onChange={(e) => setPurityPercent(e.target.value.replace(/[^\d.]/g, ""))} className={controlClassName} inputMode="decimal" placeholder="99.99" />
              </label>
            </div>
            <label className="grid gap-1 text-[10px] font-bold uppercase text-slate-400">
              Gross Weight (grams)
              <input value={grossGrams} onChange={(e) => setGrossGrams(e.target.value.replace(/[^\d.]/g, ""))} className={controlClassName} inputMode="decimal" placeholder="0.000" />
            </label>
            <div className="rounded border border-amber-900/50 bg-amber-950/10 px-3 py-2 text-[11px] text-amber-300">
              Fine gold owed ≈ <strong>{(gramsToMg(grossGrams) * (Number(purityPercent) || 0) / 100 / 1000).toFixed(3)} g</strong> (gross × purity). This is the gram liability until you fix the rate.
            </div>
            <label className="grid gap-1 text-[10px] font-bold uppercase text-slate-400">
              Notes
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="h-16 w-full border border-slate-700 bg-slate-950 p-2 text-xs text-white outline-none focus:border-emerald-400" />
            </label>
            <button type="submit" disabled={busy} className="h-10 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 disabled:text-slate-500 text-xs font-bold uppercase text-slate-950 transition-colors">
              {busy ? "Saving..." : "Record Metal Loan"}
            </button>
          </form>
        ) : (
          <div className="grid h-full grid-rows-[auto_1fr] overflow-hidden">
            <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-900/60 px-4 py-2">
              <span className="text-[10px] font-bold uppercase text-slate-400">Filter</span>
              {(["", "UNFIXED", "PARTIALLY_FIXED", "FIXED"] as const).map((s) => (
                <button key={s || "ALL"} type="button" onClick={() => setStatusFilter(s)} className={`px-2 py-1 text-[10px] font-bold uppercase rounded ${statusFilter === s ? "bg-amber-500 text-slate-950" : "bg-slate-950 text-slate-400 hover:text-white"}`}>
                  {s ? s.replace("_", " ") : "All"}
                </button>
              ))}
            </div>
            <div className="min-h-0 overflow-auto p-4">
              {loans.length === 0 ? (
                <p className="text-center text-slate-500 py-16 uppercase text-xs font-semibold">No metal loans in this view.</p>
              ) : (
                <div className="grid gap-3">
                  {loans.map((loan) => {
                    const expanded = expandedId === loan.id;
                    const fixing = fixLoanId === loan.id;
                    return (
                      <div key={loan.id} className="rounded-lg border border-slate-800 bg-slate-900">
                        <div className="flex items-center justify-between gap-3 p-3">
                          <button type="button" onClick={() => setExpandedId(expanded ? null : loan.id)} className="min-w-0 flex-1 text-left">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm font-semibold text-white">{loan.loan_number}</span>
                              <StatusBadge status={loan.status} />
                            </div>
                            <div className="mt-0.5 text-[11px] text-slate-400">
                              {loan.supplier_name || "—"} · {loan.metal_type} {loan.purity_percent}% · Issued {loan.issue_date}
                            </div>
                          </button>
                          <div className="text-right text-[11px]">
                            <div className="text-amber-400 font-mono font-semibold">{loan.fine_outstanding_g} g owed</div>
                            <div className="text-slate-500">of {loan.fine_weight_g} g</div>
                          </div>
                          {loan.status !== "FIXED" && (
                            <button type="button" onClick={() => openFix(loan)} className="rounded bg-amber-500 px-3 py-1.5 text-[11px] font-bold uppercase text-slate-950 hover:bg-amber-400">
                              Fix Rate
                            </button>
                          )}
                        </div>

                        {fixing && (
                          <div className="border-t border-slate-800 bg-slate-950/40 p-3">
                            <h3 className="mb-2 text-[10px] font-bold uppercase text-amber-300">Fix Rate — {loan.fine_outstanding_g} g outstanding</h3>
                            <div className="grid grid-cols-[auto_1fr_1fr_auto] items-end gap-3">
                              <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-slate-400">
                                <input type="checkbox" checked={fixAll} onChange={(e) => { setFixAll(e.target.checked); if (e.target.checked) setFixGrams(loan.fine_outstanding_g); }} className="h-4 w-4 accent-amber-500" />
                                Fix all
                              </label>
                              <label className="grid gap-1 text-[10px] font-bold uppercase text-slate-400">
                                Fine grams to fix
                                <input value={fixGrams} onChange={(e) => setFixGrams(e.target.value.replace(/[^\d.]/g, ""))} disabled={fixAll} className={controlClassName} inputMode="decimal" />
                              </label>
                              <label className="grid gap-1 text-[10px] font-bold uppercase text-slate-400">
                                Rate / gram (Rs)
                                <input value={fixRate} onChange={(e) => setFixRate(e.target.value.replace(/[^\d.]/g, ""))} className={controlClassName} inputMode="decimal" placeholder="e.g. 7250" />
                              </label>
                              <button type="button" disabled={busy} onClick={() => submitFix(loan)} className="h-8 rounded bg-emerald-500 px-3 text-[11px] font-bold uppercase text-slate-950 hover:bg-emerald-400 disabled:opacity-50">
                                Confirm
                              </button>
                            </div>
                            <p className="mt-2 text-[10px] text-slate-500">
                              Value ≈ Rs {((fixAll ? gramsToMg(loan.fine_outstanding_g) : gramsToMg(fixGrams)) / 1000 * (Number(fixRate) || 0)).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                            </p>
                          </div>
                        )}

                        {expanded && (
                          <div className="border-t border-slate-800 p-3">
                            <div className="mb-2 grid grid-cols-4 gap-2 text-[11px]">
                              <Stat label="Fine owed (orig.)" value={`${loan.fine_weight_g} g`} />
                              <Stat label="Fixed" value={`${loan.fine_fixed_g} g`} />
                              <Stat label="Outstanding" value={`${loan.fine_outstanding_g} g`} />
                              <Stat label="Fixed value" value={`Rs ${loan.fixed_amount_rupees}`} />
                            </div>
                            {loan.fixings.length > 0 ? (
                              <table className="w-full text-left text-xs border-collapse">
                                <thead>
                                  <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase text-[10px]">
                                    <th className="px-2 py-1">Date</th>
                                    <th className="px-2 py-1 text-right">Fine Fixed</th>
                                    <th className="px-2 py-1 text-right">Rate/g</th>
                                    <th className="px-2 py-1 text-right">Amount</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {loan.fixings.map((f) => (
                                    <tr key={f.id} className="border-b border-slate-900 font-mono">
                                      <td className="px-2 py-1.5 font-sans text-slate-400">{f.fixing_date}</td>
                                      <td className="px-2 py-1.5 text-right text-slate-300">{f.fine_weight_fixed_g} g</td>
                                      <td className="px-2 py-1.5 text-right text-slate-300">Rs {f.rate_rupees_per_gram}</td>
                                      <td className="px-2 py-1.5 text-right text-emerald-400">Rs {f.amount_rupees}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : (
                              <p className="text-[11px] text-slate-500">No rate fixings yet — full {loan.fine_weight_g} g still floats with the market.</p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </section>
  );
}

function tabClass(active: boolean) {
  return `h-8 border-r border-slate-700 px-3 font-semibold uppercase text-[10px] tracking-wide last:border-r-0 cursor-pointer transition-colors ${active ? "bg-amber-500 text-slate-950 font-bold" : "bg-slate-950 text-slate-400 hover:text-white"}`;
}

function SummaryBox({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: "amber" | "emerald" | "slate" }) {
  const color = tone === "amber" ? "text-amber-400" : tone === "emerald" ? "text-emerald-400" : "text-white";
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2">
      {icon}
      <div className="min-w-0">
        <div className="text-[9px] font-bold uppercase text-slate-500 tracking-wide">{label}</div>
        <div className={`truncate font-mono text-sm font-semibold ${color}`}>{value}</div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-slate-800 bg-slate-950 px-2 py-1.5">
      <div className="text-[9px] font-bold uppercase text-slate-500">{label}</div>
      <div className="font-mono text-xs text-slate-200">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: Loan["status"] }) {
  const map: Record<Loan["status"], string> = {
    UNFIXED: "bg-amber-950/60 text-amber-300",
    PARTIALLY_FIXED: "bg-blue-950/60 text-blue-300",
    FIXED: "bg-emerald-950/60 text-emerald-300"
  };
  return <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${map[status]}`}>{status.replace("_", " ")}</span>;
}
