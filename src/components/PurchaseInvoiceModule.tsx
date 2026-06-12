import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuthSession } from "../auth/AuthSessionContext.js";
import { selectOnFocus, DateInput } from "./ui.js";

type PurchaseInvoiceModuleProps = {
  apiBaseUrl?: string;
};

type Supplier = {
  id: number;
  name: string;
  phone?: string | null;
  gstin?: string | null;
};

type PaymentMode = "CREDIT" | "CASH" | "BANK" | "UPI";

type LineForm = {
  key: string;
  category: string;
  description: string;
  metalType: "GOLD" | "SILVER";
  purityKarat: string;
  stockMode: "PIECES" | "LOT";
  quantity: string;
  grossGrams: string;
  stoneGrams: string;
  ratePerGramRupees: string;
  makingRupees: string;
  gstRupees: string;
};

const controlClassName = "h-8 w-full border border-slate-700 bg-slate-950 px-2 text-xs text-slate-50 outline-none focus:border-emerald-400";

function emptyLine(key: string): LineForm {
  return {
    key,
    category: "Gold Chains",
    description: "",
    metalType: "GOLD",
    purityKarat: "22",
    stockMode: "PIECES",
    quantity: "1",
    grossGrams: "",
    stoneGrams: "0",
    ratePerGramRupees: "",
    makingRupees: "0",
    gstRupees: "0"
  };
}

