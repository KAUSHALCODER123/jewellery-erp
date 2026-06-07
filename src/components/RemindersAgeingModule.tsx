import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, BellRing, CalendarClock, Gift, Landmark, MessageCircle, Receipt, Save } from "lucide-react";
import { useAuthSession } from "../auth/AuthSessionContext.js";

type Props = { apiBaseUrl?: string };
type ActiveTab = "reminders" | "ageing";

type Reminder = {
  type: "UDHARI_OVERDUE" | "GIRVI_DUE" | "GSS_MATURITY" | "BIRTHDAY" | "ANNIVERSARY";
  customer_id: number | null;
  customer_name: string;
  phone: string | null;
  detail: string;
  amount_rupees: string | null;
  reference: string | null;
  message: string;
  whatsapp_link: string | null;
};

type ReminderResponse = {
  date: string;
  counts: { udhari_overdue: number; girvi_due: number; gss_maturity: number; occasions: number; total: number };
  reminders: Reminder[];
};

type AgeingCustomer = {
  ledger_id: number;
  customer_id: number | null;
  customer_name: string;
  phone: string | null;
  balance_rupees: string;
  oldest_days: number;
  credit_limit_paise: number;
  credit_limit_rupees: string;
  over_limit: boolean;
  buckets: {
    current_rupees: string;
    days_31_60_rupees: string;
    days_61_90_rupees: string;
    days_91_120_rupees: string;
    over_120_rupees: string;
  };
};

type AgeingResponse = {
  customers: AgeingCustomer[];
  totals: {
    current_rupees: string;
    days_31_60_rupees: string;
    days_61_90_rupees: string;
    days_91_120_rupees: string;
    over_120_rupees: string;
    total_rupees: string;
    over_limit_count: number;
  };
};

function rupeesToPaise(value: string): number {
  const match = value.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return 0;
  const frac = (match[2] ?? "").padEnd(2, "0");
  return Number(match[1]) * 100 + Number(frac);
}

