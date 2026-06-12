import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Wrench, Plus, ArrowRight, CheckCircle2, User, CalendarClock, X } from "lucide-react";
import { useAuthSession } from "../auth/AuthSessionContext.js";
import { ActionButton, DateInput, Spinner, StatusBadge, Toaster, useToasts, rupees, type BadgeTone } from "./ui.js";

type RepairDeskModuleProps = { apiBaseUrl?: string };

type RepairStatus = "RECEIVED" | "WIP" | "READY" | "DELIVERED";

type Repair = {
  id: number;
  customer_id: number;
  description: string;
  status: RepairStatus;
  estimated_charge_paise: number;
  actual_charge_paise: number;
  karigar_id: number | null;
  intake_date: string;
  delivery_date: string | null;
};

type Customer = { id: number; name: string; phone: string };

const STATUS_FLOW: Record<RepairStatus, RepairStatus | null> = {
  RECEIVED: "WIP",
  WIP: "READY",
  READY: "DELIVERED",
  DELIVERED: null
};
const STATUS_TONE: Record<RepairStatus, BadgeTone> = { RECEIVED: "info", WIP: "warn", READY: "good", DELIVERED: "neutral" };
const FILTERS: Array<{ key: "ALL" | RepairStatus; label: string }> = [
  { key: "ALL", label: "All" },
  { key: "RECEIVED", label: "Received" },
  { key: "WIP", label: "In Progress" },
  { key: "READY", label: "Ready" },
  { key: "DELIVERED", label: "Delivered" }
];

