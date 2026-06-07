import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Gem, Plus, CalendarRange, Sparkles, CheckCircle2 } from "lucide-react";
import { useAuthSession } from "../auth/AuthSessionContext.js";
import { ActionButton, MetricCard, StatusBadge, Toaster, useToasts, rupees } from "./ui.js";

type GssSchemeBuilderProps = { apiBaseUrl?: string };

type Template = {
  id: number;
  scheme_code: string;
  scheme_name: string;
  scheme_type: "CASH" | "GOLD";
  duration_months: number;
  monthly_amount_paise: number;
  bonus_rule_type: "FIXED_AMOUNT" | "PERCENTAGE_OF_INSTALLMENT";
  bonus_value_paise: number;
  customer_months: number | null;
  maturity_months: number | null;
  is_active: boolean;
};

function addMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

const blankForm = {
  scheme_code: "",
  scheme_name: "",
  scheme_type: "CASH" as "CASH" | "GOLD",
  duration_months: "12",
  customer_months: "11",
  maturity_months: "1",
  monthly_amount: "2000",
  bonus_rule_type: "FIXED_AMOUNT" as "FIXED_AMOUNT" | "PERCENTAGE_OF_INSTALLMENT",
  bonus_value: "2000"
};

export default function GssSchemeBuilder({ apiBaseUrl = "" }: GssSchemeBuilderProps) {
  const { session } = useAuthSession();
  const { toasts, push, dismiss } = useToasts();
  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${session?.token ?? ""}` }), [session?.token]);

  const [templates, setTemplates] = useState<Template[]>([]);
  const [form, setForm] = useState(blankForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = <K extends keyof typeof blankForm>(k: K, v: (typeof blankForm)[K]) => setForm((c) => ({ ...c, [k]: v }));

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/api/gss/templates`, { headers: authHeaders });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.templates) setTemplates(data.templates);
    } catch { /* ignore */ }
  }, [apiBaseUrl, authHeaders]);

  useEffect(() => { void load(); }, [load]);

  // Live preview maths.
  const monthlyPaise = Math.round((Number(form.monthly_amount) || 0) * 100);
  const customerMonths = Math.max(0, Math.trunc(Number(form.customer_months) || 0));
  const totalPaid = monthlyPaise * customerMonths;
  const bonusPaise = form.bonus_rule_type === "FIXED_AMOUNT"
    ? Math.round((Number(form.bonus_value) || 0) * 100)
    : Math.round((totalPaid * (Number(form.bonus_value) || 0)) / 100);
  const maturityValue = totalPaid + bonusPaise;
  const today = new Date().toISOString().slice(0, 10);
  const previewSchedule = Array.from({ length: Math.min(customerMonths, 24) }, (_, i) => ({
    n: i + 1,
    due: addMonths(today, i),
    amount: monthlyPaise
  }));

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    if (!form.scheme_code.trim() || !form.scheme_name.trim()) return setError("Scheme code and name are required.");
    setSaving(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/gss/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          scheme_code: form.scheme_code.trim().toUpperCase(),
          scheme_name: form.scheme_name.trim(),
          scheme_type: form.scheme_type,
          duration_months: Math.trunc(Number(form.duration_months) || 0),
          monthly_amount_paise: monthlyPaise,
          bonus_rule_type: form.bonus_rule_type,
          bonus_value_paise: form.bonus_rule_type === "FIXED_AMOUNT"
            ? Math.round((Number(form.bonus_value) || 0) * 100)
            : Math.round((Number(form.bonus_value) || 0) * 100),
          customer_months: customerMonths || null,
          maturity_months: Math.trunc(Number(form.maturity_months) || 0) || null
        })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.errors?.join(" ") || "Failed to create scheme.");
      push(`Scheme ${data.template.scheme_code} created.`, "good");
      setForm(blankForm);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create scheme.");
    } finally {
      setSaving(false);
    }
  };

  const control = "w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100 outline-none transition focus:border-amber-500";

  return (
    <section className="min-h-full bg-slate-950 p-4 text-slate-100">
      <Toaster toasts={toasts} onDismiss={dismiss} />

      <header className="mb-4 flex items-center gap-2">
        <div className="grid h-9 w-9 place-items-center rounded-md bg-amber-600/20 text-amber-300"><Gem className="h-5 w-5" /></div>
        <div>
          <h1 className="text-lg font-bold text-slate-50">Gold Scheme Builder</h1>
          <p className="text-xs text-slate-400">Design saving schemes (incl. "pay 11, get the 12th") with a live installment preview.</p>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        {/* Builder form */}
        <form onSubmit={submit} className="animate-slide-up grid content-start gap-2 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
          <h2 className="mb-1 text-xs font-bold uppercase tracking-wide text-amber-300">New Scheme</h2>
          {error && <p className="rounded bg-rose-950/40 px-2 py-1 text-xs text-rose-300 animate-fade-in">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1 text-xs text-slate-300">Scheme Code
              <input value={form.scheme_code} onChange={(e) => set("scheme_code", e.target.value.toUpperCase())} placeholder="GSS-11-2K" className={control} />
            </label>
            <label className="grid gap-1 text-xs text-slate-300">Scheme Name
              <input value={form.scheme_name} onChange={(e) => set("scheme_name", e.target.value)} placeholder="Pay 11 Get 12" className={control} />
            </label>
            <label className="grid gap-1 text-xs text-slate-300">Type
              <select value={form.scheme_type} onChange={(e) => set("scheme_type", e.target.value as "CASH" | "GOLD")} className={control}>
                <option value="CASH">Cash</option>
                <option value="GOLD">Gold weight</option>
              </select>
            </label>
            <label className="grid gap-1 text-xs text-slate-300">Monthly Amount (₹)
              <input value={form.monthly_amount} onChange={(e) => set("monthly_amount", e.target.value.replace(/[^\d.]/g, ""))} className={control} />
            </label>
            <label className="grid gap-1 text-xs text-slate-300">Total Months
              <input value={form.duration_months} onChange={(e) => set("duration_months", e.target.value.replace(/[^\d]/g, ""))} className={control} />
            </label>
            <label className="grid gap-1 text-xs text-slate-300">Customer Pays (months)
              <input value={form.customer_months} onChange={(e) => set("customer_months", e.target.value.replace(/[^\d]/g, ""))} className={control} />
            </label>
            <label className="grid gap-1 text-xs text-slate-300">Shop Funds (months)
              <input value={form.maturity_months} onChange={(e) => set("maturity_months", e.target.value.replace(/[^\d]/g, ""))} className={control} />
            </label>
            <label className="grid gap-1 text-xs text-slate-300">Bonus Rule
              <select value={form.bonus_rule_type} onChange={(e) => set("bonus_rule_type", e.target.value as typeof blankForm.bonus_rule_type)} className={control}>
                <option value="FIXED_AMOUNT">Fixed amount</option>
                <option value="PERCENTAGE_OF_INSTALLMENT">% of total paid</option>
              </select>
            </label>
            <label className="grid gap-1 text-xs text-slate-300">
              {form.bonus_rule_type === "FIXED_AMOUNT" ? "Bonus (₹)" : "Bonus (%)"}
              <input value={form.bonus_value} onChange={(e) => set("bonus_value", e.target.value.replace(/[^\d.]/g, ""))} className={control} />
            </label>
          </div>
          <div className="mt-2 flex justify-end">
            <ActionButton loading={saving} type="submit"><Plus className="h-4 w-4" /> Create Scheme</ActionButton>
          </div>
        </form>

        {/* Live preview */}
        <div className="grid content-start gap-3">
          <div className="grid grid-cols-3 gap-2">
            <MetricCard label="Customer Pays" accent="sky"><span>{rupees(totalPaid)}</span></MetricCard>
            <MetricCard label="Bonus" accent="amber" icon={Sparkles}><span>{rupees(bonusPaise)}</span></MetricCard>
            <MetricCard label="Maturity Value" accent="emerald" icon={CheckCircle2}><span>{rupees(maturityValue)}</span></MetricCard>
          </div>

          <div className="animate-fade-in rounded-lg border border-slate-800 bg-slate-900/60 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
              <CalendarRange className="h-3.5 w-3.5" /> Installment Schedule (preview from today)
            </div>
            <div className="max-h-64 overflow-y-auto rounded border border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-900 text-[10px] uppercase text-slate-500">
                  <tr><th className="px-2 py-1">#</th><th className="px-2 py-1">Due date</th><th className="px-2 py-1 text-right">Amount</th></tr>
                </thead>
                <tbody>
                  {previewSchedule.length === 0 ? (
                    <tr><td colSpan={3} className="px-2 py-3 text-center text-slate-500">Enter months & amount to preview.</td></tr>
                  ) : previewSchedule.map((row) => (
                    <tr key={row.n} className="border-t border-slate-800/70 transition hover:bg-slate-800/40">
                      <td className="px-2 py-1 text-slate-400">{row.n}</td>
                      <td className="px-2 py-1 font-mono text-slate-200">{row.due}</td>
                      <td className="px-2 py-1 text-right font-mono text-slate-200">{rupees(row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Existing schemes */}
      <div className="mt-4">
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Existing Schemes ({templates.length})</h2>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((t, i) => (
            <div key={t.id} className="animate-slide-up rounded-lg border border-slate-800 bg-slate-900/60 p-3 transition hover:border-slate-600" style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-amber-300">{t.scheme_code}</span>
                <StatusBadge tone={t.is_active ? "good" : "neutral"}>{t.is_active ? "Active" : "Inactive"}</StatusBadge>
              </div>
              <p className="mt-1 truncate text-sm font-semibold text-slate-50">{t.scheme_name}</p>
              <p className="mt-1 text-[11px] text-slate-400">
                {rupees(t.monthly_amount_paise)}/mo · {t.customer_months ?? t.duration_months} pay
                {t.maturity_months ? ` + ${t.maturity_months} free` : ""} · {t.scheme_type}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