export default function RemindersAgeingModule({ apiBaseUrl = "" }: Props) {
  const { session } = useAuthSession();
  const [activeTab, setActiveTab] = useState<ActiveTab>("reminders");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [overdueDays, setOverdueDays] = useState("30");
  const [digest, setDigest] = useState<ReminderResponse | null>(null);
  const [ageing, setAgeing] = useState<AgeingResponse | null>(null);
  const [editingLimit, setEditingLimit] = useState<number | null>(null);
  const [limitInput, setLimitInput] = useState("");

  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${session?.token ?? ""}` }), [session?.token]);

  const loadDigest = useCallback(async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/api/reminders/due?overdue_days=${overdueDays || 30}`, { headers: authHeaders });
      const data = await res.json();
      setDigest(res.ok ? data : null);
    } catch {
      setDigest(null);
    }
  }, [apiBaseUrl, authHeaders, overdueDays]);

  const loadAgeing = useCallback(async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/api/accounts/udhari/ageing`, { headers: authHeaders });
      const data = await res.json();
      setAgeing(res.ok ? data : null);
    } catch {
      setAgeing(null);
    }
  }, [apiBaseUrl, authHeaders]);

  useEffect(() => {
    if (activeTab === "reminders") void loadDigest();
    else void loadAgeing();
  }, [activeTab, loadDigest, loadAgeing]);

  const saveLimit = async (customerId: number) => {
    setError("");
    setMessage("");
    try {
      const res = await fetch(`${apiBaseUrl}/api/accounts/customers/${customerId}/credit-limit`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ credit_limit_paise: rupeesToPaise(limitInput) })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.errors?.join(" ") || "Failed to save limit.");
      setMessage(`Credit limit updated to Rs ${data.credit_limit_rupees}.`);
      setEditingLimit(null);
      await loadAgeing();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save limit.");
    }
  };

  return (
    <section className="grid h-screen grid-rows-[auto_auto_1fr] overflow-hidden bg-slate-950 text-slate-100 font-sans">
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-3 py-2">
        <div>
          <h1 className="flex items-center gap-2 text-sm font-semibold uppercase text-slate-50 tracking-wide">
            <BellRing size={16} className="text-emerald-400" /> Reminders & Receivables Ageing
          </h1>
          <p className="text-xs text-slate-400">Daily follow-up digest and aged udhari with credit limits</p>
        </div>
        <nav className="flex border border-slate-700 text-xs">
          <button type="button" onClick={() => setActiveTab("reminders")} className={tabClass(activeTab === "reminders")}>Due Reminders</button>
          <button type="button" onClick={() => setActiveTab("ageing")} className={tabClass(activeTab === "ageing")}>Udhari Ageing</button>
        </nav>
      </header>

      {(message || error) && (
        <div className={`border-b border-slate-800 px-3 py-1.5 text-xs font-semibold ${error ? "bg-red-950/50 text-red-200" : "bg-emerald-950/40 text-emerald-200"}`}>
          {error || message}
        </div>
      )}

      <main className="min-h-0 overflow-hidden">
        {activeTab === "reminders" ? (
          <div className="grid h-full grid-rows-[auto_auto_1fr] overflow-hidden">
            <div className="flex items-center gap-3 border-b border-slate-800 bg-slate-900/50 px-4 py-2">
              <label className="flex items-center gap-2 text-[10px] font-bold uppercase text-slate-400">
                Udhari overdue after
                <input value={overdueDays} onChange={(e) => setOverdueDays(e.target.value.replace(/[^\d]/g, ""))} className="h-7 w-16 border border-slate-700 bg-slate-950 px-2 text-xs text-slate-50 outline-none focus:border-emerald-400 rounded-sm" inputMode="numeric" />
                days
              </label>
              <button type="button" onClick={() => void loadDigest()} className="rounded bg-emerald-500 px-3 py-1 text-[11px] font-bold uppercase text-slate-50 hover:bg-emerald-400">Refresh</button>
              <span className="ml-auto text-[11px] text-slate-500">{digest?.date}</span>
            </div>

            {digest && (
              <div className="grid grid-cols-4 gap-2 border-b border-slate-800 bg-slate-900/30 px-4 py-2">
                <Chip icon={<Receipt size={13} />} label="Udhari overdue" value={digest.counts.udhari_overdue} tone="amber" />
                <Chip icon={<Landmark size={13} />} label="Girvi due" value={digest.counts.girvi_due} tone="blue" />
                <Chip icon={<CalendarClock size={13} />} label="Scheme maturing" value={digest.counts.gss_maturity} tone="emerald" />
                <Chip icon={<Gift size={13} />} label="Occasions" value={digest.counts.occasions} tone="pink" />
              </div>
            )}

            <div className="min-h-0 overflow-auto p-4">
              {!digest || digest.reminders.length === 0 ? (
                <p className="text-center text-slate-500 py-16 uppercase text-xs font-semibold">Nothing due today. 🎉</p>
              ) : (
                <div className="grid gap-2">
                  {digest.reminders.map((r, idx) => (
                    <div key={idx} className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900 p-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <ReminderIcon type={r.type} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-slate-50">{r.customer_name}</span>
                            {r.reference && <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-mono text-slate-400">{r.reference}</span>}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {r.detail}{r.amount_rupees ? ` · Rs ${r.amount_rupees}` : ""}{r.phone ? ` · ${r.phone}` : " · no phone"}
                          </div>
                          <div className="mt-1 truncate text-[10px] text-slate-500 italic max-w-xl">{r.message}</div>
                        </div>
                      </div>
                      {r.whatsapp_link ? (
                        <a href={r.whatsapp_link} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1 rounded bg-emerald-600 px-3 py-1.5 text-[11px] font-bold uppercase text-slate-50 hover:bg-emerald-500">
                          <MessageCircle size={13} /> WhatsApp
                        </a>
                      ) : (
                        <span className="shrink-0 text-[10px] uppercase text-slate-600">no phone</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="grid h-full grid-rows-[auto_1fr] overflow-hidden">
            {ageing && (
              <div className="grid grid-cols-6 gap-2 border-b border-slate-800 bg-slate-900/30 px-4 py-2 text-center">
                <BucketTotal label="0–30 d" value={ageing.totals.current_rupees} />
                <BucketTotal label="31–60 d" value={ageing.totals.days_31_60_rupees} />
                <BucketTotal label="61–90 d" value={ageing.totals.days_61_90_rupees} />
                <BucketTotal label="91–120 d" value={ageing.totals.days_91_120_rupees} tone="amber" />
                <BucketTotal label="120+ d" value={ageing.totals.over_120_rupees} tone="red" />
                <BucketTotal label="Total" value={ageing.totals.total_rupees} tone="emerald" />
              </div>
            )}
            <div className="min-h-0 overflow-auto p-4">
              {ageing && ageing.totals.over_limit_count > 0 && (
                <div className="mb-3 flex items-center gap-2 rounded border border-red-900/60 bg-red-950/30 px-3 py-1.5 text-[11px] text-red-300">
                  <AlertTriangle size={14} /> {ageing.totals.over_limit_count} customer(s) over their credit limit.
                </div>
              )}
              {!ageing || ageing.customers.length === 0 ? (
                <p className="text-center text-slate-500 py-16 uppercase text-xs font-semibold">No outstanding udhari. 🎉</p>
              ) : (
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase text-[10px]">
                      <th className="px-2 py-2">Customer</th>
                      <th className="px-2 py-2 text-right">Oldest</th>
                      <th className="px-2 py-2 text-right">0–30</th>
                      <th className="px-2 py-2 text-right">31–60</th>
                      <th className="px-2 py-2 text-right">61–90</th>
                      <th className="px-2 py-2 text-right">91–120</th>
                      <th className="px-2 py-2 text-right">120+</th>
                      <th className="px-2 py-2 text-right">Balance</th>
                      <th className="px-2 py-2 text-right">Credit Limit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ageing.customers.map((c) => (
                      <tr key={c.ledger_id} className={`border-b border-slate-900 ${c.over_limit ? "bg-red-950/20" : "hover:bg-slate-900/40"}`}>
                        <td className="px-2 py-2">
                          <div className="font-semibold text-slate-200">{c.customer_name || "—"}</div>
                          <div className="text-[10px] text-slate-500">{c.phone || "no phone"}</div>
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-slate-400">{c.oldest_days}d</td>
                        <td className="px-2 py-2 text-right font-mono text-slate-300">{c.buckets.current_rupees}</td>
                        <td className="px-2 py-2 text-right font-mono text-slate-300">{c.buckets.days_31_60_rupees}</td>
                        <td className="px-2 py-2 text-right font-mono text-slate-300">{c.buckets.days_61_90_rupees}</td>
                        <td className="px-2 py-2 text-right font-mono text-amber-400">{c.buckets.days_91_120_rupees}</td>
                        <td className="px-2 py-2 text-right font-mono text-red-400">{c.buckets.over_120_rupees}</td>
                        <td className="px-2 py-2 text-right font-mono font-semibold text-slate-50">{c.balance_rupees}</td>
                        <td className="px-2 py-2 text-right">
                          {editingLimit === c.customer_id ? (
                            <div className="flex items-center justify-end gap-1">
                              <input autoFocus value={limitInput} onChange={(e) => setLimitInput(e.target.value.replace(/[^\d.]/g, ""))} className="h-7 w-24 border border-slate-700 bg-slate-950 px-2 text-xs text-slate-50 outline-none focus:border-emerald-400 rounded-sm" inputMode="decimal" placeholder="0 = none" />
                              <button type="button" onClick={() => c.customer_id && void saveLimit(c.customer_id)} className="grid h-7 w-7 place-items-center rounded bg-emerald-500 text-slate-50 hover:bg-emerald-400"><Save size={13} /></button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              disabled={!c.customer_id}
                              onClick={() => { setEditingLimit(c.customer_id); setLimitInput(c.credit_limit_paise ? c.credit_limit_rupees : ""); }}
                              className={`font-mono ${c.over_limit ? "text-red-400 font-bold" : "text-slate-400"} hover:text-slate-50 disabled:opacity-40`}
                              title="Click to set credit limit"
                            >
                              {c.credit_limit_paise ? `Rs ${c.credit_limit_rupees}` : "— set —"}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </main>
    </section>
  );
}

function tabClass(active: boolean) {
  return `h-8 border-r border-slate-700 px-3 font-semibold uppercase text-[10px] tracking-wide last:border-r-0 cursor-pointer transition-colors ${active ? "bg-emerald-500 text-slate-50 font-bold" : "bg-slate-950 text-slate-400 hover:text-slate-50"}`;
}

function Chip({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: "amber" | "blue" | "emerald" | "pink" }) {
  const color = tone === "amber" ? "text-amber-400" : tone === "blue" ? "text-blue-400" : tone === "emerald" ? "text-emerald-400" : "text-pink-400";
  return (
    <div className="flex items-center gap-2 rounded border border-slate-800 bg-slate-950 px-2 py-1.5">
      <span className={color}>{icon}</span>
      <div className="min-w-0">
        <div className="text-[9px] font-bold uppercase text-slate-500">{label}</div>
        <div className={`font-mono text-sm font-semibold ${value > 0 ? color : "text-slate-600"}`}>{value}</div>
      </div>
    </div>
  );
}

function BucketTotal({ label, value, tone }: { label: string; value: string; tone?: "amber" | "red" | "emerald" }) {
  const color = tone === "amber" ? "text-amber-400" : tone === "red" ? "text-red-400" : tone === "emerald" ? "text-emerald-400" : "text-slate-200";
  return (
    <div className="rounded border border-slate-800 bg-slate-950 px-2 py-1.5">
      <div className="text-[9px] font-bold uppercase text-slate-500">{label}</div>
      <div className={`font-mono text-xs font-semibold ${color}`}>Rs {value}</div>
    </div>
  );
}

function ReminderIcon({ type }: { type: Reminder["type"] }) {
  if (type === "UDHARI_OVERDUE") return <Receipt size={18} className="text-amber-400 shrink-0" />;
  if (type === "GIRVI_DUE") return <Landmark size={18} className="text-blue-400 shrink-0" />;
  if (type === "GSS_MATURITY") return <CalendarClock size={18} className="text-emerald-400 shrink-0" />;
  return <Gift size={18} className="text-pink-400 shrink-0" />;
}