export default function RepairDeskModule({ apiBaseUrl = "" }: RepairDeskModuleProps) {
  const { session } = useAuthSession();
  const { toasts, push, dismiss } = useToasts();
  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${session?.token ?? ""}` }), [session?.token]);

  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"ALL" | RepairStatus>("ALL");
  const [showForm, setShowForm] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [deliverFor, setDeliverFor] = useState<Repair | null>(null);

  const customerName = useCallback((id: number) => customers.find((c) => c.id === id)?.name ?? `Customer #${id}`, [customers]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rRes, cRes] = await Promise.all([
        fetch(`${apiBaseUrl}/api/karigar/repairs`, { headers: authHeaders }),
        fetch(`${apiBaseUrl}/api/crm/customers?limit=200`, { headers: authHeaders })
      ]);
      const rData = await rRes.json().catch(() => null);
      const cData = await cRes.json().catch(() => null);
      if (rRes.ok && rData?.repairs) setRepairs(rData.repairs);
      if (cRes.ok && cData?.customers) setCustomers(cData.customers);
    } catch {
      push("Failed to load repairs.", "bad");
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, authHeaders, push]);

  useEffect(() => { void load(); }, [load]);

  // Push a status change to the backend. Delivery carries the actual charge,
  // captured in a styled modal (see DeliverModal) rather than a raw browser prompt.
  const applyStatus = async (repair: Repair, next: RepairStatus, extra?: Record<string, unknown>) => {
    setBusyId(repair.id);
    try {
      const res = await fetch(`${apiBaseUrl}/api/karigar/repairs/${repair.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ status: next, ...extra })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.errors?.join(" ") || "Update failed.");
      setRepairs((cur) => cur.map((r) => (r.id === repair.id ? data.repair : r)));
      push(`Moved to ${next}.`, next === "DELIVERED" ? "good" : "info");
    } catch (err) {
      push(err instanceof Error ? err.message : "Update failed.", "bad");
    } finally {
      setBusyId(null);
    }
  };

  const advance = (repair: Repair) => {
    const next = STATUS_FLOW[repair.status];
    if (!next) return;
    // The actual charge often differs from the estimate, so collect it on delivery.
    if (next === "DELIVERED") {
      setDeliverFor(repair);
      return;
    }
    void applyStatus(repair, next);
  };

  const counts = useMemo(() => {
    const map: Record<string, number> = { ALL: repairs.length };
    for (const r of repairs) map[r.status] = (map[r.status] ?? 0) + 1;
    return map;
  }, [repairs]);

  const visible = filter === "ALL" ? repairs : repairs.filter((r) => r.status === filter);

  return (
    <section className="min-h-full bg-slate-950 p-4 text-slate-100">
      <Toaster toasts={toasts} onDismiss={dismiss} />

      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-sky-600/20 text-sky-300"><Wrench className="h-5 w-5" /></div>
          <div>
            <h1 className="text-lg font-bold text-slate-50">Repair & Order Desk</h1>
            <p className="text-xs text-slate-400">Intake customer repairs / custom orders and track them to delivery.</p>
          </div>
        </div>
        <ActionButton tone="sky" onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4" /> New Intake
        </ActionButton>
      </header>

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition active:scale-95 ${
              filter === f.key ? "border-sky-500 bg-sky-500/20 text-sky-200" : "border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200"
            }`}
          >
            {f.label}
            <span className={`rounded-full px-1.5 text-[10px] ${filter === f.key ? "bg-sky-500/30" : "bg-slate-800"}`}>{counts[f.key] ?? 0}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="erp-skeleton h-28 rounded-lg" />)}
        </div>
      ) : visible.length === 0 ? (
        <div className="grid place-items-center gap-2 rounded-lg border border-dashed border-slate-800 py-16 text-slate-500">
          <Wrench className="h-8 w-8 opacity-50" />
          <p className="text-sm">No repairs here yet.</p>
        </div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((r, i) => {
            const next = STATUS_FLOW[r.status];
            return (
              <article
                key={r.id}
                className="animate-slide-up rounded-lg border border-slate-800 bg-slate-900/80 p-3 transition hover:border-slate-600 hover:shadow-lg hover:shadow-black/30"
                style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-50">
                    <User className="h-3.5 w-3.5 text-slate-500" /> {customerName(r.customer_id)}
                  </div>
                  <StatusBadge tone={STATUS_TONE[r.status]}>{r.status}</StatusBadge>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-slate-300">{r.description}</p>
                <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-400">
                  <span className="inline-flex items-center gap-1"><CalendarClock className="h-3 w-3" /> {r.intake_date}</span>
                  <span className="font-mono text-slate-300">{rupees(r.status === "DELIVERED" ? r.actual_charge_paise : r.estimated_charge_paise)}</span>
                </div>
                {next && (
                  <button
                    onClick={() => void advance(r)}
                    disabled={busyId === r.id}
                    className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-700 bg-slate-950 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-emerald-600 hover:text-emerald-300 active:scale-95 disabled:opacity-50"
                  >
                    {busyId === r.id ? <Spinner className="h-3.5 w-3.5" /> : next === "DELIVERED" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />}
                    {next === "DELIVERED" ? "Deliver" : `Move to ${next}`}
                  </button>
                )}
              </article>
            );
          })}
        </div>
      )}

      {showForm && (
        <RepairForm
          apiBaseUrl={apiBaseUrl}
          authHeaders={authHeaders}
          customers={customers}
          onClose={() => setShowForm(false)}
          onCreated={() => { setShowForm(false); push("Repair intake created.", "good"); void load(); }}
        />
      )}

      {deliverFor && (
        <DeliverModal
          repair={deliverFor}
          busy={busyId === deliverFor.id}
          onClose={() => setDeliverFor(null)}
          onConfirm={async (actualPaise) => {
            const repair = deliverFor;
            setDeliverFor(null);
            await applyStatus(repair, "DELIVERED", { actual_charge_paise: actualPaise });
          }}
        />
      )}
    </section>
  );
}

