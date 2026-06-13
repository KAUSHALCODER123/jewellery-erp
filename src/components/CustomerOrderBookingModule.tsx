import { ClipboardList, Plus, Search, X } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthSession } from "../auth/AuthSessionContext.js";
import { DateInput } from "./ui.js";

type CustomerOrderBookingModuleProps = { apiBaseUrl?: string };

type CustomerOption = { id: number; name: string; phone: string | null };

type CustomerOrder = {
  id: number;
  order_number: string;
  customer_id: number;
  customer_name: string;
  customer_phone: string | null;
  item_description: string;
  target_weight_mg: number;
  target_weight_grams: string;
  target_purity: number;
  notes: string | null;
  customer_gold_mg: number;
  customer_gold_grams: string;
  customer_gold_purity_tunch: number;
  expected_by_date: string | null;
  advance_paise: number;
  advance_rupees: string;
  status: "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  karigar_job_id: number | null;
  created_at: string | null;
};

type StatusFilter = "ALL" | "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

const PURITY_PRESETS = [
  { label: "22K (916)", value: 9167 },
  { label: "18K (750)", value: 7500 },
  { label: "14K (585)", value: 5833 },
  { label: "24K (999)", value: 9999 },
  { label: "925 Silver", value: 9250 }
];

const STATUS_COLORS: Record<CustomerOrder["status"], string> = {
  OPEN: "bg-sky-950/50 text-sky-300 border-sky-800",
  IN_PROGRESS: "bg-amber-950/50 text-amber-300 border-amber-800",
  COMPLETED: "bg-emerald-950/50 text-emerald-300 border-emerald-800",
  CANCELLED: "bg-slate-800 text-slate-400 border-slate-700"
};

function formatPurity(tunch: number): string {
  const preset = PURITY_PRESETS.find((p) => Math.abs(p.value - tunch) < 5);
  return preset ? preset.label : `${(tunch / 100).toFixed(2)}%`;
}

const ctrl = "h-9 w-full border border-slate-700 bg-slate-950 px-2 text-sm text-slate-50 outline-none focus:border-emerald-400";

