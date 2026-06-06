import { useCallback, useEffect, useState } from "react";
import { RefreshCw, TrendingUp, TrendingDown, Recycle, Hammer, Wallet, Landmark, CalendarDays } from "lucide-react";
import { useAuthSession } from "../auth/AuthSessionContext.js";
import { MetricCard, CountUp, Spinner, Toaster, useToasts, rupees } from "./ui.js";

type DayBookSummaryProps = { apiBaseUrl?: string };

type Summary = {
  date: string;
  total_sales_paise: number;
  total_purchase_paise: number;
  total_urd_purchase_paise: number;
  total_expenses_paise?: number;
  karigar_issued_fine_mg: number;
  karigar_received_fine_mg: number;
  cash_in_hand_paise: number;
  bank_balance_paise: number;
  payment_modes?: {
    cash_received_paise: number;
    cash_paid_paise: number;
    bank_received_paise: number;
    bank_paid_paise: number;
  };
  cash_reconciliation?: {
    opening_cash_paise: number;
    cash_received_paise: number;
    cash_paid_paise: number;
    cash_expenses_paise?: number;
    closing_cash_paise: number;
  };
};

type JournalEntry = {
  id: number;
  created_at: string | null;
  ledger_name: string | null;
  transaction_type: "DEBIT" | "CREDIT";
  amount_paise: number;
  reference_type: string;
  reference_id: number | null;
  description: string | null;
};

type Journal = {
  opening_balance_paise: number;
  total_receipts_paise: number;
  total_payments_paise: number;
  closing_balance_paise: number;
  entries: JournalEntry[];
};

const grams = (mg: number) => `${(mg / 1000).toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} g`;