export default function PurchaseInvoiceModule({ apiBaseUrl = "" }: PurchaseInvoiceModuleProps) {
  const { session } = useAuthSession();
  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${session?.token ?? ""}` }), [session?.token]);

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [showNewSupplier, setShowNewSupplier] = useState(false);
  const [newSupplier, setNewSupplier] = useState({ name: "", phone: "", gstin: "" });

  const [billNumber, setBillNumber] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(getToday());
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("CREDIT");
  const [tdsPercent, setTdsPercent] = useState("");

  const lineKeyRef = useRef(1);
  const [lines, setLines] = useState<LineForm[]>(() => [emptyLine("l0")]);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void loadSuppliers();
  }, []);

  const selectedSupplier = suppliers.find((supplier) => String(supplier.id) === supplierId) ?? null;
  const computedLines = lines.map(computeLine);
  const grossTotalPaise = computedLines.reduce((sum, line) => sum + line.lineTotalPaise, 0);
  const gstTotalPaise = computedLines.reduce((sum, line) => sum + line.gstPaise, 0);
  const tdsAmountPaise = Math.round((grossTotalPaise * (Number(tdsPercent) || 0)) / 100);

  const saveDisabled =
    !selectedSupplier ||
    computedLines.length === 0 ||
    computedLines.some((line) => line.netWeightMg <= 0 || line.lineTotalPaise <= 0);

  async function loadSuppliers() {
    try {
      const response = await fetch(`${apiBaseUrl}/api/suppliers`, { headers: authHeaders });
      const result = (await response.json().catch(() => null)) as { suppliers?: Supplier[] } | null;
      setSuppliers(response.ok && result?.suppliers ? result.suppliers : []);
    } catch {
      setSuppliers([]);
    }
  }

  async function createSupplier() {
    setError("");
    if (!newSupplier.name.trim()) {
      setError("Supplier name is required.");
      return;
    }
    try {
      const response = await fetch(`${apiBaseUrl}/api/suppliers`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newSupplier.name.trim(),
          phone: newSupplier.phone.trim() || null,
          gstin: newSupplier.gstin.trim() || null
        })
      });
      const result = (await response.json().catch(() => null)) as { supplier?: Supplier; errors?: string[] } | null;
      if (!response.ok || !result?.supplier) {
        throw new Error(result?.errors?.join(" ") || "Could not create supplier.");
      }
      await loadSuppliers();
      setSupplierId(String(result.supplier.id));
      setShowNewSupplier(false);
      setNewSupplier({ name: "", phone: "", gstin: "" });
      setMessage(`Supplier "${result.supplier.name}" added.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create supplier.");
    }
  }

  function updateLine(key: string, patch: Partial<LineForm>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }
  function addLine() {
    setLines((current) => [...current, emptyLine(`l${lineKeyRef.current++}`)]);
  }
  function removeLine(key: string) {
    setLines((current) => (current.length > 1 ? current.filter((line) => line.key !== key) : current));
  }

  async function savePurchase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (saveDisabled || !selectedSupplier) {
      setError("Select a supplier and complete at least one valid line.");
      return;
    }

    const payloadLines = lines.map((line) => {
      const c = computeLine(line);
      return {
        description: line.description.trim() || line.category.trim(),
        category: line.category.trim() || "Purchase Stock",
        quantity: c.quantity,
        stock_mode: line.stockMode,
        metal_type: line.metalType,
        purity_karat: Number(line.purityKarat) || 0,
        gross_weight_mg: c.grossWeightMg,
        stone_weight_mg: c.stoneWeightMg,
        net_weight_mg: c.netWeightMg,
        metal_rate_paise_per_gram: c.ratePerGramPaise,
        making_charge_paise: c.makingPaise,
        gst_paise: c.gstPaise,
        line_total_paise: c.lineTotalPaise
      };
    });

    try {
      const response = await fetch(`${apiBaseUrl}/api/pos/purchases`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          supplier_id: selectedSupplier.id,
          supplier_name: selectedSupplier.name,
          supplier_phone: selectedSupplier.phone ?? null,
          supplier_gstin: selectedSupplier.gstin ?? null,
          purchase_date: purchaseDate,
          bill_number: billNumber.trim() || null,
          payment_mode: paymentMode,
          gross_total_paise: grossTotalPaise,
          gst_amount_paise: gstTotalPaise,
          discount_paise: 0,
          total_amount_paise: grossTotalPaise,
          tds_percent: Number(tdsPercent) || 0,
          lines: payloadLines
        })
      });
      const result = (await response.json().catch(() => null)) as { purchase?: { purchase_number?: string }; stock_items?: unknown[]; errors?: string[] } | null;
      if (!response.ok) {
        throw new Error(result?.errors?.join(" ") || "Could not save purchase invoice.");
      }
      const count = result?.stock_items?.length ?? 0;
      setMessage(`Purchase ${result?.purchase?.purchase_number ?? ""} saved. ${count} item(s) added to live stock.`);
      setLines([emptyLine(`l${lineKeyRef.current++}`)]);
      setBillNumber("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save purchase invoice.");
    }
  }

  return (
    <section className="grid h-screen grid-rows-[auto_auto_1fr] overflow-hidden bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-3 py-2">
        <div>
          <h1 className="text-sm font-semibold uppercase text-slate-50">Purchase Invoice (Inward)</h1>
          <p className="text-xs text-slate-400">Wholesale / B2B stock entry — updates live inventory & supplier ledger</p>
        </div>
      </header>

      {(message || error) && (
        <div className={`border-b border-slate-800 px-3 py-1 text-xs ${error ? "bg-red-950/50 text-red-200" : "bg-emerald-950/40 text-emerald-200"}`}>
          {error || message}
        </div>
      )}

      <form onSubmit={savePurchase} className="grid min-h-0 grid-cols-[300px_1fr_260px] overflow-hidden">
        <aside className="grid content-start gap-3 border-r border-slate-800 bg-slate-900 p-3">
          <PanelTitle title="Supplier" />
          <Field label="Supplier / Wholesaler">
            <select value={supplierId} onChange={(event) => setSupplierId(event.target.value)} className={controlClassName}>
              <option value="">Select supplier</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
              ))}
            </select>
          </Field>
          {selectedSupplier?.gstin && <MetricBox label="GSTIN" value={selectedSupplier.gstin} />}

          {!showNewSupplier ? (
            <button type="button" onClick={() => setShowNewSupplier(true)} className="h-8 rounded bg-slate-800 text-[11px] font-bold uppercase text-emerald-300 hover:bg-slate-700">
              + Add New Supplier
            </button>
          ) : (
            <div className="grid gap-2 border border-slate-800 bg-slate-950 p-2">
              <Field label="Name">
                <input value={newSupplier.name} onChange={(event) => setNewSupplier({ ...newSupplier, name: event.target.value })} className={controlClassName} />
              </Field>
              <Field label="Phone">
                <input value={newSupplier.phone} onChange={(event) => setNewSupplier({ ...newSupplier, phone: event.target.value })} className={controlClassName} />
              </Field>
              <Field label="GSTIN">
                <input value={newSupplier.gstin} onChange={(event) => setNewSupplier({ ...newSupplier, gstin: event.target.value })} className={controlClassName} />
              </Field>
              <div className="flex gap-2">
                <button type="button" onClick={createSupplier} className="h-8 flex-1 rounded bg-emerald-500 text-[11px] font-bold uppercase text-slate-50 hover:bg-emerald-600">Save</button>
                <button type="button" onClick={() => setShowNewSupplier(false)} className="h-8 rounded border border-slate-700 bg-slate-800 px-3 text-[11px] font-bold uppercase hover:bg-slate-700">Cancel</button>
              </div>
            </div>
          )}

          <PanelTitle title="Invoice" />
          <Field label="Ref Bill No (supplier hardcopy)">
            <input value={billNumber} onChange={(event) => setBillNumber(event.target.value)} className={controlClassName} placeholder="Supplier invoice #" />
          </Field>
          <Field label="Purchase Date">
            <DateInput value={purchaseDate} onChange={setPurchaseDate} className={controlClassName} />
          </Field>
        </aside>

        <section className="grid min-h-0 grid-rows-[auto_1fr]">
          <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-3 py-2">
            <span className="text-xs font-semibold uppercase text-slate-50">Purchase Items</span>
            <button type="button" onClick={addLine} className="rounded bg-slate-800 px-3 py-1 text-[10px] font-bold uppercase text-emerald-300 hover:bg-slate-700">+ Add Line</button>
          </div>
          <div className="grid content-start gap-2 overflow-auto p-3">
            {lines.map((line, index) => {
              const c = computeLine(line);
              return (
                <div key={line.key} className="grid gap-2 border border-slate-800 bg-slate-950 p-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase text-slate-500">Line {index + 1}</span>
                    <button type="button" onClick={() => removeLine(line.key)} disabled={lines.length <= 1} className="text-[10px] font-bold uppercase text-red-300 hover:text-red-200 disabled:text-slate-700">✕ Remove</button>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    <Field label="Category"><input value={line.category} onChange={(event) => updateLine(line.key, { category: event.target.value })} className={controlClassName} /></Field>
                    <Field label="Description"><input value={line.description} onChange={(event) => updateLine(line.key, { description: event.target.value })} className={controlClassName} placeholder="optional" /></Field>
                    <Field label="Metal">
                      <select value={line.metalType} onChange={(event) => updateLine(line.key, { metalType: event.target.value as LineForm["metalType"] })} className={controlClassName}>
                        <option value="GOLD">Gold</option>
                        <option value="SILVER">Silver</option>
                      </select>
                    </Field>
                    <Field label="Purity (K)"><input value={line.purityKarat} onChange={(event) => updateLine(line.key, { purityKarat: event.target.value })} onFocus={selectOnFocus} className={controlClassName} inputMode="decimal" /></Field>
                  </div>
                  <div className="grid grid-cols-5 gap-2">
                    <Field label="Stock As">
                      <select value={line.stockMode} onChange={(event) => updateLine(line.key, { stockMode: event.target.value as LineForm["stockMode"] })} className={controlClassName}>
                        <option value="PIECES">Pieces (1 tag each)</option>
                        <option value="LOT">Lot (1 tag, total wt)</option>
                      </select>
                    </Field>
                    <Field label="Qty (pieces)"><input value={line.quantity} disabled={line.stockMode === "LOT"} onChange={(event) => updateLine(line.key, { quantity: event.target.value })} onFocus={selectOnFocus} className={`${controlClassName} disabled:bg-slate-900 disabled:text-slate-600`} inputMode="numeric" /></Field>
                    <Field label="Gross Wt (g)"><input value={line.grossGrams} onChange={(event) => updateLine(line.key, { grossGrams: event.target.value })} onFocus={selectOnFocus} className={controlClassName} inputMode="decimal" /></Field>
                    <Field label="Stone/Less (g)"><input value={line.stoneGrams} onChange={(event) => updateLine(line.key, { stoneGrams: event.target.value })} onFocus={selectOnFocus} className={controlClassName} inputMode="decimal" /></Field>
                    <Field label="Net Wt (g)"><input value={(c.netWeightMg / 1000).toFixed(3)} readOnly tabIndex={-1} className={`${controlClassName} bg-slate-900 text-slate-300`} /></Field>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    <Field label="Rate / g (Rs)"><input value={line.ratePerGramRupees} onChange={(event) => updateLine(line.key, { ratePerGramRupees: event.target.value })} onFocus={selectOnFocus} className={controlClassName} inputMode="decimal" /></Field>
                    <Field label="Making (Rs)"><input value={line.makingRupees} onChange={(event) => updateLine(line.key, { makingRupees: event.target.value })} onFocus={selectOnFocus} className={controlClassName} inputMode="decimal" /></Field>
                    <Field label="GST (Rs)"><input value={line.gstRupees} onChange={(event) => updateLine(line.key, { gstRupees: event.target.value })} onFocus={selectOnFocus} className={controlClassName} inputMode="decimal" /></Field>
                    <MetricBox label="Line Total" value={formatPaise(c.lineTotalPaise)} />
                  </div>
                  <div className="text-[10px] uppercase text-slate-500">Metal amount: {formatPaise(c.metalPaise)} • creates {line.stockMode === "LOT" ? 1 : c.quantity} barcoded item(s)</div>
                </div>
              );
            })}
          </div>
        </section>

        <aside className="grid content-start gap-3 border-l border-slate-800 bg-slate-900 p-3">
          <PanelTitle title="Settlement" />
          <Field label="Payment">
            <select value={paymentMode} onChange={(event) => setPaymentMode(event.target.value as PaymentMode)} className={controlClassName}>
              <option value="CREDIT">Credit (supplier outstanding)</option>
              <option value="CASH">Cash</option>
              <option value="BANK">Bank / RTGS / NEFT</option>
              <option value="UPI">UPI</option>
            </select>
          </Field>
          <MetricBox label="GST" value={formatPaise(gstTotalPaise)} />
          <Field label="TDS % (e.g. 0.1 u/s 194Q)">
            <input value={tdsPercent} onChange={(event) => setTdsPercent(event.target.value)} onFocus={selectOnFocus} className={controlClassName} inputMode="decimal" placeholder="0" />
          </Field>
          {tdsAmountPaise > 0 && <MetricBox label="TDS Withheld" value={formatPaise(tdsAmountPaise)} />}
          <MetricBox label="Total Payable" value={formatPaise(Math.max(grossTotalPaise - tdsAmountPaise, 0))} tone="ok" />
          {paymentMode === "CREDIT" && selectedSupplier && (
            <p className="border border-amber-600/40 bg-amber-950/30 p-2 text-[10px] text-amber-200">Adds {formatPaise(grossTotalPaise)} to {selectedSupplier.name}'s outstanding balance.</p>
          )}
          <button type="submit" disabled={saveDisabled} className="h-10 bg-emerald-500 text-xs font-semibold uppercase text-slate-50 disabled:bg-slate-700 disabled:text-slate-500">
            Save & Add to Stock
          </button>
        </aside>
      </form>
    </section>
  );
}