// Collect the final charge on delivery in a themed dialog, showing the original
// estimate and the difference so staff can confirm before money changes hands.
function DeliverModal({
  repair,
  busy,
  onClose,
  onConfirm
}: {
  repair: Repair;
  busy: boolean;
  onClose: () => void;
  onConfirm: (actualPaise: number) => void;
}) {
  const [actualRs, setActualRs] = useState((repair.estimated_charge_paise / 100).toFixed(2));
  const [error, setError] = useState("");
  const actualPaise = Math.round((Number(actualRs) || 0) * 100);
  const diffPaise = actualPaise - repair.estimated_charge_paise;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const amount = Number(actualRs);
    if (!Number.isFinite(amount) || amount < 0) return setError("Enter a valid, non-negative charge.");
    onConfirm(Math.round(amount * 100));
  };

  const control = "w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100 outline-none transition focus:border-emerald-500";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 animate-fade-in" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="animate-scale-in w-full max-w-sm rounded-lg border border-slate-700 bg-slate-950 p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold text-emerald-300">Deliver Repair</h2>
          <button type="button" onClick={onClose} className="text-slate-400 transition hover:text-slate-200"><X className="h-4 w-4" /></button>
        </div>
        {error && <p className="mb-2 rounded bg-rose-950/40 px-2 py-1 text-xs text-rose-300 animate-fade-in">{error}</p>}
        <div className="mb-2 flex items-center justify-between rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs">
          <span className="text-slate-400">Original estimate</span>
          <span className="font-mono text-slate-200">{rupees(repair.estimated_charge_paise)}</span>
        </div>
        <label className="grid gap-1 text-xs text-slate-300">Actual charge collected (₹)
          <input autoFocus value={actualRs} onChange={(e) => { setActualRs(e.target.value.replace(/[^\d.]/g, "")); if (error) setError(""); }} className={control} inputMode="decimal" />
        </label>
        {diffPaise !== 0 && (
          <p className={`mt-1 text-[11px] ${diffPaise > 0 ? "text-amber-400" : "text-sky-400"}`}>
            Difference: {diffPaise > 0 ? "+" : "−"}{rupees(Math.abs(diffPaise))} {diffPaise > 0 ? "over" : "under"} estimate
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:bg-slate-800">Cancel</button>
          <ActionButton loading={busy} type="submit"><CheckCircle2 className="h-4 w-4" /> Confirm Delivery</ActionButton>
        </div>
      </form>
    </div>
  );
}

function RepairForm({
  apiBaseUrl,
  authHeaders,
  customers,
  onClose,
  onCreated
}: {
  apiBaseUrl: string;
  authHeaders: { Authorization: string };
  customers: Customer[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [customerId, setCustomerId] = useState("");
  const [description, setDescription] = useState("");
  const [estimateRs, setEstimateRs] = useState("");
  const [intakeDate, setIntakeDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [deliveryDate, setDeliveryDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    if (!customerId) return setError("Select a customer.");
    if (!description.trim()) return setError("Describe the repair / order.");
    setSaving(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/karigar/repairs`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          customer_id: Number(customerId),
          description: description.trim(),
          estimated_charge_paise: Math.round((Number(estimateRs) || 0) * 100),
          intake_date: intakeDate,
          delivery_date: deliveryDate || null
        })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.errors?.join(" ") || "Failed to create repair.");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create repair.");
    } finally {
      setSaving(false);
    }
  };

  const control = "w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100 outline-none transition focus:border-sky-500";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 animate-fade-in" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="animate-scale-in w-full max-w-lg rounded-lg border border-slate-700 bg-slate-950 p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold text-sky-300">New Repair / Order Intake</h2>
          <button type="button" onClick={onClose} className="text-slate-400 transition hover:text-slate-200"><X className="h-4 w-4" /></button>
        </div>
        {error && <p className="mb-2 rounded bg-rose-950/40 px-2 py-1 text-xs text-rose-300 animate-fade-in">{error}</p>}
        <div className="grid gap-2">
          <label className="grid gap-1 text-xs text-slate-300">Customer
            <select autoFocus value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={control}>
              <option value="">Select customer…</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.phone}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-slate-300">Description
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="e.g. Resize gold ring to size 14, polish" className={control} />
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="grid gap-1 text-xs text-slate-300">Estimate (₹)
              <input value={estimateRs} onChange={(e) => setEstimateRs(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0.00" className={control} />
            </label>
            <label className="grid gap-1 text-xs text-slate-300">Intake
              <DateInput value={intakeDate} onChange={setIntakeDate} className={control} />
            </label>
            <label className="grid gap-1 text-xs text-slate-300">Delivery
              <DateInput value={deliveryDate} onChange={setDeliveryDate} className={control} />
            </label>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:bg-slate-800">Cancel</button>
          <ActionButton tone="sky" loading={saving} type="submit">Create Intake</ActionButton>
        </div>
      </form>
    </div>
  );
}