export default function DayBookSummary({ apiBaseUrl = "" }: DayBookSummaryProps) {
  const { session } = useAuthSession();
  const { toasts, push, dismiss } = useToasts();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [summary, setSummary] = useState<Summary | null>(null);
  const [journal, setJournal] = useState<Journal | null>(null);
  const [loading, setLoading] = useState(true);
  const [drawerCount, setDrawerCount] = useState("");
  const [expense, setExpense] = useState({ category: "", amountRupees: "", mode: "CASH", description: "" });

  const load = useCallback(async (forDate: string) => {
    setLoading(true);
    setDrawerCount("");
    try {
      const res = await fetch(`${apiBaseUrl}/api/reports/daybook-summary?date=${forDate}`, {
        headers: { Authorization: `Bearer ${session?.token ?? ""}` }
      });
      const data = (await res.json().catch(() => null)) as (Summary & { errors?: string[] }) | null;
      if (!res.ok || !data || data.errors) {
        throw new Error(data?.errors?.join(" ") || "Failed to load day book.");
      }
      setSummary(data);

      // Cash/Bank journal (admin-only). Absent for managers — render aggregates regardless.
      try {
        const jres = await fetch(`${apiBaseUrl}/api/accounts/daybook?date=${forDate}`, {
          headers: { Authorization: `Bearer ${session?.token ?? ""}` }
        });
        const jdata = (await jres.json().catch(() => null)) as Journal | null;
        setJournal(jres.ok && jdata && Array.isArray(jdata.entries) ? jdata : null);
      } catch {
        setJournal(null);
      }
    } catch (err) {
      push(err instanceof Error ? err.message : "Failed to load day book.", "bad");
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, session?.token, push]);

  useEffect(() => { void load(date); }, [load, date]);

  async function addExpense() {
    const amountPaise = expense.amountRupees.trim() ? Math.round(Number(expense.amountRupees) * 100) : 0;
    if (!expense.category.trim() || !Number.isFinite(amountPaise) || amountPaise <= 0) {
      push("Enter expense category and a positive amount.", "bad");
      return;
    }
    try {
      const res = await fetch(`${apiBaseUrl}/api/accounts/expenses`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.token ?? ""}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          expense_date: date,
          category: expense.category.trim(),
          amount_paise: amountPaise,
          payment_mode: expense.mode,
          description: expense.description.trim() || null
        })
      });
      const data = (await res.json().catch(() => null)) as { errors?: string[] } | null;
      if (!res.ok) throw new Error(data?.errors?.join(" ") || "Failed to record expense.");
      push("Expense recorded.", "good");
      setExpense({ category: "", amountRupees: "", mode: "CASH", description: "" });
      void load(date);
    } catch (err) {
      push(err instanceof Error ? err.message : "Failed to record expense.", "bad");
    }
  }

  return (
    <section className="min-h-full bg-slate-950 p-4 text-slate-100">
      <Toaster toasts={toasts} onDismiss={dismiss} />

      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-white">Day Book</h1>
          <p className="text-xs text-slate-400">End-of-day business summary — sales, purchases, old gold, karigar metal & cash position.</p>
        </div>
        <div className="flex items-end gap-2">
          <label className="grid gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Date
            <div className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2">
              <CalendarDays className="h-3.5 w-3.5 text-slate-500" />
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="bg-transparent py-1.5 text-sm text-white outline-none"
              />
            </div>
          </label>
          <button
            onClick={() => void load(date)}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-emerald-600 hover:text-emerald-300 active:scale-95"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </header>

      {loading && !summary ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="erp-skeleton h-20 rounded-lg" />
          ))}
        </div>
      ) : summary ? (
        <>
        <div className={`grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 transition-opacity ${loading ? "opacity-60" : "opacity-100"}`}>
          <MetricCard label="Total Sales" icon={TrendingUp} accent="emerald" delayMs={0}>
            <CountUp value={summary.total_sales_paise} format={(n) => rupees(n)} />
          </MetricCard>
          <MetricCard label="Total Purchase" icon={TrendingDown} accent="rose" delayMs={40}>
            <CountUp value={summary.total_purchase_paise} format={(n) => rupees(n)} />
          </MetricCard>
          <MetricCard label="Old Gold / URD" icon={Recycle} accent="amber" delayMs={80}>
            <CountUp value={summary.total_urd_purchase_paise} format={(n) => rupees(n)} />
          </MetricCard>
          <MetricCard label="Total Expenses" icon={TrendingDown} accent="rose" delayMs={100}>
            <CountUp value={summary.total_expenses_paise ?? 0} format={(n) => rupees(n)} />
          </MetricCard>
          <MetricCard label="Cash In Hand" icon={Wallet} accent="emerald" delayMs={120}>
            <CountUp value={summary.cash_in_hand_paise} format={(n) => rupees(n)} />
          </MetricCard>
          <MetricCard label="Bank Balance" icon={Landmark} accent="sky" delayMs={160}>
            <CountUp value={summary.bank_balance_paise} format={(n) => rupees(n)} />
          </MetricCard>
          <MetricCard label="Karigar Issued (fine)" icon={Hammer} accent="violet" delayMs={200} hint="Gold given to karigars">
            <CountUp value={summary.karigar_issued_fine_mg} format={grams} />
          </MetricCard>
          <MetricCard label="Karigar Received (fine)" icon={Hammer} accent="violet" delayMs={240} hint="Gold reconciled back">
            <CountUp value={summary.karigar_received_fine_mg} format={grams} />
          </MetricCard>
          <MetricCard label="Net Cash + Bank" icon={Wallet} accent="slate" delayMs={280}>
            <CountUp value={summary.cash_in_hand_paise + summary.bank_balance_paise} format={(n) => rupees(n)} />
          </MetricCard>
        </div>

        {summary.payment_modes && (
          <div className="mt-5">
            <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Till Tally — day's money in/out by mode</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <MetricCard label="Cash Received" icon={TrendingUp} accent="emerald" delayMs={0}>
                <CountUp value={summary.payment_modes.cash_received_paise} format={(n) => rupees(n)} />
              </MetricCard>
              <MetricCard label="Bank/UPI/Cheque In" icon={Landmark} accent="sky" delayMs={40}>
                <CountUp value={summary.payment_modes.bank_received_paise} format={(n) => rupees(n)} />
              </MetricCard>
              <MetricCard label="Cash Paid Out" icon={TrendingDown} accent="rose" delayMs={80}>
                <CountUp value={summary.payment_modes.cash_paid_paise} format={(n) => rupees(n)} />
              </MetricCard>
              <MetricCard label="Bank Paid Out" icon={TrendingDown} accent="rose" delayMs={120}>
                <CountUp value={summary.payment_modes.bank_paid_paise} format={(n) => rupees(n)} />
              </MetricCard>
            </div>
          </div>
        )}

        {summary.cash_reconciliation && (() => {
          const recon = summary.cash_reconciliation;
          const counted = drawerCount.trim() ? Math.round(Number(drawerCount) * 100) : null;
          const variance = counted === null || Number.isNaN(counted) ? null : counted - recon.closing_cash_paise;
          return (
            <div className="mt-5 max-w-xl rounded-lg border border-slate-800 bg-slate-900 p-4">
              <h2 className="mb-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">Cash Drawer Reconciliation</h2>
              <div className="grid gap-1 text-sm">
                <ReconRow label="Opening Cash" value={rupees(recon.opening_cash_paise)} />
                <ReconRow label="+ Cash Received" value={rupees(recon.cash_received_paise)} tone="pos" />
                <ReconRow label="− Cash Paid Out" value={rupees(recon.cash_paid_paise)} tone="neg" />
                {recon.cash_expenses_paise !== undefined && recon.cash_expenses_paise > 0 && (
                  <ReconRow label="   ↳ incl. Cash Expenses" value={rupees(recon.cash_expenses_paise)} tone="neg" />
                )}
                <div className="my-1 border-t border-slate-700" />
                <ReconRow label="= Computed Cash Closing" value={rupees(recon.closing_cash_paise)} bold />
              </div>
              <label className="mt-3 grid gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                Counted in Drawer (Rs)
                <input
                  type="number"
                  step="0.01"
                  value={drawerCount}
                  onChange={(e) => setDrawerCount(e.target.value)}
                  placeholder="Enter physical cash count"
                  className="h-9 rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-white outline-none focus:border-emerald-500"
                />
              </label>
              {variance !== null && (
                <div className={`mt-3 rounded-md border px-3 py-2 text-sm font-semibold ${variance === 0 ? "border-emerald-600 bg-emerald-950/40 text-emerald-200" : "border-red-600 bg-red-950/40 text-red-200"}`}>
                  {variance === 0 ? "✓ Drawer matches — tally OK" : `Variance: ${rupees(variance)} (${variance > 0 ? "excess" : "short"})`}
                </div>
              )}
            </div>
          );
        })()}

        <div className="mt-3 max-w-xl rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">Record Expense (Cash / Bank)</h2>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <input value={expense.category} onChange={(e) => setExpense({ ...expense, category: e.target.value })} placeholder="Category (Rent…)" className="h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-white outline-none focus:border-emerald-500" />
            <input value={expense.amountRupees} onChange={(e) => setExpense({ ...expense, amountRupees: e.target.value })} type="number" step="0.01" placeholder="Amount (Rs)" className="h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-white outline-none focus:border-emerald-500" />
            <select value={expense.mode} onChange={(e) => setExpense({ ...expense, mode: e.target.value })} className="h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-white outline-none focus:border-emerald-500">
              <option value="CASH">Cash</option>
              <option value="BANK">Bank</option>
            </select>
            <input value={expense.description} onChange={(e) => setExpense({ ...expense, description: e.target.value })} placeholder="Note (optional)" className="h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-white outline-none focus:border-emerald-500" />
          </div>
          <button onClick={() => void addExpense()} className="mt-3 h-8 rounded-md bg-emerald-500 px-4 text-xs font-bold uppercase text-slate-950 hover:bg-emerald-600">
            Add Expense
          </button>
        </div>

        {journal && (
          <div className="mt-5">
            <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Cash &amp; Bank Journal — every entry today</h2>
            <div className="overflow-auto rounded-lg border border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-900 text-[10px] uppercase text-slate-500">
                  <tr>
                    <th className="px-2 py-1.5">Time</th>
                    <th className="px-2 py-1.5">Account</th>
                    <th className="px-2 py-1.5">Type</th>
                    <th className="px-2 py-1.5 text-right">Amount</th>
                    <th className="px-2 py-1.5">Reference</th>
                    <th className="px-2 py-1.5">Narration</th>
                  </tr>
                </thead>
                <tbody>
                  {journal.entries.length === 0 ? (
                    <tr><td colSpan={6} className="px-2 py-4 text-center text-slate-500">No cash/bank movement on this date.</td></tr>
                  ) : journal.entries.map((entry) => (
                    <tr key={entry.id} className="border-t border-slate-900">
                      <td className="px-2 py-1.5 font-mono text-slate-400">{(entry.created_at ?? "").slice(11, 19) || "-"}</td>
                      <td className="px-2 py-1.5">{entry.ledger_name ?? "-"}</td>
                      <td className={`px-2 py-1.5 font-semibold ${entry.transaction_type === "DEBIT" ? "text-emerald-300" : "text-rose-300"}`}>{entry.transaction_type === "DEBIT" ? "IN" : "OUT"}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{rupees(entry.amount_paise)}</td>
                      <td className="px-2 py-1.5 text-slate-400">{entry.reference_type}{entry.reference_id ? ` #${entry.reference_id}` : ""}</td>
                      <td className="px-2 py-1.5 text-slate-400">{entry.description ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        </>
      ) : (
        <div className="grid place-items-center gap-2 py-16 text-slate-500">
          <Spinner className="h-6 w-6" />
          <p className="text-xs">Loading…</p>
        </div>
      )}
    </section>
  );
}

function ReconRow({ label, value, tone, bold }: { label: string; value: string; tone?: "pos" | "neg"; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`${bold ? "font-bold text-white" : "text-slate-400"}`}>{label}</span>
      <span className={`font-mono ${bold ? "font-bold text-white" : tone === "pos" ? "text-emerald-300" : tone === "neg" ? "text-rose-300" : "text-slate-200"}`}>{value}</span>
    </div>
  );
}