export default function CustomerOrderBookingModule({ apiBaseUrl = "" }: CustomerOrderBookingModuleProps) {
  const { session } = useAuthSession();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [selectedOrder, setSelectedOrder] = useState<CustomerOrder | null>(null);
  const [rightView, setRightView] = useState<"detail" | "new">("detail");

  // New order form
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerOptions, setCustomerOptions] = useState<CustomerOption[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(null);
  const [orderNumber, setOrderNumber] = useState("");
  const [itemDescription, setItemDescription] = useState("");
  const [targetWeightGrams, setTargetWeightGrams] = useState("");
  const [targetPurity, setTargetPurity] = useState(9167);
  const [notes, setNotes] = useState("");
  const [customerGoldGrams, setCustomerGoldGrams] = useState("");
  const [customerGoldPurityTunch, setCustomerGoldPurityTunch] = useState(9167);
  const [hasCustomerGold, setHasCustomerGold] = useState(false);
  const [expectedByDate, setExpectedByDate] = useState("");
  const [advanceRupees, setAdvanceRupees] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const itemDescRef = useRef<HTMLInputElement>(null);

  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${session?.token ?? ""}` }), [session?.token]);

  useEffect(() => { void loadOrders(); }, [statusFilter, session?.token]);

  useEffect(() => {
    const id = window.setTimeout(() => { void searchCustomers(customerSearch); }, 180);
    return () => window.clearTimeout(id);
  }, [customerSearch, session?.token]);

  useEffect(() => {
    if (rightView === "new") {
      void fetchNextNumber();
    }
  }, [rightView]);

  async function loadOrders() {
    if (!session?.token) return;
    try {
      const qs = statusFilter !== "ALL" ? `?status=${statusFilter}` : "";
      const res = await fetch(`${apiBaseUrl}/api/orders${qs}`, { headers: authHeaders });
      const result = (await res.json().catch(() => null)) as { orders?: CustomerOrder[] } | null;
      setOrders(res.ok && result?.orders ? result.orders : []);
    } catch { setOrders([]); }
  }

  async function searchCustomers(search: string) {
    if (!session?.token) return;
    try {
      const res = await fetch(`${apiBaseUrl}/api/orders/customers?search=${encodeURIComponent(search)}`, { headers: authHeaders });
      const result = (await res.json().catch(() => null)) as { customers?: CustomerOption[] } | null;
      setCustomerOptions(res.ok && result?.customers ? result.customers : []);
    } catch { setCustomerOptions([]); }
  }

  async function fetchNextNumber() {
    try {
      const res = await fetch(`${apiBaseUrl}/api/orders/next-number`, { headers: authHeaders });
      const result = (await res.json().catch(() => null)) as { order_number?: string } | null;
      if (res.ok && result?.order_number) setOrderNumber(result.order_number);
    } catch { /* leave blank */ }
  }

  function openNew() {
    setSelectedOrder(null);
    setRightView("new");
    setError("");
    setMessage("");
    setCustomerSearch("");
    setSelectedCustomer(null);
    setItemDescription("");
    setTargetWeightGrams("");
    setTargetPurity(9167);
    setNotes("");
    setCustomerGoldGrams("");
    setCustomerGoldPurityTunch(9167);
    setHasCustomerGold(false);
    setExpectedByDate("");
    setAdvanceRupees("");
    setTimeout(() => itemDescRef.current?.focus(), 50);
  }

  async function saveOrder(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setMessage("");
    if (!selectedCustomer) { setError("Select a customer first."); return; }
    if (!itemDescription.trim()) { setError("Item description is required."); return; }
    setSaving(true);
    try {
      const advancePaise = Math.round(Number(advanceRupees || "0") * 100);
      const res = await fetch(`${apiBaseUrl}/api/orders`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          order_number: orderNumber.trim() || undefined,
          customer_id: selectedCustomer.id,
          item_description: itemDescription.trim(),
          target_weight_grams: targetWeightGrams || "0",
          target_purity: targetPurity,
          notes: notes.trim() || null,
          customer_gold_grams: customerGoldGrams || "0",
          customer_gold_purity_tunch: customerGoldPurityTunch,
          expected_by_date: expectedByDate || null,
          advance_paise: advancePaise
        })
      });
      const result = (await res.json().catch(() => null)) as { order?: CustomerOrder; errors?: string[] } | null;
      if (!res.ok || !result?.order) throw new Error(result?.errors?.join(" ") || "Could not save order.");
      setMessage(`Order ${result.order.order_number} created.`);
      setSelectedOrder(result.order);
      setRightView("detail");
      void loadOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save order.");
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(orderId: number, newStatus: CustomerOrder["status"]) {
    try {
      const res = await fetch(`${apiBaseUrl}/api/orders/${orderId}/status`, {
        method: "PATCH",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus })
      });
      if (res.ok) {
        setSelectedOrder((prev) => prev ? { ...prev, status: newStatus } : prev);
        void loadOrders();
      }
    } catch { /* silent */ }
  }

  const filteredOrders = orders;

  return (
    <section className="grid h-screen grid-rows-[auto_1fr] overflow-hidden bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-3 py-2">
        <div>
          <h1 className="text-sm font-semibold uppercase text-slate-50">Customer Order Booking</h1>
          <p className="text-xs text-slate-400">Book custom orders before assigning a karigar</p>
        </div>
        <button
          type="button"
          onClick={openNew}
          className="flex h-8 items-center gap-1.5 bg-emerald-500 px-3 text-xs font-bold uppercase text-slate-50 hover:bg-emerald-400"
        >
          <Plus className="h-3.5 w-3.5" /> New Order
        </button>
      </header>

      {(message || error) && (
        <div className={`border-b border-slate-800 px-3 py-1 text-xs ${error ? "bg-red-950/40 text-red-200" : "bg-emerald-950/40 text-emerald-200"}`}>
          {error || message}
        </div>
      )}

      <main className="grid min-h-0 grid-cols-[340px_1fr] overflow-hidden">
        {/* Left: order list */}
        <aside className="grid min-h-0 grid-rows-[auto_1fr] border-r border-slate-800 bg-slate-950">
          {/* Status filter tabs */}
          <div className="flex gap-0 overflow-x-auto border-b border-slate-800">
            {(["ALL", "OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as StatusFilter[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`shrink-0 h-9 px-3 text-[10px] font-semibold uppercase transition border-b-2 ${
                  statusFilter === s ? "border-emerald-400 text-emerald-300" : "border-transparent text-slate-500 hover:text-slate-300"
                }`}
              >
                {s.replace("_", " ")}
              </button>
            ))}
          </div>

          <div className="min-h-0 overflow-auto">
            {filteredOrders.length === 0 ? (
              <div className="grid h-32 place-items-center text-xs text-slate-600">No orders found.</div>
            ) : (
              filteredOrders.map((order) => (
                <button
                  key={order.id}
                  type="button"
                  onClick={() => { setSelectedOrder(order); setRightView("detail"); setError(""); setMessage(""); }}
                  className={`grid w-full gap-1 border-b border-slate-900 px-3 py-2.5 text-left transition ${
                    selectedOrder?.id === order.id && rightView === "detail" ? "bg-slate-800" : "hover:bg-slate-900"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-bold text-emerald-400">{order.order_number}</span>
                    <span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase ${STATUS_COLORS[order.status]}`}>
                      {order.status.replace("_", " ")}
                    </span>
                  </div>
                  <div className="truncate text-sm font-semibold text-slate-50">{order.item_description}</div>
                  <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                    <span className="truncate">{order.customer_name}</span>
                    <span className="shrink-0 font-mono">{order.created_at?.slice(0, 10) ?? ""}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        {/* Right: detail or new form */}
        <section className="min-h-0 overflow-auto">
          {rightView === "new" ? (
            <form onSubmit={saveOrder} className="grid content-start gap-4 p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase text-slate-50">New Customer Order</h2>
                <button type="button" onClick={() => setRightView("detail")} className="text-slate-500 hover:text-slate-50">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Customer selector */}
              <div className="grid gap-2 border border-slate-800 bg-slate-900 p-4">
                <div className="text-[10px] font-semibold uppercase text-slate-500">Customer</div>
                {selectedCustomer ? (
                  <div className="flex items-center justify-between border border-emerald-700 bg-emerald-950/20 px-3 py-2">
                    <div>
                      <div className="text-sm font-semibold text-slate-50">{selectedCustomer.name}</div>
                      <div className="font-mono text-xs text-slate-400">{selectedCustomer.phone ?? "No phone"}</div>
                    </div>
                    <button type="button" onClick={() => setSelectedCustomer(null)} className="text-slate-500 hover:text-red-400">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="grid gap-1.5">
                    <div className="flex h-9 items-center border border-slate-700 bg-slate-950 px-2 focus-within:border-emerald-400">
                      <Search className="h-3.5 w-3.5 text-slate-500" />
                      <input
                        value={customerSearch}
                        onChange={(e) => setCustomerSearch(e.target.value)}
                        placeholder="Search by name or phone"
                        className="h-full min-w-0 flex-1 bg-transparent px-2 text-sm text-slate-50 outline-none"
                      />
                    </div>
                    {customerOptions.length > 0 && (
                      <div className="border border-slate-700 bg-slate-950">
                        {customerOptions.slice(0, 6).map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => { setSelectedCustomer(c); setCustomerSearch(""); }}
                            className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-800"
                          >
                            <span className="font-semibold text-slate-50">{c.name}</span>
                            <span className="font-mono text-xs text-slate-400">{c.phone ?? ""}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Order details */}
              <div className="grid gap-3 border border-slate-800 bg-slate-900 p-4">
                <div className="text-[10px] font-semibold uppercase text-slate-500">Order Details</div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="grid gap-1 text-[10px] font-semibold uppercase text-slate-500">
                    Order No.
                    <input value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} placeholder="Auto" className={ctrl} />
                  </label>
                  <label className="grid gap-1 text-[10px] font-semibold uppercase text-slate-500">
                    Expected By
                    <DateInput value={expectedByDate} onChange={setExpectedByDate} className={ctrl} />
                  </label>
                </div>

                <label className="grid gap-1 text-[10px] font-semibold uppercase text-slate-500">
                  Item Description *
                  <input
                    ref={itemDescRef}
                    value={itemDescription}
                    onChange={(e) => setItemDescription(e.target.value)}
                    placeholder="e.g. Custom Gold Necklace"
                    required
                    className={ctrl}
                  />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="grid gap-1 text-[10px] font-semibold uppercase text-slate-500">
                    Target Weight (g)
                    <input
                      value={targetWeightGrams}
                      onChange={(e) => setTargetWeightGrams(e.target.value)}
                      inputMode="decimal"
                      placeholder="e.g. 15.000"
                      className={ctrl}
                    />
                  </label>
                  <label className="grid gap-1 text-[10px] font-semibold uppercase text-slate-500">
                    Purity
                    <select value={targetPurity} onChange={(e) => setTargetPurity(Number(e.target.value))} className={ctrl}>
                      {PURITY_PRESETS.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                    <span className="text-[10px] font-normal normal-case text-slate-500">= {(targetPurity / 100).toFixed(2)}% fine</span>
                  </label>
                </div>

                <label className="grid gap-1 text-[10px] font-semibold uppercase text-slate-500">
                  Design Notes
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Design preferences, references, special instructions…"
                    className={`${ctrl} min-h-16 py-2`}
                  />
                </label>
              </div>

              {/* Customer's own gold */}
              <div className="grid gap-3 border border-slate-800 bg-slate-900 p-4">
                <label className="flex items-center gap-2 text-[10px] font-semibold uppercase text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hasCustomerGold}
                    onChange={(e) => {
                      setHasCustomerGold(e.target.checked);
                      if (!e.target.checked) setCustomerGoldGrams("");
                    }}
                    className="h-4 w-4 rounded border-slate-700 bg-slate-950 accent-emerald-500"
                  />
                  Customer is bringing their own gold
                </label>
                {hasCustomerGold && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="grid gap-1 text-[10px] font-semibold uppercase text-slate-500">
                        Weight (g)
                        <input
                          value={customerGoldGrams}
                          onChange={(e) => setCustomerGoldGrams(e.target.value)}
                          inputMode="decimal"
                          placeholder="0.000"
                          className={ctrl}
                        />
                      </label>
                      <label className="grid gap-1 text-[10px] font-semibold uppercase text-slate-500">
                        Purity
                        <select value={customerGoldPurityTunch} onChange={(e) => setCustomerGoldPurityTunch(Number(e.target.value))} className={ctrl}>
                          {PURITY_PRESETS.map((p) => (
                            <option key={p.value} value={p.value}>{p.label}</option>
                          ))}
                        </select>
                        <span className="text-[10px] font-normal normal-case text-slate-500">= {(customerGoldPurityTunch / 100).toFixed(2)}% fine</span>
                      </label>
                    </div>
                    <p className="text-[10px] normal-case text-slate-500">This gold is credited toward the final order cost.</p>
                  </>
                )}
              </div>

              {/* Advance */}
              <div className="grid gap-3 border border-slate-800 bg-slate-900 p-4">
                <div className="text-[10px] font-semibold uppercase text-slate-500">Advance Collected</div>
                <label className="grid gap-1 text-[10px] font-semibold uppercase text-slate-500">
                  Amount (Rs)
                  <input
                    value={advanceRupees}
                    onChange={(e) => setAdvanceRupees(e.target.value)}
                    inputMode="decimal"
                    placeholder="0"
                    className={ctrl}
                  />
                </label>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={saving || !selectedCustomer}
                  className="h-9 bg-emerald-500 px-6 text-xs font-bold uppercase text-slate-50 hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                >
                  {saving ? "Saving..." : "Book Order"}
                </button>
              </div>
            </form>
          ) : selectedOrder ? (
            <div className="grid content-start gap-4 p-5">
              {/* Order header */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-2xl font-bold text-emerald-400">{selectedOrder.order_number}</span>
                    <span className={`border px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_COLORS[selectedOrder.status]}`}>
                      {selectedOrder.status.replace("_", " ")}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">Booked {selectedOrder.created_at?.slice(0, 10) ?? ""}</p>
                </div>
                <div className="flex gap-2">
                  {(selectedOrder.status === "OPEN" || selectedOrder.status === "IN_PROGRESS") && (
                    <button
                      type="button"
                      onClick={() => navigate("/pos", {
                        state: {
                          customerOrderId: selectedOrder.id,
                          customerId: selectedOrder.customer_id,
                          advancePaise: selectedOrder.advance_paise,
                          orderNumber: selectedOrder.order_number
                        }
                      })}
                      className="h-7 bg-emerald-500 px-3 text-[11px] font-bold uppercase text-slate-50 hover:bg-emerald-400"
                    >
                      Convert to Invoice
                    </button>
                  )}
                  {selectedOrder.status === "OPEN" && (
                    <button
                      type="button"
                      onClick={() => updateStatus(selectedOrder.id, "IN_PROGRESS")}
                      className="h-7 border border-amber-700 px-3 text-[11px] font-semibold text-amber-400 hover:border-amber-500"
                    >
                      Mark In Progress
                    </button>
                  )}
                  {selectedOrder.status === "IN_PROGRESS" && (
                    <button
                      type="button"
                      onClick={() => updateStatus(selectedOrder.id, "COMPLETED")}
                      className="h-7 border border-emerald-700 px-3 text-[11px] font-semibold text-emerald-400 hover:border-emerald-500"
                    >
                      Mark Completed
                    </button>
                  )}
                  {(selectedOrder.status === "OPEN" || selectedOrder.status === "IN_PROGRESS") && (
                    <button
                      type="button"
                      onClick={() => updateStatus(selectedOrder.id, "CANCELLED")}
                      className="h-7 border border-red-900 px-3 text-[11px] font-semibold text-red-400 hover:border-red-700"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Customer */}
                <DetailCard title="Customer">
                  <DetailRow label="Name" value={selectedOrder.customer_name} />
                  <DetailRow label="Phone" value={selectedOrder.customer_phone ?? "—"} mono />
                </DetailCard>

                {/* Item */}
                <DetailCard title="Item Ordered">
                  <DetailRow label="Description" value={selectedOrder.item_description} />
                  <DetailRow label="Target Weight" value={`${selectedOrder.target_weight_grams}g`} mono />
                  <DetailRow label="Purity" value={formatPurity(selectedOrder.target_purity)} mono />
                  {selectedOrder.expected_by_date && <DetailRow label="Deliver By" value={selectedOrder.expected_by_date} mono />}
                </DetailCard>

                {/* Customer's gold */}
                {selectedOrder.customer_gold_mg > 0 && (
                  <DetailCard title="Customer's Own Gold">
                    <DetailRow label="Weight" value={`${selectedOrder.customer_gold_grams}g`} mono />
                    <DetailRow label="Purity" value={formatPurity(selectedOrder.customer_gold_purity_tunch)} mono />
                  </DetailCard>
                )}

                {/* Advance */}
                {selectedOrder.advance_paise > 0 && (
                  <DetailCard title="Advance Collected">
                    <DetailRow label="Amount" value={`Rs ${selectedOrder.advance_rupees}`} mono />
                  </DetailCard>
                )}
              </div>

              {selectedOrder.notes && (
                <div className="border border-slate-800 bg-slate-900 p-4">
                  <div className="mb-1 text-[10px] font-semibold uppercase text-slate-500">Design Notes</div>
                  <p className="text-sm text-slate-300">{selectedOrder.notes}</p>
                </div>
              )}

              {/* Karigar handoff hint */}
              {(selectedOrder.status === "OPEN" || selectedOrder.status === "IN_PROGRESS") && (
                <div className="border border-slate-700 bg-slate-900 px-4 py-3">
                  <div className="text-[10px] font-semibold uppercase text-slate-500">Karigar Handoff</div>
                  <p className="mt-1 text-xs text-slate-400">
                    Use order number <span className="font-mono font-bold text-emerald-400">{selectedOrder.order_number}</span> when
                    creating the job in Karigar &rarr; Issue Metal. Enter it in the Job No. field to link this customer order to the goldsmith's work slip.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="grid h-full place-items-center text-center">
              <div>
                <ClipboardList className="mx-auto mb-3 h-10 w-10 text-slate-700" />
                <p className="text-sm font-semibold text-slate-500">Select an order or book a new one</p>
              </div>
            </div>
          )}
        </section>
      </main>
    </section>
  );
}

function DetailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-slate-800 bg-slate-900 p-4">
      <div className="mb-2 text-[10px] font-semibold uppercase text-slate-500">{title}</div>
      <div className="grid gap-1.5">{children}</div>
    </div>
  );
}

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-slate-500">{label}</span>
      <span className={`text-right ${mono ? "font-mono font-semibold text-slate-200" : "text-slate-100"}`}>{value}</span>
    </div>
  );
}
