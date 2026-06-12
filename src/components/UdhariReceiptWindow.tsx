import { Clock, ExternalLink, Printer, ReceiptIndianRupee, Search } from "lucide-react";
import type { FormEvent, KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuthSession } from "../auth/AuthSessionContext.js";
import { DateInput } from "./ui.js";

type UdhariReceiptWindowProps = {
  apiBaseUrl?: string;
};

type ReceiptCustomer = {
  customer_id: number;
  customer_name: string;
  phone: string | null;
  ledger_id: number | null;
  balance_paise: number;
  balance_rupees: string;
};

type SavedReceipt = {
  receipt_number: string;
  customer_name: string;
  customer_phone: string | null;
  payment_mode: "CASH" | "UPI" | "CARD" | "BANK";
  amount_paise: number;
  previous_balance_paise: number;
  balance_after_paise: number;
  receipt_date: string;
  narration: string;
  whatsapp_link?: string | null;
};

type HistoryEntry = {
  voucher_number: string;
  narration: string | null;
  amount_paise: number;
  amount_rupees: string;
  created_at: string | null;
};

const paymentModes = ["CASH", "UPI", "CARD", "BANK"] as const;
const QUICK_AMOUNTS = [500, 1000, 2000, 5000] as const;

export default function UdhariReceiptWindow({ apiBaseUrl = "" }: UdhariReceiptWindowProps) {
  const { session } = useAuthSession();
  const [search, setSearch] = useState("");
  const [customers, setCustomers] = useState<ReceiptCustomer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [amountRupees, setAmountRupees] = useState("");
  const [paymentMode, setPaymentMode] = useState<(typeof paymentModes)[number]>("CASH");
  const [receiptDate, setReceiptDate] = useState(getToday());
  const [narration, setNarration] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [savedReceipt, setSavedReceipt] = useState<SavedReceipt | null>(null);
  const [rightTab, setRightTab] = useState<"receipt" | "history">("receipt");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);

  const authHeaders = useMemo(
    () => ({ Authorization: `Bearer ${session?.token ?? ""}` }),
    [session?.token]
  );

  const selectedCustomer = customers.find((c) => c.customer_id === selectedCustomerId) ?? null;
  const amountPaise = rupeesInputToPaise(amountRupees);
  const balanceAfterPaise = selectedCustomer ? selectedCustomer.balance_paise - amountPaise : 0;
  const isAdvanceCredit = selectedCustomer !== null && balanceAfterPaise < 0;
  const isFullyCleared = selectedCustomer !== null && amountPaise > 0 && balanceAfterPaise === 0;
  // Gate only on customer selection + not-saving (not on amount) so a zero/blank
  // amount produces a visible "enter a positive amount" error on click instead of a
  // silently disabled button.
  const canSave = Boolean(selectedCustomer && !saving);

  useEffect(() => {
    const id = window.setTimeout(() => { void loadCustomers(search); }, 180);
    return () => window.clearTimeout(id);
  }, [search, session?.token]);

  useEffect(() => {
    if (selectedCustomerId !== null) {
      void loadHistory(selectedCustomerId);
    } else {
      setHistory([]);
    }
  }, [selectedCustomerId, session?.token]);

  async function loadCustomers(searchTerm: string) {
    if (!session?.token) return;
    try {
      const res = await fetch(
        `${apiBaseUrl}/api/accounts/receipts/customers?search=${encodeURIComponent(searchTerm)}`,
        { headers: authHeaders }
      );
      const result = (await res.json().catch(() => null)) as { customers?: ReceiptCustomer[] } | null;
      if (!res.ok || !result?.customers) throw new Error("Could not load customers.");
      setCustomers(result.customers);
      setHighlightedIndex(0);
      if (!selectedCustomerId && result.customers.length > 0) {
        setSelectedCustomerId(result.customers[0].customer_id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load customers.");
      setCustomers([]);
    }
  }

  async function loadHistory(customerId: number) {
    if (!session?.token) return;
    setHistoryLoading(true);
    try {
      const res = await fetch(
        `${apiBaseUrl}/api/accounts/receipts/history/${customerId}`,
        { headers: authHeaders }
      );
      const result = (await res.json().catch(() => null)) as { history?: HistoryEntry[] } | null;
      setHistory(res.ok && result?.history ? result.history : []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  function selectCustomer(id: number) {
    setSelectedCustomerId(id);
    setSavedReceipt(null);
    setMessage("");
    setError("");
    setTimeout(() => amountRef.current?.focus(), 0);
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (customers.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, customers.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const target = customers[highlightedIndex];
      if (target) selectCustomer(target.customer_id);
    }
  }

  async function saveReceipt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setSavedReceipt(null);
    if (!selectedCustomer) { setError("Select a customer first."); return; }
    if (amountPaise <= 0) { setError("Enter a positive receipt amount."); return; }
    setSaving(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/accounts/receipts/udhari`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_id: selectedCustomer.customer_id,
          amount_paise: amountPaise,
          payment_mode: paymentMode,
          receipt_date: receiptDate,
          narration: narration.trim() || null
        })
      });
      const result = (await res.json().catch(() => null)) as {
        receipt?: SavedReceipt;
        whatsapp_link?: string | null;
        errors?: string[];
      } | null;
      if (!res.ok || !result?.receipt) throw new Error(result?.errors?.join(" ") || "Could not save receipt.");
      const receipt: SavedReceipt = { ...result.receipt, whatsapp_link: result.whatsapp_link ?? null };
      setSavedReceipt(receipt);
      setMessage(`Receipt ${receipt.receipt_number} saved.`);
      setRightTab("receipt");
      setAmountRupees("");
      setNarration("");
      await loadCustomers(search);
      await loadHistory(selectedCustomer.customer_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save receipt.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="grid h-screen grid-rows-[auto_1fr] overflow-hidden bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-3 py-2">
        <div>
          <h1 className="text-sm font-semibold uppercase text-slate-50">Receipt</h1>
          <p className="text-xs text-slate-400">Collect Udhari payments — partial, full, or advance deposits</p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          disabled={!savedReceipt}
          className="flex h-8 items-center gap-2 border border-slate-700 px-3 text-[11px] font-semibold uppercase text-slate-300 hover:border-emerald-400 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Printer className="h-3.5 w-3.5" />
          Print Receipt
        </button>
      </header>

      {(message || error) && (
        <div className={`border-b border-slate-800 px-3 py-1 text-xs ${error ? "bg-red-950/40 text-red-200" : "bg-emerald-950/40 text-emerald-200"}`}>
          {error || message}
        </div>
      )}

      <main className="grid min-h-0 grid-cols-[360px_1fr] overflow-hidden">
        {/* Left: customer search + keyboard-navigable list */}
        <aside className="grid min-h-0 grid-rows-[auto_1fr] border-r border-slate-800 bg-slate-950">
          <div className="border-b border-slate-800 p-3">
            <label className="grid gap-1 text-[10px] font-semibold uppercase text-slate-500">
              Customer Search
              <div className="flex h-9 items-center border border-slate-700 bg-slate-900 px-2 focus-within:border-emerald-400">
                <Search className="h-4 w-4 text-slate-500" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  autoFocus
                  placeholder="Name or phone  ↑↓ Enter"
                  className="h-full min-w-0 flex-1 bg-transparent px-2 text-sm text-slate-50 outline-none"
                />
              </div>
            </label>
          </div>

          <div className="min-h-0 overflow-auto">
            {customers.map((customer, idx) => {
              const isSelected = customer.customer_id === selectedCustomerId;
              const isHighlighted = idx === highlightedIndex && !isSelected;
              return (
                <button
                  key={customer.customer_id}
                  type="button"
                  onClick={() => selectCustomer(customer.customer_id)}
                  className={`grid w-full gap-1 border-b border-slate-900 px-3 py-2 text-left transition ${
                    isSelected
                      ? "bg-emerald-500 text-slate-50"
                      : isHighlighted
                        ? "bg-slate-800"
                        : "hover:bg-slate-900"
                  }`}
                >
                  <span className="truncate text-sm font-semibold">{customer.customer_name}</span>
                  <span className={`flex items-center justify-between gap-2 text-[11px] ${isSelected ? "text-slate-800" : "text-slate-500"}`}>
                    <span className="font-mono">{customer.phone ?? "No phone"}</span>
                    <span className={`font-mono font-semibold ${
                      isSelected ? "" : customer.balance_paise < 0 ? "text-emerald-300" : customer.balance_paise > 0 ? "text-red-300" : ""
                    }`}>
                      {customer.balance_paise < 0 ? "CR " : ""}{formatPaise(Math.abs(customer.balance_paise))}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="grid min-h-0 grid-cols-[minmax(0,1fr)_360px] overflow-hidden">
          {/* Centre: payment form */}
          <form onSubmit={saveReceipt} className="grid content-start gap-3 overflow-auto p-4">
            <div className="grid grid-cols-3 border border-slate-800 bg-slate-950">
              <MetricBox
                label="Current Balance"
                value={selectedCustomer ? formatPaiseDisplay(selectedCustomer.balance_paise) : "Rs 0.00"}
                tone={selectedCustomer && selectedCustomer.balance_paise < 0 ? "advance" : "payment"}
              />
              <MetricBox label="Receiving Today" value={formatPaise(amountPaise)} tone="receipt" />
              <MetricBox
                label="Balance After"
                value={selectedCustomer ? formatPaiseDisplay(balanceAfterPaise) : "Rs 0.00"}
                tone={isAdvanceCredit ? "advance" : "neutral"}
                badge={isAdvanceCredit ? "Advance Credit" : isFullyCleared ? "Cleared" : undefined}
              />
            </div>

            <div className="grid gap-3 border border-slate-800 bg-slate-900 p-4">
              <div className="flex items-center gap-2">
                <div className="grid h-9 w-9 place-items-center bg-emerald-500 text-slate-50">
                  <ReceiptIndianRupee className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold uppercase text-slate-50">
                    {selectedCustomer?.customer_name ?? "Select Customer"}
                  </h2>
                  <p className="font-mono text-xs text-slate-500">
                    {selectedCustomer?.phone ?? "Customer balance appears immediately after selection"}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <Field label="Receipt Date">
                  <DateInput
                    value={receiptDate}
                    onChange={setReceiptDate}
                    className={controlClassName}
                  />
                </Field>
                <Field label="Payment Mode">
                  <select
                    value={paymentMode}
                    onChange={(e) => setPaymentMode(e.target.value as typeof paymentMode)}
                    className={controlClassName}
                  >
                    {paymentModes.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </Field>
                <Field label="Amount (Rs)">
                  <input
                    ref={amountRef}
                    value={amountRupees}
                    onChange={(e) => setAmountRupees(e.target.value)}
                    inputMode="decimal"
                    placeholder="e.g. 3000"
                    className={controlClassName}
                  />
                </Field>
              </div>

              {/* Quick amount buttons */}
              <div className="flex flex-wrap gap-2">
                {QUICK_AMOUNTS.map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    onClick={() => setAmountRupees(String(amount))}
                    className="h-7 border border-slate-700 px-3 text-[11px] font-semibold text-slate-400 hover:border-emerald-400 hover:text-emerald-300"
                  >
                    ₹{amount.toLocaleString("en-IN")}
                  </button>
                ))}
                {selectedCustomer && selectedCustomer.balance_paise > 0 && (
                  <button
                    type="button"
                    onClick={() => setAmountRupees(paiseToDecimalString(selectedCustomer.balance_paise))}
                    className="h-7 border border-emerald-700 bg-emerald-950/30 px-3 text-[11px] font-semibold text-emerald-400 hover:border-emerald-400 hover:text-emerald-300"
                  >
                    Pay Full ({formatPaise(selectedCustomer.balance_paise)})
                  </button>
                )}
              </div>

              {isAdvanceCredit && (
                <p className="animate-fade-in rounded-sm border border-amber-700 bg-amber-950/40 px-2 py-1 text-[11px] text-amber-300">
                  ⚠ Customer owes {formatPaise(Math.max(selectedCustomer?.balance_paise ?? 0, 0))}; {formatPaise(Math.abs(balanceAfterPaise))} of this receipt will be recorded as advance credit. Check the amount if this is unexpected.
                </p>
              )}

              <Field label="Narration (optional)">
                <textarea
                  value={narration}
                  onChange={(e) => setNarration(e.target.value)}
                  placeholder={selectedCustomer ? `Udhari receipt from ${selectedCustomer.customer_name}` : "Optional note"}
                  className={`${controlClassName} min-h-20 py-2`}
                />
              </Field>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={!canSave}
                  className="h-9 bg-emerald-500 px-5 text-xs font-bold uppercase text-slate-50 hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                >
                  {saving ? "Saving..." : isAdvanceCredit ? "Save as Advance" : "Save Receipt"}
                </button>
              </div>
            </div>
          </form>

          {/* Right: Receipt preview / History tabs */}
          <aside className="grid min-h-0 grid-rows-[auto_1fr] border-l border-slate-800 bg-slate-900">
            <style dangerouslySetInnerHTML={{ __html: receiptPrintStyles }} />
            <div className="flex border-b border-slate-800">
              <TabButton label="Receipt" active={rightTab === "receipt"} onClick={() => setRightTab("receipt")} />
              <TabButton
                label={history.length > 0 ? `History (${history.length})` : "History"}
                active={rightTab === "history"}
                onClick={() => setRightTab("history")}
                icon={<Clock className="h-3 w-3" />}
              />
            </div>

            {rightTab === "receipt" ? (
              <div className="overflow-auto p-4">
                <div id="udhari-receipt-slip" className="grid gap-3 border border-slate-700 bg-slate-950 p-4">
                  <div className="border-b border-slate-800 pb-3">
                    <p className="text-[10px] font-semibold uppercase text-slate-500">Payment Receipt</p>
                    <h2 className="mt-1 text-lg font-bold uppercase text-slate-50">Jewelry ERP</h2>
                    <p className="font-mono text-xs text-slate-400">{savedReceipt?.receipt_number ?? "Not saved yet"}</p>
                  </div>

                  {savedReceipt ? (
                    <>
                      <ReceiptLine label="Date" value={savedReceipt.receipt_date} />
                      <ReceiptLine label="Customer" value={savedReceipt.customer_name} />
                      <ReceiptLine label="Phone" value={savedReceipt.customer_phone ?? "-"} />
                      <ReceiptLine label="Mode" value={savedReceipt.payment_mode} />
                      <div className="my-1 border-t border-slate-800" />
                      <ReceiptLine label="Previous Balance" value={formatPaiseDisplay(savedReceipt.previous_balance_paise)} />
                      <ReceiptLine label="Amount Received" value={formatPaise(savedReceipt.amount_paise)} strong />
                      <ReceiptLine
                        label={savedReceipt.balance_after_paise < 0 ? "Advance Credit" : "Balance Due"}
                        value={formatPaiseDisplay(savedReceipt.balance_after_paise)}
                        creditTone={savedReceipt.balance_after_paise < 0}
                      />
                      <p className="mt-3 text-xs text-slate-400">{savedReceipt.narration}</p>
                      {savedReceipt.whatsapp_link && (
                        <a
                          href={savedReceipt.whatsapp_link}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 flex h-8 items-center gap-2 border border-green-700 bg-green-950/30 px-3 text-[11px] font-semibold text-green-400 hover:border-green-500 hover:text-green-300"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Send WhatsApp Confirmation
                        </a>
                      )}
                      <div className="mt-8 grid grid-cols-2 gap-4 text-[10px] uppercase text-slate-500">
                        <span className="border-t border-slate-700 pt-2">Customer Sign</span>
                        <span className="border-t border-slate-700 pt-2 text-right">Cashier Sign</span>
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-slate-500">Saved receipt preview will appear here.</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="overflow-auto p-4">
                {historyLoading ? (
                  <p className="text-xs text-slate-500">Loading...</p>
                ) : !selectedCustomer ? (
                  <p className="text-xs text-slate-500">Select a customer to view history.</p>
                ) : history.length === 0 ? (
                  <p className="text-xs text-slate-500">No previous receipts for {selectedCustomer.customer_name}.</p>
                ) : (
                  <div className="grid gap-2">
                    {history.map((entry) => (
                      <div key={entry.voucher_number} className="grid gap-1 border border-slate-800 bg-slate-950 px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[11px] text-slate-400">{entry.voucher_number}</span>
                          <span className="font-mono text-sm font-semibold text-emerald-300">{entry.amount_rupees}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[11px] text-slate-500">{entry.narration ?? "—"}</span>
                          <span className="shrink-0 font-mono text-[10px] text-slate-600">
                            {entry.created_at?.slice(0, 10) ?? ""}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </aside>
        </section>
      </main>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-[10px] font-semibold uppercase text-slate-500">
      {label}
      {children}
    </label>
  );
}

function MetricBox({
  label,
  value,
  tone = "neutral",
  badge
}: {
  label: string;
  value: string;
  tone?: "neutral" | "receipt" | "payment" | "advance";
  badge?: string;
}) {
  const valueCls =
    tone === "receipt" ? "text-emerald-300" :
    tone === "payment" ? "text-red-300" :
    tone === "advance" ? "text-emerald-300" :
    "text-slate-50";
  return (
    <div className="border-r border-slate-800 px-3 py-2 last:border-r-0">
      <div className="text-[10px] font-semibold uppercase text-slate-500">{label}</div>
      <div className={`font-mono text-lg font-semibold ${valueCls}`}>{value}</div>
      {badge && <div className="text-[10px] font-semibold uppercase text-emerald-500">{badge}</div>}
    </div>
  );
}

function ReceiptLine({
  label,
  value,
  strong = false,
  creditTone = false
}: {
  label: string;
  value: string;
  strong?: boolean;
  creditTone?: boolean;
}) {
  const valueCls = creditTone
    ? "text-base font-bold text-emerald-300"
    : strong
      ? "text-base font-bold text-emerald-300"
      : "font-semibold text-slate-100";
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-slate-500">{label}</span>
      <span className={`text-right font-mono ${valueCls}`}>{value}</span>
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick,
  icon
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-9 items-center gap-1.5 border-b-2 px-4 text-[11px] font-semibold uppercase transition ${
        active ? "border-emerald-400 text-emerald-300" : "border-transparent text-slate-500 hover:text-slate-300"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function rupeesInputToPaise(value: string): number {
  const match = value.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return 0;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
}

function formatPaise(value: number): string {
  const rupees = Math.trunc(Math.abs(value) / 100);
  const paise = String(Math.abs(value) % 100).padStart(2, "0");
  return `Rs ${rupees}.${paise}`;
}

function formatPaiseDisplay(value: number): string {
  if (value < 0) {
    const abs = Math.abs(value);
    return `CR Rs ${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  }
  return formatPaise(value);
}

function paiseToDecimalString(value: number): string {
  const rupees = Math.trunc(value / 100);
  const paise = value % 100;
  return paise === 0 ? String(rupees) : `${rupees}.${String(paise).padStart(2, "0")}`;
}

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

const controlClassName =
  "h-9 w-full border border-slate-700 bg-slate-950 px-2 text-sm text-slate-50 outline-none focus:border-emerald-400";

const receiptPrintStyles = `
@media print {
  body * { visibility: hidden; }
  #udhari-receipt-slip, #udhari-receipt-slip * { visibility: visible; }
  #udhari-receipt-slip {
    position: absolute;
    inset: 0 auto auto 0;
    width: 80mm;
    background: white !important;
    color: black !important;
    border: 0 !important;
    padding: 8mm !important;
  }
  #udhari-receipt-slip div,
  #udhari-receipt-slip p,
  #udhari-receipt-slip h2,
  #udhari-receipt-slip span {
    color: black !important;
    border-color: #222 !important;
  }
  a[href] { display: none !important; }
}
`;