type ComputedLine = {
  quantity: number;
  grossWeightMg: number;
  stoneWeightMg: number;
  netWeightMg: number;
  ratePerGramPaise: number;
  makingPaise: number;
  gstPaise: number;
  metalPaise: number;
  lineTotalPaise: number;
};

function computeLine(line: LineForm): ComputedLine {
  const quantity = Math.max(1, Math.floor(Number(line.quantity) || 1));
  const grossWeightMg = gramsToMg(line.grossGrams);
  const stoneWeightMg = gramsToMg(line.stoneGrams);
  const netWeightMg = Math.max(0, grossWeightMg - stoneWeightMg);
  const ratePerGramPaise = rupeesToPaise(line.ratePerGramRupees);
  const makingPaise = rupeesToPaise(line.makingRupees);
  const gstPaise = rupeesToPaise(line.gstRupees);
  const metalPaise = Math.floor((netWeightMg * ratePerGramPaise) / 1000);
  const lineTotalPaise = metalPaise + makingPaise + gstPaise;

  return { quantity, grossWeightMg, stoneWeightMg, netWeightMg, ratePerGramPaise, makingPaise, gstPaise, metalPaise, lineTotalPaise };
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-[10px] font-semibold uppercase text-slate-400">{label}</span>
      {children}
    </label>
  );
}

function MetricBox({ label, value, tone }: { label: string; value: string; tone?: "ok" }) {
  return (
    <div className="border border-slate-800 bg-slate-950 p-2">
      <div className="text-[10px] font-semibold uppercase text-slate-500">{label}</div>
      <div className={`mt-0.5 font-mono text-sm ${tone === "ok" ? "text-emerald-300" : "text-slate-100"}`}>{value}</div>
    </div>
  );
}

function PanelTitle({ title }: { title: string }) {
  return <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">{title}</h2>;
}

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function formatPaise(paise: number) {
  return `Rs ${(paise / 100).toFixed(2)}`;
}

function gramsToMg(value: string) {
  return decimalToScaledInteger(value, 1000, 3);
}

function rupeesToPaise(value: string) {
  return decimalToScaledInteger(value, 100, 2);
}

function decimalToScaledInteger(value: string, scale: 100 | 1000, maxDecimalPlaces: 2 | 3) {
  const match = value.trim().match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return 0;
  const fractional = (match[2] ?? "").slice(0, maxDecimalPlaces).padEnd(maxDecimalPlaces, "0");
  return Number(match[1]) * scale + Number(fractional || "0");
}
