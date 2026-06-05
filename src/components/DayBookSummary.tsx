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
  karigar_issued_fine_mg: number;
  karigar_received_fine_mg: number;
  cash_in_hand_paise: number;
  bank_balance_paise: number;
};

const grams = (mg: number) => `${(mg / 1000).toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} g`;

export default function DayBookSummary({ apiBaseUrl = "" }: DayBookSummaryProps) {
  const { session } = useAuthSession();
  const { toasts, push, dismiss } = useToasts();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (forDate: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/reports/daybook-summary?date=${forDate}`, {
        headers: { Authorization: `Bearer ${session?.token ?? ""}` }
      });
      const data = (await res.json().catch(() => null)) as (Summary & { errors?: string[] }) | null;
      if (!res.ok || !data || data.errors) {
        throw new Error(data?.errors?.join(" ") || "Failed to load day book.");
      }
      setSummary(data);
    } catch (err) {
      push(err instanceof Error ? err.message : "Failed to load day book.", "bad");
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, session?.token, push]);

  useEffect(() => { void load(date); }, [load, date]);

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
      ) : (
        <div className="grid place-items-center gap-2 py-16 text-slate-500">
          <Spinner className="h-6 w-6" />
          <p className="text-xs">Loading…</p>
        </div>
      )}
    </section>
  );
}
